import { describe, expect, it } from 'vitest';
import type { ProductData } from '../src/types';
import { EMPTY_PROFILE } from '../src/types';
import { computeScore } from '../src/engine/score';
import { computeVerdict } from '../src/engine/verdict';
import { pickAlternatives } from '../src/engine/alternatives';
import { shelvesFor } from '../src/data/alternatives';

const SODA = ['beverages-and-beverages-preparations', 'beverages', 'non-alcoholic-beverages', 'soft-drinks', 'carbonated-drinks', 'flavoured-soft-drinks', 'sodas', 'colas'];
const p = (x: Partial<ProductData>): ProductData => ({
  name: 'X', allergens: [], traces: [], labels: [], source: 'openfoodfacts', kind: 'food', imageUrl: 'https://images.openfoodfacts.org/x.jpg',
  ingredientLangs: ['en'], popularity: 40, unknownShare: 0, categories: SODA.slice(0, 5), ...x,
});
const coke = p({ barcode: '1', name: 'Coca-Cola', categories: SODA, nutriscoreGrade: 'e', novaGroup: 4, nutriments: { sugars: 10.6, salt: 0 },
  ingredientsText: 'carbonated water, sugar, colour (caramel E150d), phosphoric acid, natural flavourings including caffeine' });
const ctx = (profile = EMPTY_PROFILE) => ({
  scoreOf: (c: ProductData) => computeScore(c, profile)?.value,
  passes: (c: ProductData) => computeVerdict(c, profile).level === 'safe',
});
const pick = (cands: ProductData[], profile = EMPTY_PROFILE) => pickAlternatives(coke, cands, ctx(profile)).map((a) => a.product.name);

const seltzer = p({ barcode: '2', name: 'Lime sparkling water', brand: 'Fizz', nutriscoreGrade: 'b', novaGroup: 1, nutriments: { sugars: 0, salt: 0 }, ingredientsText: 'carbonated water, natural lime essence' });

describe('healthier options: what you reported', () => {
  it('"Stuffed mushrooms" filed under a cola barcode is never suggested for a drink', () => {
    const mushrooms = p({ barcode: '3', name: 'Stuffed mushrooms', brand: 'Freeway', categories: SODA, nutriscoreGrade: 'b', nutriments: { sugars: 1, salt: 0 },
      ingredientsText: 'portabella mushrooms, cooked chorizo (pork, white vinegar, chili powder), corn, roasted red bell peppers, pepper jack cheese, onions, cilantro' });
    expect(pick([mushrooms, seltzer])).toEqual(['Lime sparkling water']);
  });

  it('a diet soda is not a "healthier option": sweeteners swapped in for sugar do not count', () => {
    const diet = p({ barcode: '4', name: 'Diet Mountain Dew', brand: 'Mountain Dew', categories: SODA, nutriscoreGrade: 'b', novaGroup: 4, nutriments: { sugars: 0, salt: 0.02 },
      ingredientsText: 'carbonated water, concentrated orange juice, citric acid, natural flavor, aspartame, acesulfame potassium, caffeine' });
    expect(pick([diet])).toEqual([]);
  });

  it('an energy or protein drink is a different shelf', () => {
    const energy = p({ barcode: '5', name: 'Orange Dream Energy', categories: [...SODA.slice(0, 5), 'energy-drinks'], nutriscoreGrade: 'b', nutriments: { sugars: 0 }, ingredientsText: 'carbonated water, whey protein isolate, natural flavors' });
    expect(pick([energy])).toEqual([]);
  });

  it('an obscure entry almost nobody has scanned is not trusted', () => {
    expect(pick([{ ...seltzer, popularity: 1 }])).toEqual([]);
    expect(pick([{ ...seltzer, popularity: undefined }])).toEqual([]);
  });

  it('every suggestion says what is better, in plain words', () => {
    const [alt] = pickAlternatives(coke, [seltzer], ctx());
    expect(alt.reasons).toEqual(['No added sugar', 'NOVA group 1, not 4']); // facts, not "healthier"
    expect(alt.score).toBeGreaterThanOrEqual(60);
  });

  it('a higher score with nothing to point to is not suggested', () => {
    const same = p({ barcode: '6', name: 'Other cola', categories: SODA, nutriscoreGrade: 'b', novaGroup: 4, nutriments: { sugars: 10.2, salt: 0 }, ingredientsText: 'carbonated water, sugar, caramel colour, caffeine' });
    expect(pick([same])).toEqual([]);
  });

  it('nothing is suggested that the profile would reject, or that cannot be checked', () => {
    const milky = p({ barcode: '7', name: 'Sparkling milk drink', nutriscoreGrade: 'b', novaGroup: 3, nutriments: { sugars: 3 }, ingredientsText: 'water, skimmed milk, fruit juice' });
    expect(pick([milky])).toEqual(['Sparkling milk drink']);
    expect(pick([milky], { ...EMPTY_PROFILE, allergies: ['milk'] })).toEqual([]);
    expect(pick([{ ...seltzer, ingredientsText: undefined }])).toEqual([]);
    expect(pick([{ ...seltzer, imageUrl: undefined }])).toEqual([]);
  });

  it('one suggestion per brand, and never the scanned product itself', () => {
    const lemon = { ...seltzer, barcode: '8', name: 'Lemon sparkling water' };
    expect(pick([seltzer, lemon, { ...seltzer, barcode: '1' }])).toHaveLength(1);
  });

  it('looks on the nearest shelves, never the whole drinks aisle', () => {
    expect(shelvesFor(coke)).toEqual(['colas', 'sodas', 'carbonated-drinks']);
    expect(shelvesFor(p({ categories: ['snacks'] }))).toEqual(['snacks']);
    expect(shelvesFor(p({ categories: [] }))).toEqual([]);
  });
});
