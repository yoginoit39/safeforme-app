import type { Nutriments, ProductData, ProductKind } from '../types';
import { knownFromParse, parseIngredients } from '../ingredients';
import { buildTranslation, idToEnglish, looksLikeIngredients, recognisedIds } from '../lang';
import { lookupDsld } from './dsld';
import { lookupUsda } from './usda';

/**
 * Product lookup. Free, no key. Results cached in memory for the session.
 * Open Food Facts and its sister databases for cosmetics and pet food share one API.
 */

export const HOSTS: Record<ProductKind, string> = {
  food: 'https://world.openfoodfacts.org',
  beauty: 'https://world.openbeautyfacts.org',
  petfood: 'https://world.openpetfoodfacts.org',
  supplement: 'https://world.openfoodfacts.org',
};
const SOURCES = { food: 'openfoodfacts', beauty: 'openbeautyfacts', petfood: 'openpetfoodfacts', supplement: 'openfoodfacts' } as const;

const BASE_FIELDS = [
  'product_name', 'brands', 'quantity', 'image_small_url', 'image_front_url', 'ingredients_text', 'ingredients_text_en', 'lc', 'ingredients',
  'allergens_tags', 'traces_tags', 'labels_tags', 'nutriscore_grade', 'nova_group', 'nutriments', 'categories_tags', 'countries_tags', 'last_image_t', 'last_modified_t', 'ingredients_n', 'unknown_ingredients_n',
];
const fieldsFor = (lang: string) => [...BASE_FIELDS, `product_name_${lang}`, `ingredients_text_${lang}`].join(',');

let lang = 'en';
/** Sets the language for product names and ingredient lists. Clears the session cache. */
export function setLookupLang(code: string): void {
  if (code === lang) return;
  lang = code;
  cache.clear();
}

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

export function mapOffProduct(barcode: string, p: Record<string, any>, kind: ProductKind = 'food', userLang = 'en'): ProductData {
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
  const original = str(p.ingredients_text);
  const localized = str(p[`ingredients_text_${userLang}`]);
  const all = [original, str(p.ingredients_text_en), localized].filter((t): t is string => !!t);
  // Marketing copy pasted into the ingredients box is not an ingredient list: treat it as missing.
  const texts = all.filter(looksLikeIngredients);
  const ingredientsText = [...new Set(texts)].join(' ; ') || undefined;
  const good = (t: string | undefined) => (t && texts.includes(t) ? t : undefined);
  const productLang = str(p.lc)?.slice(0, 2).toLowerCase();
  const ingredientsShown = good(localized) ?? good(original) ?? texts[0];
  const ingredientsLang = !ingredientsShown ? undefined : ingredientsShown === localized ? userLang : ingredientsShown === original ? productLang : 'en';
  // English names come straight from the database's own ingredient ids; other languages need one more request.
  const ingredientsTranslated =
    ingredientsShown && ingredientsLang !== userLang && userLang === 'en' ? buildTranslation(p.ingredients, idToEnglish) : undefined;

  // The database's own parse tells real ingredient names from packaging small print typed after them.
  const list = ingredientsShown ? parseIngredients(ingredientsShown, knownFromParse(p.ingredients)) : null;

  const grade = str(p.nutriscore_grade)?.toLowerCase();
  const nova = num(p.nova_group);

  return {
    barcode,
    name: str(p[`product_name_${userLang}`]) ?? str(p.product_name) ?? 'Unnamed product',
    brand: str(p.brands)?.split(',')[0].trim(),
    imageUrl: str(p.image_small_url),
    imageFullUrl: str(p.image_front_url)?.startsWith('https://') ? str(p.image_front_url) : undefined,
    ingredientsText,
    ingredientsShown,
    ingredientsLang,
    ingredientsTranslated,
    ingredientItems: list?.items.length ? list.items : undefined,
    ingredientNotes: list?.notes.length ? list.notes : undefined,
    ingredientAdditives: list?.additives.length ? list.additives : undefined,
    userLang,
    badIngredients: all.length > 0 && texts.length === 0 ? true : undefined,
    allergens: stripPrefix(p.allergens_tags),
    traces: stripPrefix(p.traces_tags),
    labels: stripPrefix(p.labels_tags),
    nutriscoreGrade: grade && /^[a-e]$/.test(grade) ? grade : undefined,
    novaGroup: nova,
    nutriments: hasNutriments ? nutriments : undefined,
    categories: stripPrefix(p.categories_tags),
    countries: stripPrefix(p.countries_tags).slice(0, 6),
    // The last label photo is the best sign of how fresh the entry is; edits can be automatic.
    dataDate: (num(p.last_image_t) ?? num(p.last_modified_t)) ? (num(p.last_image_t) ?? num(p.last_modified_t))! * 1000 : undefined,
    ingredientLangs: [good(original) ? productLang : undefined, good(str(p.ingredients_text_en)) ? 'en' : undefined, good(localized) ? userLang : undefined].filter((l): l is string => !!l).filter((l, i, a) => a.indexOf(l) === i),
    unknownShare: num(p.ingredients_n) && num(p.ingredients_n)! >= 5 && num(p.unknown_ingredients_n) !== undefined ? num(p.unknown_ingredients_n)! / num(p.ingredients_n)! : undefined,
    kind: kind === 'food' && isSupplement(stripPrefix(p.categories_tags), str(p.product_name) ?? '') ? 'supplement' : kind,
    source: SOURCES[kind],
  };
}

/** Open Food Facts files supplements under food, and files some cereal bars under supplements. */
export function isSupplement(categories: string[], name: string): boolean {
  const c = categories.join(' ');
  if (!/dietary-supplements|food-supplements|vitamins|protein-powders|bodybuilding-supplements|mineral-supplements|sports-nutrition-supplements|whey/.test(c)) return false;
  if (/cereal|breakfast|biscuit|snack|bars|chocolate|beverages|drinks|yogurt|dairies|meals/.test(c) && !/protein-powders|capsules|tablets|vitamins/.test(c)) return false;
  return !/\b(bar|cookie|cereal|muesli|granola)\b/i.test(name);
}

/** Why a lookup failed, so the app can say something useful. */
export class LookupError extends Error {
  constructor(readonly kind: 'busy' | 'network') {
    super(kind);
  }
}

const TIMEOUT_MS = 12_000;
const inFlight = new Map<string, Promise<LookupResult>>();

async function request(barcode: string, kind: ProductKind = 'food'): Promise<LookupResult> {
  const url = `${HOSTS[kind]}/api/v2/product/${encodeURIComponent(barcode)}.json?fields=${fieldsFor(lang)}`;
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
  if (json?.status !== 1 || !json.product) return { status: 'not-found' };
  const product = mapOffProduct(barcode, json.product, kind, lang);
  if (lang !== 'en' && product.ingredientsShown && product.ingredientsLang !== lang) {
    product.ingredientsTranslated = await translate(json.product.ingredients, kind, lang).catch(() => undefined);
  }
  return { status: 'found', product };
}

/** Asks the database for its own names of the recognised ingredients in the user's language. */
async function translate(ingredients: unknown, kind: ProductKind, to: string): Promise<string | undefined> {
  const { ids, total } = recognisedIds(ingredients);
  const known = [...new Set(ids.filter(Boolean))].slice(0, 60);
  if (!total || known.length / total < 0.7) return undefined; // not worth a request
  const url = `${HOSTS[kind]}/api/v2/taxonomy?tagtype=ingredients&tags=${encodeURIComponent(known.join(','))}&fields=name&lc=${to}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(url, { referrerPolicy: 'no-referrer', signal: controller.signal });
    if (!res.ok) return undefined;
    const names = (await res.json()) as Record<string, { name?: Record<string, string> }>;
    return buildTranslation(ingredients, (id) => names?.[id]?.name?.[to]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Not a food in Open Food Facts: ask the cosmetics and pet food databases together,
 * then the US government's branded food database. A failure in any of these extra
 * sources counts as "not there" rather than an error, since the main lookup worked.
 */
async function lookupElsewhere(barcode: string): Promise<LookupResult> {
  const miss: LookupResult = { status: 'not-found' };
  const [beauty, pet] = await Promise.all([
    request(barcode, 'beauty').catch(() => miss),
    request(barcode, 'petfood').catch(() => miss),
  ]);
  if (beauty.status === 'found') return beauty;
  if (pet.status === 'found') return pet;
  // US supplements: the government label database has every amount per serving.
  const dsld = await lookupDsld(barcode).catch(() => null);
  if (dsld) return { status: 'found', product: dsld };
  const usda = await lookupUsda(barcode).catch(() => null);
  return usda ? { status: 'found', product: usda } : miss;
}

/** Looks a product up in one named database: used when the user picked it from a name search. */
export async function lookupIn(barcode: string, kind: ProductKind): Promise<LookupResult> {
  if (kind === 'food') return lookupBarcode(barcode);
  const key = `${kind}:${barcode}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const result = await request(barcode, kind);
  cache.set(key, result);
  return result;
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
    if (result.status === 'not-found') result = await lookupElsewhere(barcode);
    else if (result.product.kind === 'supplement') {
      // Open Food Facts knows the ingredients; the US label database knows the amounts. Use both.
      const dsld = await lookupDsld(barcode).catch(() => null);
      if (dsld?.supplement) {
        result.product.supplement = dsld.supplement;
        result.product.ingredientsText = [result.product.ingredientsText, dsld.ingredientsText].filter(Boolean).join(' ; ');
      }
    }
    cache.set(barcode, result);
    return result;
  })().finally(() => inFlight.delete(barcode));
  inFlight.set(barcode, job);
  return job;
}
