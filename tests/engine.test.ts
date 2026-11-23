import { describe, expect, it } from 'vitest';
import { computeVerdict, findTerm, ALLERGENS, normalizeAllergenName } from '../src/engine/verdict';
import { computeScore } from '../src/engine/score';
import { DEMO_PRODUCTS } from '../src/data/demo';
import { mapOffProduct } from '../src/data/off';
import { mapPhotoJson } from '../src/data/gemini';
import { EMPTY_PROFILE, type ProductData, type Profile } from '../src/types';

const profile = (p: Partial<Profile>): Profile => ({ ...EMPTY_PROFILE, ...p });
const product = (p: Partial<ProductData>): ProductData => ({
  name: 'Test', allergens: [], traces: [], labels: [], source: 'openfoodfacts', ...p,
});
const [cookies, oats, cola] = DEMO_PRODUCTS;

// Shape of the live Open Food Facts record for Nutella (3017620422003), captured at build time.
const nutella = mapOffProduct('3017620422003', {
  product_name: 'Nutella',
  brands: 'Ferrero, Nutella',
  ingredients_text: 'sugar, palm oil',
  ingredients_text_en: 'sugar, palm oil',
  allergens_tags: ['en:milk', 'en:nuts', 'en:soybeans'],
  traces_tags: [],
  labels_tags: ['en:vegetarian', 'en:no-gluten'],
  nutriscore_grade: 'e',
  nova_group: 3,
  nutriments: { sugars_100g: 56.3, salt_100g: 0.107, proteins_100g: 6.3, 'energy-kcal_100g': 539, fat_100g: 30.9 },
});

describe('verdict: allergens', () => {
  it('Nutella is NOT SAFE for a tree-nut allergy and names it', () => {
    const v = computeVerdict(nutella, profile({ allergies: ['tree-nuts'] }));
    expect(v.level).toBe('not-safe');
    expect(v.reasons.join(' ')).toMatch(/tree nuts/);
  });

  it('Nutella with an empty profile is SAFE with a low score and reasons', () => {
    expect(computeVerdict(nutella, EMPTY_PROFILE).level).toBe('safe');
    const s = computeScore(nutella, EMPTY_PROFILE)!;
    expect(s.value).toBe(15);
    expect(s.reasons.length).toBeGreaterThan(0);
  });

  it('peanut cookies are NOT SAFE for a peanut allergy, naming peanuts', () => {
    const v = computeVerdict(cookies, profile({ allergies: ['peanuts'] }));
    expect(v.level).toBe('not-safe');
    expect(v.reasons[0]).toBe('Contains peanuts.');
  });

  it('traces only → NOT SAFE with a distinct "may contain traces" reason', () => {
    const v = computeVerdict(product({ ingredientsText: 'sugar', traces: ['peanuts'] }), profile({ allergies: ['peanuts'] }));
    expect(v.level).toBe('not-safe');
    expect(v.reasons[0]).toBe('May contain traces of peanuts.');
  });

  it('finds allergens in ingredient text when tags are empty', () => {
    const v = computeVerdict(product({ ingredientsText: 'Sugar, whey powder, groundnut oil' }), profile({ allergies: ['milk', 'peanuts'] }));
    expect(v.level).toBe('not-safe');
    expect(v.reasons).toHaveLength(2);
  });

  it('"may contain" text is reported as traces', () => {
    const v = computeVerdict(product({ ingredientsText: 'Sugar, cocoa. May contain milk and nuts.' }), profile({ allergies: ['milk'] }));
    expect(v.reasons[0]).toBe('May contain traces of milk.');
  });

  it('avoids classic false positives', () => {
    const milk = ALLERGENS.find((a) => a.id === 'milk')!;
    const nuts = ALLERGENS.find((a) => a.id === 'tree-nuts')!;
    const gluten = ALLERGENS.find((a) => a.id === 'gluten')!;
    expect(findTerm('sugar, cocoa butter, coconut milk', milk)).toBeNull();
    expect(findTerm('nutmeg, coconut, peanuts', nuts)).toBeNull();
    expect(findTerm('buckwheat, maltodextrin. gluten-free. sans gluten', gluten)).toBeNull();
    expect(findTerm('hazelnuts 13%', nuts)).toBe('hazelnut');
  });
});

describe('verdict: missing data', () => {
  it("no ingredients and no allergen tags → CAN'T CONFIRM, even with an empty profile", () => {
    expect(computeVerdict(product({}), EMPTY_PROFILE).level).toBe('unknown');
    expect(computeVerdict(product({ ingredientsText: '   ' }), profile({ allergies: ['milk'] })).level).toBe('unknown');
  });

  it('allergen tags but no ingredient list → diet rules cannot be confirmed', () => {
    const v = computeVerdict(product({ allergens: ['gluten'] }), profile({ rules: ['vegan'] }));
    expect(v.level).toBe('unknown');
  });
});

describe('verdict: rules', () => {
  it("halal + no certification + clean ingredients → CAN'T CONFIRM", () => {
    const v = computeVerdict(oats, profile({ rules: ['halal'] }));
    expect(v.level).toBe('unknown');
    expect(v.reasons[0]).toMatch(/No halal certification found/);
  });

  it('halal + certification label → SAFE', () => {
    const v = computeVerdict(product({ ingredientsText: 'durum wheat semolina, water', labels: ['halal'] }), profile({ rules: ['halal'] }));
    expect(v.level).toBe('safe');
  });

  it('halal + pork → NOT SAFE (even if a label claims halal)', () => {
    const v = computeVerdict(product({ ingredientsText: 'pork (80%), salt', labels: ['halal'] }), profile({ rules: ['halal'] }));
    expect(v.level).toBe('not-safe');
    expect(v.reasons[0]).toMatch(/pork/);
  });

  it('halal + alcohol → NOT SAFE; wine vinegar is not alcohol', () => {
    expect(computeVerdict(product({ ingredientsText: 'cherries, kirsch, sugar' }), profile({ rules: ['halal'] })).level).toBe('not-safe');
    expect(computeVerdict(product({ ingredientsText: 'white wine vinegar, salt' }), profile({ rules: ['halal'] })).level).toBe('unknown');
  });

  it("halal + gelatin of unknown source → CAN'T CONFIRM naming gelatin", () => {
    const v = computeVerdict(product({ ingredientsText: 'glucose syrup, sugar, gelatine' }), profile({ rules: ['halal'] }));
    expect(v.level).toBe('unknown');
    expect(v.reasons[0]).toMatch(/gelatine of unknown source/);
  });

  it('kosher follows the same certification logic', () => {
    expect(computeVerdict(oats, profile({ rules: ['kosher'] })).level).toBe('unknown');
    expect(computeVerdict(product({ ingredientsText: 'oats', labels: ['kosher-parve'] }), profile({ rules: ['kosher'] })).level).toBe('safe');
  });

  it('vegan flags animal ingredients; vegetarian flags gelatin but not milk', () => {
    expect(computeVerdict(cookies, profile({ rules: ['vegan'] })).level).toBe('not-safe');
    expect(computeVerdict(cookies, profile({ rules: ['vegetarian'] })).level).toBe('safe');
    expect(computeVerdict(product({ ingredientsText: 'sugar, gelatine' }), profile({ rules: ['vegetarian'] })).level).toBe('not-safe');
    expect(computeVerdict(oats, profile({ rules: ['vegan'] })).level).toBe('safe');
  });

  it('pregnancy: alcohol → NOT SAFE; caffeine → SAFE with a warning', () => {
    expect(computeVerdict(product({ ingredientsText: 'cream, rum, sugar' }), profile({ rules: ['pregnancy'] })).level).toBe('not-safe');
    const v = computeVerdict(cola, profile({ rules: ['pregnancy'] }));
    expect(v.level).toBe('safe');
    expect(v.warnings).toContain('Contains caffeine — limit while pregnant.');
  });
});

describe('score', () => {
  it('demo oats score 90 and are SAFE', () => {
    expect(computeScore(oats, EMPTY_PROFILE)!.value).toBe(90);
    expect(computeVerdict(oats, EMPTY_PROFILE).level).toBe('safe');
  });

  it('diabetes drops cola with the sugar-watch reason; verdict stays SAFE', () => {
    const base = computeScore(cola, EMPTY_PROFILE)!.value;
    const s = computeScore(cola, profile({ watch: ['diabetes'] }))!;
    expect(s.value).toBe(base - 10);
    expect(s.reasons.join(' ')).toMatch(/high sugar for your sugar watch/);
    expect(computeVerdict(cola, profile({ watch: ['diabetes'] })).level).toBe('safe');
  });

  it('diabetes + peanut cookies → score 0, clamped', () => {
    expect(computeScore(cookies, profile({ watch: ['diabetes', 'low-sugar'] }))!.value).toBe(0);
  });

  it('applies goal and salt adjustments', () => {
    const p = product({ nutriscoreGrade: 'c', novaGroup: 4, nutriments: { salt: 2, kcal: 450, fat: 25, protein: 22 } });
    expect(computeScore(p, profile({ watch: ['low-salt'] }))!.value).toBe(35);
    expect(computeScore(p, profile({ goal: 'lose-weight' }))!.value).toBe(35);
    expect(computeScore(p, profile({ goal: 'build-muscle' }))!.value).toBe(70);
    expect(computeScore(p, profile({ goal: 'eat-cleaner' }))!.value).toBe(45);
  });

  it('computes a base from nutriments when there is no Nutri-Score', () => {
    const p = product({ nutriments: { sugars: 30, salt: 2, saturatedFat: 6, fiber: 4, protein: 9 } });
    expect(computeScore(p, EMPTY_PROFILE)!.value).toBe(40);
  });

  it('returns null (no fake number) when there is no nutrition data', () => {
    expect(computeScore(product({ ingredientsText: 'water' }), EMPTY_PROFILE)).toBeNull();
  });
});

describe('data mapping', () => {
  it('maps Open Food Facts fields, stripping tag prefixes and deriving salt from sodium', () => {
    const p = mapOffProduct('1', { allergens_tags: ['en:peanuts'], nutriments: { sodium_100g: 0.4 }, nutriscore_grade: 'unknown' });
    expect(p.allergens).toEqual(['peanuts']);
    expect(p.nutriments!.salt).toBeCloseTo(1);
    expect(p.nutriscoreGrade).toBeUndefined();
  });

  it('label-photo JSON runs through the same engines', () => {
    const p = mapPhotoJson({
      product_name: null,
      ingredients_text: 'Sugar, glucose syrup, pork gelatine, flavouring',
      allergens: ['Peanuts', 'tree nuts'],
      nutriments: { sugars: '46', salt: null },
      contains_pork: true, contains_alcohol: false, contains_gelatin: true, halal_certified: null, kosher_certified: null,
    });
    expect(p.source).toBe('photo');
    expect(p.allergens).toEqual(['peanuts', 'nuts']);
    expect(computeVerdict(p, profile({ rules: ['halal'] })).level).toBe('not-safe');
    expect(computeVerdict(p, profile({ allergies: ['peanuts'] })).reasons[0]).toBe('Contains peanuts.');
    expect(computeScore(p, profile({ watch: ['diabetes'] }))!.value).toBe(15);
  });

  it("an unreadable photo is CAN'T CONFIRM, never SAFE", () => {
    const p = mapPhotoJson({ product_name: null, ingredients_text: null, allergens: [] });
    expect(computeVerdict(p, EMPTY_PROFILE).level).toBe('unknown');
  });

  it('normalizes free-form allergen names', () => {
    expect(normalizeAllergenName('Eggs')).toBe('eggs');
    expect(normalizeAllergenName('wheat')).toBe('gluten');
    expect(normalizeAllergenName('Sesame seeds')).toBe('sesame-seeds');
  });
});
