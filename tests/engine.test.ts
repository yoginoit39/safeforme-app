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
  it("no ingredients and no allergen tags → CHECK THE LABEL, even with an empty profile", () => {
    expect(computeVerdict(product({}), EMPTY_PROFILE).level).toBe('unknown');
    expect(computeVerdict(product({ ingredientsText: '   ' }), profile({ allergies: ['milk'] })).level).toBe('unknown');
  });

  it('allergen tags but no ingredient list → diet rules cannot be confirmed', () => {
    const v = computeVerdict(product({ allergens: ['gluten'] }), profile({ rules: ['vegan'] }));
    expect(v.level).toBe('unknown');
  });
});

describe('verdict: rules', () => {
  it("halal + no certification + clean ingredients → CHECK THE LABEL", () => {
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

  it("halal + gelatin of unknown source → CHECK THE LABEL naming gelatin", () => {
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

  it('diabetes + cola: the score drops AND the verdict is "not ideal", never SAFE', () => {
    const base = computeScore(cola, EMPTY_PROFILE)!.value;
    const s = computeScore(cola, profile({ watch: ['diabetes'] }))!;
    expect(s.value).toBe(base - 10);
    expect(s.reasons.join(' ')).toMatch(/high sugar for your sugar watch/);
    const v = computeVerdict(cola, profile({ watch: ['diabetes'] }));
    expect(v.level).toBe('caution');
    expect(v.reasons[0]).toBe('High in sugar for diabetes — 10.6g per 100g, about 2.5 teaspoons.');
    // Someone with no sugar watch still gets SAFE; so does a diabetic with plain oats.
    expect(computeVerdict(cola, EMPTY_PROFILE).level).toBe('safe');
    expect(computeVerdict(oats, profile({ watch: ['diabetes'] })).level).toBe('safe');
  });

  it('low salt, cholesterol and low carb needs also turn SAFE into "not ideal"', () => {
    const p = product({ ingredientsText: 'potatoes, oil, salt', nutriments: { salt: 1.8, saturatedFat: 12, carbs: 55 } });
    expect(computeVerdict(p, profile({ watch: ['low-salt'] })).reasons[0]).toMatch(/Very salty for a low-salt diet — 1.8g/);
    expect(computeVerdict(p, profile({ watch: ['cholesterol'] })).level).toBe('caution');
    expect(computeVerdict(p, profile({ watch: ['low-carb'] })).level).toBe('caution');
    expect(computeVerdict(p, EMPTY_PROFILE).level).toBe('safe');
  });

  it('an allergy still wins over a health need', () => {
    const v = computeVerdict(cookies, profile({ allergies: ['peanuts'], watch: ['diabetes'] }));
    expect(v.level).toBe('not-safe');
  });

  it('an ingredient the user typed into their avoid list is caught as a whole word', () => {
    const drink = product({ ingredientsText: 'water, citric acid, sucralose, flavouring' });
    const v = computeVerdict(drink, profile({ avoidCustom: ['sucralose'] }));
    expect(v.level).toBe('caution');
    expect(v.reasons[0]).toBe('Contains sucralose — you chose to avoid it.');
    expect(computeVerdict(drink, profile({ avoidCustom: ['rice'] })).level).toBe('safe'); // not inside "citric"
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

  it('label photo: traces stay traces, and odd nutrition field names are still read', () => {
    const p = mapPhotoJson({
      product_name: 'Biscuits', ingredients_text: 'Wheat flour, sugar, peanuts. May contain traces of nuts and sesame.',
      allergens: ['gluten', 'peanuts'], traces: ['nuts', 'sesame', 'peanuts'],
      nutriments_per_100g: { sugars: 28, salt: '0,6', saturated_fat: 9, fat: 24, protein: 8, kcal: 480 },
    });
    expect(p.allergens).toEqual(['gluten', 'peanuts']);
    expect(p.traces).toEqual(['nuts', 'sesame-seeds']);
    expect(p.nutriments).toMatchObject({ sugars: 28, salt: 0.6, saturatedFat: 9, fat: 24, protein: 8, kcal: 480 });
    expect(computeVerdict(p, profile({ allergies: ['tree-nuts'] })).reasons[0]).toBe('May contain traces of tree nuts.');
  });

  it("an unreadable photo is CHECK THE LABEL, never SAFE", () => {
    const p = mapPhotoJson({ product_name: null, ingredients_text: null, allergens: [] });
    expect(computeVerdict(p, EMPTY_PROFILE).level).toBe('unknown');
  });

  it('normalizes free-form allergen names', () => {
    expect(normalizeAllergenName('Eggs')).toBe('eggs');
    expect(normalizeAllergenName('wheat')).toBe('gluten');
    expect(normalizeAllergenName('Sesame seeds')).toBe('sesame-seeds');
  });
});

describe('a product with no ingredient list is still read by its name and category', () => {
  const bare = (name: string, categories: string[] = []) => product({ name, categories, ingredientsText: undefined });
  const veg = profile({ rules: ['vegetarian'] });
  const vegan = profile({ rules: ['vegan'] });

  it('vegetarian: "pork sausages" and "beef jerky" are flagged, not left as "check the label"', () => {
    // The two real entries that came back "Check the label" for a vegetarian.
    const sausages = computeVerdict(bare('Original pork sausages', ['meats-and-their-products', 'sausages']), veg);
    expect(sausages.level).toBe('not-safe');
    expect(sausages.reasons[0]).toBe('Sold as “pork” (from its name or category) — not vegetarian.');
    expect(computeVerdict(bare('Beef Cake jerky'), veg).level).toBe('not-safe');
    expect(computeVerdict(bare('Smoked salmon slices', ['seafood', 'fishes']), veg).level).toBe('not-safe');
    // The category alone is enough.
    expect(computeVerdict(bare('Classic recipe', ['meats', 'prepared-meats', 'hams']), veg).level).toBe('not-safe');
  });

  it('vegan: cheese, yogurt, eggs and honey by name', () => {
    for (const name of ['Mature cheddar cheese', 'Greek yogurt', 'Free range eggs', 'Clear honey', 'Whole milk']) {
      expect(computeVerdict(bare(name), vegan).level, name).toBe('not-safe');
    }
  });

  it('halal and kosher: pork by name; wine for halal; prawns for kosher', () => {
    expect(computeVerdict(bare('Smoked bacon rashers'), profile({ rules: ['halal'] })).level).toBe('not-safe');
    expect(computeVerdict(bare('Red wine', ['alcoholic-beverages', 'wines']), profile({ rules: ['halal'] })).level).toBe('not-safe');
    expect(computeVerdict(bare('King prawns'), profile({ rules: ['kosher'] })).level).toBe('not-safe');
  });

  it('allergy: an allergen in the name is a warning when the list is missing', () => {
    const v = computeVerdict(bare('Crunchy peanut butter'), profile({ allergies: ['peanuts'] }));
    expect(v.level).toBe('not-safe');
    expect(v.reasons[0]).toMatch(/The name says “peanut”, which points to peanuts\. The ingredient list isn't in the database/);
    expect(computeVerdict(bare('Milk chocolate bar'), profile({ allergies: ['milk'] })).level).toBe('not-safe');
  });

  it('does not mistake look-alikes for the real thing', () => {
    // Eggs are vegetarian even though the category says "chicken eggs".
    expect(computeVerdict(bare('Large eggs', ['eggs', 'chicken-eggs']), veg).level).toBe('unknown');
    // Stand-ins name the thing they replace.
    for (const name of ['Vegetarian sausages', 'Vegan bacon style rashers', 'Plant-based chicken pieces', 'Meat-free mince', 'Chicken flavour crisps']) {
      expect(computeVerdict(bare(name), veg).level, name).toBe('unknown');
    }
    expect(computeVerdict(bare('Oat milk alternative', ['plant-based-milk-alternatives']), vegan).level).toBe('unknown');
    expect(computeVerdict(bare('Dairy free coconut yogurt'), vegan).level).toBe('unknown');
    // Words inside other words.
    expect(computeVerdict(bare('Hamburger buns'), veg).level).toBe('unknown');
    expect(computeVerdict(bare('Butter beans'), vegan).level).toBe('unknown');
    expect(computeVerdict(bare('Ginger beer'), profile({ rules: ['halal'] })).level).toBe('unknown');
  });

  it('a name never clears a product, and never overrides a full ingredient list', () => {
    // Nothing in the name: still "check the label", never "nothing flagged".
    expect(computeVerdict(bare('Family dinner'), veg).level).toBe('unknown');
    // A name that contradicts the list is never waved through: "Sun Sausage" is really pea protein,
    // but "Shrimp & cocktail sauce" listed as only its sauce is really shrimp. The app can't tell
    // which, so it says "check the label" for both rather than risk the second.
    const sun = product({ name: 'Sun Sausage', categories: ['sausages'], ingredientsText: 'water, yellow pea protein, avocado oil, dried pineapple, spices' });
    expect(computeVerdict(sun, veg).level).toBe('unknown');
    const shrimp = product({ name: 'Shrimp & cocktail sauce', ingredientsText: 'tomato paste, water, horseradish, vinegar, salt, spices' });
    expect(computeVerdict(shrimp, veg).level).toBe('unknown');
    expect(computeVerdict(shrimp, veg).reasons[0]).toMatch(/The name says “shrimp”, but the ingredient list in the database doesn't mention it/);
    expect(computeVerdict(shrimp, profile({ rules: ['kosher'] })).reasons.join(' ')).not.toMatch(/No pork or shellfish was found/);
    // A stand-in that says so in its name is still judged on its list.
    const veggie = product({ name: 'Vegetarian sausages', ingredientsText: 'water, pea protein, sunflower oil, spices' });
    expect(computeVerdict(veggie, veg).level).toBe('safe');
    // No list at all: lactose and coeliac read the name too.
    expect(computeVerdict(bare('Whole milk', ['dairies', 'milks']), profile({ rules: ['lactose'] })).level).toBe('not-safe');
    expect(computeVerdict(bare('Wheat crackers'), profile({ rules: ['celiac'] })).level).toBe('not-safe');
    expect(computeVerdict(bare('Buckwheat noodles'), profile({ rules: ['celiac'] })).level).toBe('unknown');
    // An ice cream listed as only its wafer is not clean for a milk allergy.
    const mochi = product({ name: 'Cookies & cream mochi ice cream', ingredientsText: 'sugar, water, sweet rice flour, egg whites, trehalose, corn starch', ingredientLangs: ['en'] });
    expect(computeVerdict(mochi, profile({ allergies: ['milk'] })).level).toBe('unknown');
    // And when the list does show meat, the list is what is quoted.
    const real = product({ name: 'Pork sausages', ingredientsText: 'pork (72%), water, rusk (wheat), salt' });
    expect(computeVerdict(real, veg).reasons[0]).toMatch(/^Contains /);
  });
});
