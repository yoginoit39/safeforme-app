import type { ProductData } from '../types';
import { HOSTS, mapOffProduct } from './off';

/**
 * Better-rated products of the same kind, from Open Food Facts. Free, no key.
 * This only fetches candidates. Whether one is right for the user is decided on the phone,
 * against their own profile: nothing is suggested that their profile would reject.
 */

const FIELDS = [
  'code', 'product_name', 'brands', 'image_small_url', 'image_front_url', 'ingredients_text', 'ingredients_text_en', 'lc', 'ingredients',
  'allergens_tags', 'traces_tags', 'labels_tags', 'nutriscore_grade', 'nova_group', 'nutriments', 'categories_tags', 'countries_tags', 'last_image_t', 'last_modified_t', 'ingredients_n', 'unknown_ingredients_n',
].join(',');

/** "en-IN" → "india": the country tag the database uses, taken from the phone's region setting. */
export function countryTag(locale: string | undefined): string | null {
  const region = /[-_]([A-Za-z]{2})\b/.exec(locale ?? '')?.[1]?.toUpperCase();
  if (!region) return null;
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'region' }).of(region);
    return name ? name.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '') : null;
  } catch {
    return null;
  }
}

async function search(category: string, country: string | null, signal: AbortSignal): Promise<ProductData[]> {
  const params = [
    `categories_tags=${encodeURIComponent(`en:${category}`)}`,
    'nutrition_grades_tags=a%7Cb%7Cc',
    country ? `countries_tags=${encodeURIComponent(`en:${country}`)}` : '',
    'sort_by=nutriscore_score',
    'page_size=40',
    `fields=${FIELDS}`,
  ].filter(Boolean);
  const res = await fetch(`${HOSTS.food}/api/v2/search?${params.join('&')}`, { referrerPolicy: 'no-referrer', signal });
  if (!res.ok) throw new Error(String(res.status));
  const json = await res.json();
  return (Array.isArray(json?.products) ? json.products : [])
    .filter((p: any) => typeof p?.code === 'string' && /^\d{6,14}$/.test(p.code) && typeof p.product_name === 'string' && p.product_name.trim())
    .map((p: any) => mapOffProduct(p.code, p, 'food', 'en'));
}

export type Alternatives = { items: ProductData[]; local: boolean };

/**
 * At most three requests, most specific first, stopping as soon as enough candidates are found:
 * the same narrow category in the user's country, then one level broader, then anywhere.
 */
export async function findAlternatives(product: ProductData, country: string | null, enough: (items: ProductData[]) => boolean): Promise<Alternatives> {
  const cats = (product.categories ?? []).filter((c) => /^[a-z0-9-]+$/.test(c));
  if (!cats.length) return { items: [], local: false };
  const narrow = cats[cats.length - 1];
  // The last tags are often one product wide ("coated chocolate bar without biscuit"): two levels up is the real shelf.
  const broader = cats[cats.length - 3] ?? cats[cats.length - 2] ?? null;
  const plan: [string, string | null][] = [];
  if (country) plan.push([narrow, country]);
  if (country && broader) plan.push([broader, country]);
  plan.push([broader ?? narrow, null]);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  let best: Alternatives = { items: [], local: false };
  let failures = 0;
  try {
    for (const [category, where] of plan.slice(0, 3)) {
      try {
        const items = (await search(category, where, controller.signal)).filter((c) => c.barcode !== product.barcode && c.kind === 'food');
        if (items.length > best.items.length) best = { items, local: !!where };
        if (enough(items)) return { items, local: !!where };
      } catch {
        failures++;
      }
    }
    if (!best.items.length && failures === Math.min(3, plan.length)) throw new Error('search failed');
    return best;
  } finally {
    clearTimeout(timer);
  }
}
