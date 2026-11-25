import { describe, expect, it } from 'vitest';
import type { ProductData, Profile } from '../src/types';
import { EMPTY_PROFILE } from '../src/types';
import { allergyNeeds, computeVerdict } from '../src/engine/verdict';
import { mapOffProduct } from '../src/data/off';

/**
 * The failure this guards against, from a real review of another app: a breastfeeding mother with a
 * baby allergic to dairy, soy and egg was told foods were safe when the packs listed those allergens.
 */
const baby: Profile = { ...EMPTY_PROFILE, allergies: ['milk', 'soy', 'egg'] };
const NOW = Date.now();
const YEAR = 365 * 24 * 60 * 60 * 1000;
const food = (p: Partial<ProductData>): ProductData => ({
  name: 'Test', allergens: [], traces: [], labels: [], source: 'openfoodfacts', kind: 'food',
  ingredientsText: 'rice flour, sunflower oil, sugar, salt', ingredientLangs: ['en'], dataDate: NOW - YEAR, unknownShare: 0, ...p,
});

describe('allergy guard', () => {
  it('a clean, fresh, readable list reports what was checked — and never the word "safe"', () => {
    const v = computeVerdict(food({}), baby);
    expect(v.level).toBe('safe');
    expect(v.reasons[0]).toBe('Milk, soy and egg are not in the ingredient list or the allergen tags.');
    expect(v.reasons.join(' ')).not.toMatch(/safe/i);
    expect(v.warnings[0]).toMatch(/^From a volunteer database, last refreshed \w+ \d{4}, not from the pack in your hand\. Makers change recipes: read the pack every time\.$/);
  });

  it('any one of the allergens, in the list or only in the tags, is NOT SAFE', () => {
    expect(computeVerdict(food({ ingredientsText: 'rice flour, whey powder, salt' }), baby).level).toBe('not-safe');
    expect(computeVerdict(food({ ingredientsText: 'rice flour, soya lecithin' }), baby).level).toBe('not-safe');
    expect(computeVerdict(food({ ingredientsText: 'flour, dried egg white' }), baby).level).toBe('not-safe');
    expect(computeVerdict(food({ allergens: ['milk'] }), baby).level).toBe('not-safe'); // tag only, list says nothing
  });

  it('"may contain" is not waved through', () => {
    expect(computeVerdict(food({ traces: ['eggs'] }), baby).level).not.toBe('safe');
    expect(computeVerdict(food({ ingredientsText: 'rice flour, salt. May contain traces of milk.' }), baby).level).not.toBe('safe');
  });

  it('a list in a language the allergen words do not cover is CHECK THE LABEL, not clean', () => {
    const v = computeVerdict(food({ ingredientsText: 'mąka ryżowa, serwatka w proszku, sól', ingredientLangs: ['pl'] }), baby);
    expect(v.level).toBe('unknown');
    expect(v.reasons[0]).toMatch(/only available in Polish.*milk, soy and egg.*Read the pack/);
    // The same product with an English version alongside can be checked.
    expect(computeVerdict(food({ ingredientLangs: ['pl', 'en'] }), baby).level).toBe('safe');
  });

  it('a garbled list is CHECK THE LABEL', () => {
    const v = computeVerdict(food({ unknownShare: 0.8 }), baby);
    expect(v.level).toBe('unknown');
    expect(v.reasons[0]).toMatch(/garbled or incomplete/);
  });

  it('an entry not refreshed for more than five years is CHECK THE LABEL', () => {
    const v = computeVerdict(food({ dataDate: NOW - 6 * YEAR }), baby);
    expect(v.level).toBe('unknown');
    expect(v.reasons[0]).toMatch(/last refreshed in \d{4}\. Recipes change/);
  });

  it('a missing ingredient list is never clean', () => {
    expect(computeVerdict(food({ ingredientsText: undefined }), baby).level).toBe('unknown');
  });

  it('the guard only applies when there is something to guard: no allergy, no change', () => {
    const v = computeVerdict(food({ ingredientLangs: ['pl'], unknownShare: 0.9, dataDate: NOW - 9 * YEAR }), EMPTY_PROFILE);
    expect(v.level).toBe('safe');
    expect(v.reasons[0]).toBe('No problems found for your profile.');
  });

  it('coeliac and lactose intolerance count as needs too', () => {
    expect(allergyNeeds({ ...EMPTY_PROFILE, rules: ['celiac', 'lactose'] })).toEqual(['gluten', 'lactose']);
    expect(allergyNeeds({ ...EMPTY_PROFILE, rules: ['vegan'] })).toEqual([]);
  });

  it('a label photo result says it was read by AI', () => {
    const v = computeVerdict(food({ source: 'photo', dataDate: undefined, ingredientLangs: undefined, unknownShare: undefined }), baby);
    expect(v.reasons[0]).toMatch(/read from your photo/);
    expect(v.warnings[0]).toMatch(/Read from your photo by AI, which can misread small print/);
  });

  it('the database mapping carries the freshness, language and quality signals', () => {
    const p = mapOffProduct('1', { product_name: 'X', lc: 'pl', ingredients_text: 'mąka, cukier, sól', last_image_t: 1500000000, last_modified_t: 1700000000, ingredients_n: 10, unknown_ingredients_n: 7 });
    expect(p.dataDate).toBe(1500000000 * 1000); // the label photo date, not the last edit
    expect(p.ingredientLangs).toEqual(['pl']);
    expect(p.unknownShare).toBe(0.7);
  });
});
