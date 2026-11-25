import type { ProductKind } from '../types';
import { HOSTS } from './off';

/** Search by product name across the food, cosmetics and pet food databases. Free, no key. */

export type SearchHit = { barcode: string; name: string; brand?: string; imageUrl?: string; kind: ProductKind; lang?: string };

const TIMEOUT_MS = 12_000;
const first = (v: unknown): string | undefined => {
  const s = Array.isArray(v) ? v[0] : typeof v === 'string' ? v.split(',')[0] : undefined;
  return typeof s === 'string' && s.trim() ? s.trim().replace(/^[a-z]{2}:/, '') : undefined;
};

function toHit(p: Record<string, any>, kind: ProductKind, lang: string): SearchHit | null {
  const barcode = typeof p?.code === 'string' ? p.code : '';
  const pick = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const local = pick(p?.[`product_name_${lang}`]);
  const name = local || pick(p?.product_name);
  if (!/^\d{6,14}$/.test(barcode) || !name) return null;
  const image = typeof p.image_small_url === 'string' && p.image_small_url.startsWith('https://') ? p.image_small_url : undefined;
  const productLang = pick(p.lc || p.lang).slice(0, 2).toLowerCase() || undefined;
  return { barcode, name, brand: first(p.brands), imageUrl: image, kind, lang: local ? lang : productLang };
}

/** Products described in the user's language first; the databases' own order is kept otherwise. */
const inLangFirst = (hits: SearchHit[], lang: string, keep: number): SearchHit[] =>
  [...hits.filter((h) => h.lang === lang), ...hits.filter((h) => h.lang !== lang)].slice(0, keep);

async function getJson(url: string, signal: AbortSignal): Promise<any> {
  const res = await fetch(url, { referrerPolicy: 'no-referrer', signal });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

const fields = (lang: string) => `code,product_name,product_name_${lang},lc,brands,image_small_url`;

/** Food uses Open Food Facts' dedicated search service, which is fast and typo-tolerant. */
async function searchFood(q: string, lang: string, signal: AbortSignal): Promise<SearchHit[]> {
  const json = await getJson(`https://search.openfoodfacts.org/search?q=${encodeURIComponent(q)}&langs=${lang}&page_size=24&fields=${fields(lang)},lang`, signal);
  const hits = (Array.isArray(json?.hits) ? json.hits : []).map((p: any) => toHit(p, 'food', lang)).filter(Boolean) as SearchHit[];
  return inLangFirst(hits, lang, 12);
}

async function searchClassic(q: string, kind: ProductKind, lang: string, signal: AbortSignal): Promise<SearchHit[]> {
  const url = `${HOSTS[kind]}/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=24&fields=${fields(lang)}`;
  const json = await getJson(url, signal);
  const hits = (Array.isArray(json?.products) ? json.products : []).map((p: any) => toHit(p, kind, lang)).filter(Boolean) as SearchHit[];
  return inLangFirst(hits, lang, kind === 'food' ? 12 : 6);
}

/**
 * One request per database, sent together, only when the user submits the search.
 * A database that fails is left out; the search only throws when all three fail.
 */
export async function searchByName(query: string, lang = 'en'): Promise<SearchHit[]> {
  const q = query.trim().slice(0, 80);
  if (q.length < 2) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const results = await Promise.allSettled([
      // The fast food search only answers web pages, not the iPhone app. The classic search answers both.
      searchFood(q, lang, controller.signal).catch(() => searchClassic(q, 'food', lang, controller.signal).then((hits) => hits.slice(0, 12))),
      searchClassic(q, 'beauty', lang, controller.signal),
      searchClassic(q, 'petfood', lang, controller.signal),
    ]);
    if (results.every((r) => r.status === 'rejected')) throw new Error('search failed');
    return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  } finally {
    clearTimeout(timer);
  }
}
