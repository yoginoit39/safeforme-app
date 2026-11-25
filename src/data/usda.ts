import type { Nutriments, ProductData } from '../types';

/**
 * USDA FoodData Central: the US government's database of branded foods (public domain).
 * Used only when a barcode is in none of the Open Food Facts databases.
 * It needs a free api.data.gov key, supplied at build time as VITE_USDA_KEY.
 * Without one this source is simply skipped.
 */

const KEY: string = import.meta.env.VITE_USDA_KEY ?? '';
export const usdaEnabled = () => KEY.length > 0;

/** USDA nutrient numbers → our fields. Branded food values are per 100 g. */
const NUTRIENTS: Record<number, keyof Nutriments> = {
  2000: 'sugars', 1258: 'saturatedFat', 1004: 'fat', 1003: 'protein', 1079: 'fiber', 1008: 'kcal', 1005: 'carbs', 1057: 'caffeine',
};

const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s(/-])\p{L}/gu, (c) => c.toUpperCase());

export function mapUsdaFood(barcode: string, f: Record<string, any>): ProductData {
  const nutriments: Nutriments = {};
  for (const n of Array.isArray(f.foodNutrients) ? f.foodNutrients : []) {
    const value = typeof n?.value === 'number' && Number.isFinite(n.value) ? n.value : undefined;
    if (value === undefined) continue;
    const field = NUTRIENTS[Number(n.nutrientId)];
    if (field) nutriments[field] = field === 'caffeine' ? value / 1000 : value; // caffeine is listed in mg
    if (Number(n.nutrientId) === 1093) nutriments.salt = (value * 2.5) / 1000; // sodium mg → salt g
  }
  const ingredients = typeof f.ingredients === 'string' && f.ingredients.trim() ? f.ingredients.trim() : undefined;
  const name = typeof f.description === 'string' && f.description.trim() ? titleCase(f.description.trim()) : 'Unnamed product';
  const brand = [f.brandName, f.brandOwner].find((b) => typeof b === 'string' && b.trim());
  return {
    barcode,
    name,
    brand: brand ? titleCase(String(brand).trim()) : undefined,
    ingredientsText: ingredients,
    allergens: [], // USDA has no allergen tags: allergens are found by reading the ingredient list
    traces: [],
    labels: [],
    nutriments: Object.keys(nutriments).length ? nutriments : undefined,
    kind: 'food',
    source: 'usda',
  };
}

/** USDA stores barcodes zero-padded to 14 digits (GTIN-14), or as printed. */
export async function lookupUsda(barcode: string): Promise<ProductData | null> {
  if (!usdaEnabled()) return null;
  const candidates = [...new Set([barcode.padStart(14, '0'), barcode, barcode.padStart(12, '0')])];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    for (const gtin of candidates) {
      const url = `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(`gtinUpc:${gtin}`)}&dataType=Branded&pageSize=1`;
      const res = await fetch(url, { headers: { 'X-Api-Key': KEY }, referrerPolicy: 'no-referrer', signal: controller.signal });
      if (!res.ok) return null;
      const food = (await res.json())?.foods?.[0];
      if (food && String(food.gtinUpc ?? '').replace(/^0+/, '') === barcode.replace(/^0+/, '')) return mapUsdaFood(barcode, food);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}
