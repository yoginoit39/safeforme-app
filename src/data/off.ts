import type { Nutriments, ProductData } from '../types';

/** Open Food Facts lookup. Free, no key. Results cached in memory for the session. */

const FIELDS = [
  'product_name', 'brands', 'quantity', 'image_small_url', 'ingredients_text', 'ingredients_text_en',
  'allergens_tags', 'traces_tags', 'labels_tags', 'nutriscore_grade', 'nova_group', 'nutriments', 'categories_tags',
].join(',');

export type LookupResult = { status: 'found'; product: ProductData } | { status: 'not-found' };

const cache = new Map<string, LookupResult>();

const num = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
};

const stripPrefix = (tags: unknown): string[] =>
  Array.isArray(tags) ? tags.filter((t): t is string => typeof t === 'string').map((t) => t.replace(/^[a-z]{2,3}:/, '')) : [];

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

export function mapOffProduct(barcode: string, p: Record<string, any>): ProductData {
  const raw = p.nutriments ?? {};
  const sodium = num(raw.sodium_100g);
  const nutriments: Nutriments = {
    sugars: num(raw.sugars_100g),
    salt: num(raw.salt_100g) ?? (sodium !== undefined ? sodium * 2.5 : undefined),
    saturatedFat: num(raw['saturated-fat_100g']),
    fat: num(raw.fat_100g),
    protein: num(raw.proteins_100g),
    fiber: num(raw.fiber_100g),
    kcal: num(raw['energy-kcal_100g']),
    carbs: num(raw.carbohydrates_100g),
    caffeine: num(raw.caffeine_100g),
  };
  const hasNutriments = Object.values(nutriments).some((v) => v !== undefined);

  // The original-language list and the English one can differ in completeness, so search both.
  const texts = [str(p.ingredients_text), str(p.ingredients_text_en)].filter((t): t is string => !!t);
  const ingredientsText = [...new Set(texts)].join(' ; ') || undefined;

  const grade = str(p.nutriscore_grade)?.toLowerCase();
  const nova = num(p.nova_group);

  return {
    barcode,
    name: str(p.product_name) ?? 'Unnamed product',
    brand: str(p.brands)?.split(',')[0].trim(),
    imageUrl: str(p.image_small_url),
    ingredientsText,
    allergens: stripPrefix(p.allergens_tags),
    traces: stripPrefix(p.traces_tags),
    labels: stripPrefix(p.labels_tags),
    nutriscoreGrade: grade && /^[a-e]$/.test(grade) ? grade : undefined,
    novaGroup: nova,
    nutriments: hasNutriments ? nutriments : undefined,
    source: 'openfoodfacts',
  };
}

/** Why a lookup failed, so the app can say something useful. */
export class LookupError extends Error {
  constructor(readonly kind: 'busy' | 'network') {
    super(kind);
  }
}

const TIMEOUT_MS = 12_000;
const inFlight = new Map<string, Promise<LookupResult>>();

async function request(barcode: string): Promise<LookupResult> {
  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=${FIELDS}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS); // never leave the user on a spinner
  let res: Response;
  try {
    res = await fetch(url, { referrerPolicy: 'no-referrer', signal: controller.signal });
  } catch {
    throw new LookupError('network');
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 404) return { status: 'not-found' };
  if (res.status === 429 || res.status === 503) throw new LookupError('busy'); // rate limit / overloaded
  if (!res.ok) throw new LookupError('network');
  let json: any;
  try {
    json = await res.json();
  } catch {
    throw new LookupError('network');
  }
  return json?.status === 1 && json.product
    ? { status: 'found', product: mapOffProduct(barcode, json.product) }
    : { status: 'not-found' };
}

/** Throws LookupError when the product database can't be reached or is rate-limiting. */
export function lookupBarcode(barcode: string): Promise<LookupResult> {
  const cached = cache.get(barcode);
  if (cached) return Promise.resolve(cached);
  const running = inFlight.get(barcode);
  if (running) return running; // a double tap or double read must not send two requests

  const job = (async () => {
    let result: LookupResult;
    try {
      result = await request(barcode);
    } catch (e) {
      if (!(e instanceof LookupError) || e.kind !== 'network') throw e;
      await new Promise((r) => setTimeout(r, 900)); // one quiet retry for a network blip
      result = await request(barcode);
    }
    cache.set(barcode, result);
    return result;
  })().finally(() => inFlight.delete(barcode));
  inFlight.set(barcode, job);
  return job;
}
