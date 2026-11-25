import type { ProductData } from '../types';
import { HOSTS, mapOffProduct } from './off';

/**
 * Better-rated products of the same kind, from Open Food Facts. Free, no key.
 * This only fetches candidates. Whether one is right for the user is decided on the phone,
 * against their own profile: nothing is suggested that their profile would reject.
 */

const FIELDS = [
  'code', 'product_name', 'brands', 'image_small_url', 'image_front_url', 'ingredients_text', 'ingredients_text_en', 'lc', 'ingredients',
  'allergens_tags', 'traces_tags', 'labels_tags', 'nutriscore_grade', 'nova_group', 'nutriments', 'categories_tags', 'countries_tags', 'last_image_t', 'last_modified_t', 'ingredients_n', 'unknown_ingredients_n', 'unique_scans_n',
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
    'nutrition_grades_tags=a%7Cb',
    country ? `countries_tags=${encodeURIComponent(`en:${country}`)}` : '',
    // Most-scanned first: well-known products with entries many people have looked at, not obscure mis-filed ones.
    'sort_by=unique_scans_n',
    'page_size=50',
    `fields=${FIELDS}`,
  ].filter(Boolean);
  const res = await fetch(`${HOSTS.food}/api/v2/search?${params.join('&')}`, { referrerPolicy: 'no-referrer', signal });
  if (!res.ok) throw new Error(String(res.status));
  const json = await res.json();
  return (Array.isArray(json?.products) ? json.products : [])
    .filter((p: any) => typeof p?.code === 'string' && /^\d{6,14}$/.test(p.code) && typeof p.product_name === 'string' && p.product_name.trim())
    .map((p: any) => mapOffProduct(p.code, p, 'food', 'en'));
}

/**
 * The shelves to look on, nearest first: the product's own narrow category, then up to two wider
 * ones. Never the top of the tree ("beverages", "snacks"), which is a different aisle altogether.
 */
export function shelvesFor(product: ProductData): string[] {
  const cats = (product.categories ?? []).filter((c) => /^[a-z0-9-]+$/.test(c));
  const usable = cats.slice(Math.min(2, Math.max(0, cats.length - 1)));
  const n = usable.length;
  return [...new Set([usable[n - 1], usable[n - 2], usable[n - 4] ?? usable[n - 3]].filter((c): c is string => !!c))];
}

/**
 * At most three requests, nearest shelf first, stopping as soon as enough good options are found.
 * Only products sold in the user's country are asked for: an option you can't buy is not an option.
 */
export async function findAlternatives(product: ProductData, country: string | null, enough: (items: ProductData[]) => boolean): Promise<ProductData[]> {
  const shelves = shelvesFor(product);
  const where = country ?? product.countries?.[0] ?? null;
  if (!shelves.length || !where) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  const all = new Map<string, ProductData>();
  let failures = 0;
  try {
    for (const shelf of shelves) {
      try {
        for (const c of await search(shelf, where, controller.signal)) if (c.barcode && c.kind === 'food') all.set(c.barcode, c);
        if (enough([...all.values()])) break;
      } catch {
        failures++;
      }
    }
    if (!all.size && failures === shelves.length) throw new Error('search failed');
    return [...all.values()];
  } finally {
    clearTimeout(timer);
  }
}
