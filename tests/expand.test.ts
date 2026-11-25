import { describe, expect, it } from 'vitest';
import type { ProductData, Profile } from '../src/types';
import { beautyFlags, computeBeautyVerdict } from '../src/engine/beauty';
import { computePetVerdict, petFoodSpecies } from '../src/engine/pets';
import { mapOffProduct } from '../src/data/off';
import { mapUsdaFood } from '../src/data/usda';

const profile = (p: Partial<Profile> = {}): Profile => ({ allergies: [], rules: [], watch: [], goal: 'none', skin: [], ...p });
const product = (p: Partial<ProductData>): ProductData => ({ name: 'Test', allergens: [], traces: [], labels: [], source: 'openfoodfacts', ...p });
const cream = (ingredientsText?: string, extra: Partial<ProductData> = {}) =>
  product({ kind: 'beauty', source: 'openbeautyfacts', ingredientsText, ...extra });

describe('cosmetics check', () => {
  it('no ingredient list → CHECK THE LABEL, never safe', () => {
    expect(computeBeautyVerdict(cream(), profile()).level).toBe('unknown');
  });

  it('a plain product with an empty profile raises no flags', () => {
    const p = cream('Aqua, Glycerin, Cetearyl Alcohol, Tocopherol');
    expect(computeBeautyVerdict(p, profile()).level).toBe('safe');
    expect(beautyFlags(p)).toEqual([]);
  });

  it('fatty alcohols are not treated as drying alcohol', () => {
    const p = cream('Aqua, Cetyl Alcohol, Stearyl Alcohol, Benzyl Alcohol, Arachidyl Alcohol');
    const v = computeBeautyVerdict(p, profile({ skin: ['no-alcohol', 'sensitive'] }));
    expect(v.warnings.join(' ')).not.toMatch(/alcohol —|on your avoid list/);
  });

  it('real alcohol is caught for an avoid list', () => {
    const v = computeBeautyVerdict(cream('Alcohol Denat., Aqua, Parfum'), profile({ skin: ['no-alcohol'] }));
    expect(v.reasons.join(' ')).toContain('alcohol');
    expect(v.level).toBe('caution');
  });

  it('mercury or hydroquinone → NOT SAFE for anyone', () => {
    expect(computeBeautyVerdict(cream('Petrolatum, Mercurous Chloride'), profile()).level).toBe('not-safe');
    expect(computeBeautyVerdict(cream('Aqua, Hydroquinone 2%'), profile()).level).toBe('not-safe');
  });

  it('an EU-banned ingredient is "not ideal" with the reason named, never "no red flags"', () => {
    const p = cream('Aqua, Butylphenyl Methylpropional');
    const v = computeBeautyVerdict(p, profile());
    expect(v.level).toBe('caution');
    expect(v.reasons[0]).toContain('Lilial');
    expect(beautyFlags(p)[0]).toMatchObject({ severity: 'restricted', source: 'EU Regulation 2021/1902' });
  });

  it('fragrance allergy + perfume → NOT SAFE', () => {
    expect(computeBeautyVerdict(cream('Aqua, Parfum'), profile({ skin: ['fragrance'] })).level).toBe('not-safe');
    expect(computeBeautyVerdict(cream('Aqua, Linalool'), profile({ skin: ['fragrance'] })).level).toBe('not-safe');
    expect(computeBeautyVerdict(cream('Aqua, Glycerin'), profile({ skin: ['fragrance'] })).level).toBe('safe');
  });

  it('food allergies are matched by their Latin names', () => {
    const p = cream('Aqua, Arachis Hypogaea Oil, Prunus Amygdalus Dulcis Oil');
    expect(computeBeautyVerdict(p, profile({ allergies: ['peanuts'] })).reasons[0]).toContain('peanut');
    expect(computeBeautyVerdict(p, profile({ allergies: ['tree-nuts'] })).level).toBe('not-safe');
    expect(computeBeautyVerdict(p, profile({ allergies: ['sesame'] })).level).toBe('safe');
  });

  it('pregnancy + retinol → NOT SAFE; vegan + beeswax → NOT SAFE', () => {
    expect(computeBeautyVerdict(cream('Aqua, Retinol'), profile({ rules: ['pregnancy'] })).level).toBe('not-safe');
    expect(computeBeautyVerdict(cream('Aqua, Cera Alba'), profile({ rules: ['vegan'] })).level).toBe('not-safe');
    expect(computeBeautyVerdict(cream('Aqua, Cocos Nucifera Oil'), profile({ rules: ['vegan'] })).level).toBe('safe');
  });

  it('halal without certification is never SAFE', () => {
    expect(computeBeautyVerdict(cream('Aqua, Glycerin'), profile({ rules: ['halal'] })).level).toBe('unknown');
    expect(computeBeautyVerdict(cream('Aqua, Glycerin', { labels: ['halal'] }), profile({ rules: ['halal'] })).level).toBe('safe');
  });
});

describe('pet check', () => {
  const food = (ingredientsText?: string, extra: Partial<ProductData> = {}) => product({ ingredientsText, ...extra });

  it('no ingredients → CHECK THE LABEL', () => {
    expect(computePetVerdict(food(), 'dog').level).toBe('unknown');
  });

  it.each(['milk chocolate', 'cocoa powder', 'xylitol', 'raisins', 'onion powder', 'garlic', 'rum', 'coffee extract'])('%s is toxic to dogs and cats', (ing) => {
    expect(computePetVerdict(food(`flour, ${ing}, salt`), 'dog').level).toBe('not-safe');
    expect(computePetVerdict(food(`flour, ${ing}, salt`), 'cat').level).toBe('not-safe');
  });

  it('look-alikes are not flagged', () => {
    const v = computePetVerdict(food('cocoa butter, grapeseed oil, grapefruit, blackcurrant, wine vinegar'), 'dog');
    expect(v.level).not.toBe('not-safe');
  });

  it('macadamia is flagged for dogs only; propylene glycol for cats only', () => {
    expect(computePetVerdict(food('macadamia nuts'), 'dog').level).toBe('not-safe');
    expect(computePetVerdict(food('macadamia nuts'), 'cat').level).not.toBe('not-safe');
    expect(computePetVerdict(food('propylene glycol'), 'cat').level).toBe('not-safe');
    expect(computePetVerdict(food('propylene glycol'), 'dog').level).not.toBe('not-safe');
  });

  it('human food with no toxin found is never SAFE for a pet', () => {
    const v = computePetVerdict(food('wheat flour, water, salt'), 'dog');
    expect(v.level).toBe('unknown');
    expect(v.reasons[0]).toContain('human food');
  });

  it('pet food with no toxin found is SAFE; wrong animal is NOT SAFE', () => {
    const dogFood = food('chicken, rice', { kind: 'petfood', categories: ['dog-food'] });
    expect(petFoodSpecies(dogFood)).toBe('dog');
    // Real database tags include an umbrella 'dog-and-cat-food' next to the specific one.
    expect(petFoodSpecies(product({ kind: 'petfood', categories: ['en:dog-and-cat-food', 'en:dog-food'] }))).toBe('dog');
    expect(petFoodSpecies(product({ kind: 'petfood', categories: ['en:dog-and-cat-food', 'en:cat-food'] }))).toBe('cat');
    expect(computePetVerdict(dogFood, 'dog').level).toBe('safe');
    expect(computePetVerdict(dogFood, 'cat').level).toBe('not-safe');
  });
});

describe('data sources', () => {
  it('maps a cosmetics record with its kind and source', () => {
    const p = mapOffProduct('123456', { product_name: 'Cream', ingredients_text: 'Aqua' }, 'beauty');
    expect(p).toMatchObject({ kind: 'beauty', source: 'openbeautyfacts', ingredientsText: 'Aqua' });
    expect(mapOffProduct('123456', { product_name: 'Rice' })).toMatchObject({ kind: 'food', source: 'openfoodfacts' });
  });

  it('maps a USDA branded food: per-100g nutrients, sodium → salt', () => {
    const p = mapUsdaFood('016000275287', {
      description: 'CHEERIOS CEREAL', brandName: 'CHEERIOS', ingredients: 'WHOLE GRAIN OATS, CORN STARCH, SUGAR, SALT.',
      foodNutrients: [
        { nutrientId: 1003, value: 12.8 }, { nutrientId: 1004, value: 6.41 }, { nutrientId: 1005, value: 74.4 }, { nutrientId: 1008, value: 359 },
        { nutrientId: 2000, value: 5.13 }, { nutrientId: 1079, value: 10.3 }, { nutrientId: 1093, value: 487 }, { nutrientId: 1258, value: 1.28 },
      ],
    });
    expect(p).toMatchObject({ name: 'Cheerios Cereal', brand: 'Cheerios', source: 'usda', kind: 'food' });
    expect(p.nutriments).toMatchObject({ protein: 12.8, fat: 6.41, carbs: 74.4, kcal: 359, sugars: 5.13, fiber: 10.3, saturatedFat: 1.28 });
    expect(p.nutriments!.salt).toBeCloseTo(1.2175, 4);
    expect(p.ingredientsText).toContain('OATS');
  });
});
