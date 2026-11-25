import { describe, expect, it } from 'vitest';
import type { ProductData, Profile, SupplementInfo } from '../src/types';
import { EMPTY_PROFILE } from '../src/types';
import { LIMITS, caffeinePerDay, computeSupplementVerdict, dailyTotals, limitKey, proteinFacts, supplementNotes, toLimitUnit } from '../src/engine/supplements';
import { mapDsldLabel, printedUpc } from '../src/data/dsld';
import { isSupplement } from '../src/data/off';

const profile = (p: Partial<Profile> = {}): Profile => ({ ...EMPTY_PROFILE, ...p });
const supp = (s: Partial<SupplementInfo>, extra: Partial<ProductData> = {}): ProductData => ({
  name: 'Test', allergens: [], traces: [], labels: [], kind: 'supplement', source: 'dsld', ingredientsText: 'cellulose, magnesium stearate',
  supplement: { facts: [], blends: [], perDay: 1, ...s }, ...extra,
});

describe('upper limits table (Health Canada / National Academies)', () => {
  it('holds the published adult, pregnancy, 9–13 and 4–8 values', () => {
    expect(LIMITS.vitaminA.ul).toEqual([3000, 3000, 1700, 900]);
    expect(LIMITS.vitaminD.ul).toEqual([100, 100, 100, 75]);
    expect(LIMITS.vitaminC.ul).toEqual([2000, 2000, 1200, 650]);
    expect(LIMITS.niacin.ul).toEqual([35, 35, 20, 15]);
    expect(LIMITS.vitaminB6.ul).toEqual([100, 100, 60, 40]);
    expect(LIMITS.folate.ul).toEqual([1000, 1000, 600, 400]);
    expect(LIMITS.iron.ul).toEqual([45, 45, 40, 40]);
    expect(LIMITS.zinc.ul).toEqual([40, 40, 23, 12]);
    expect(LIMITS.selenium.ul).toEqual([400, 400, 280, 150]);
    expect(LIMITS.magnesium.ul).toEqual([350, 350, 350, 110]);
    expect(LIMITS.iodine.ul).toEqual([1100, 1100, 600, 300]);
    expect(LIMITS.copper.ul).toEqual([10000, 10000, 5000, 3000]);
  });

  it('matches label names to nutrients by the name, not the form in brackets', () => {
    expect(limitKey('Vitamin D3 (as cholecalciferol)')).toBe('vitaminD');
    expect(limitKey('Calcium (as calcium carbonate)')).toBe('calcium');
    expect(limitKey('Magnesium (as magnesium oxide)')).toBe('magnesium');
    expect(limitKey('Folate (as folic acid)')).toBe('folate');
    expect(limitKey('Ashwagandha root extract')).toBeNull();
    expect(limitKey('Protein')).toBeNull();
  });

  it('converts label units', () => {
    expect(toLimitUnit('vitaminD', 4000, 'IU')).toBe(100); // 40 IU = 1 mcg
    expect(toLimitUnit('vitaminA', 10000, 'IU')).toBeCloseTo(3000); // retinol
    expect(toLimitUnit('vitaminC', 1, 'g')).toBe(1000);
    expect(toLimitUnit('selenium', 0.2, 'mg')).toBe(200);
    expect(toLimitUnit('folate', 1000, 'mcg DFE')).toBe(600);
    expect(toLimitUnit('zinc', 1, 'capsule')).toBeNull(); // unknown unit: never guess
  });
});

describe('dose check', () => {
  const megaD = supp({ facts: [{ name: 'Vitamin D3', amount: 10000, unit: 'IU' }, { name: 'Zinc', amount: 15, unit: 'mg' }] });

  it('flags a vitamin above its safe upper limit as "not ideal", with the numbers', () => {
    const v = computeSupplementVerdict(megaD, profile());
    expect(v.level).toBe('caution');
    expect(v.reasons[0]).toBe('Vitamin D: 250 mcg a day — the safe upper limit is 100 mcg for adults.');
  });

  it('multiplies by the servings a day the label directs', () => {
    const zinc = supp({ perDay: 3, facts: [{ name: 'Zinc', amount: 15, unit: 'mg' }] });
    const [d] = dailyTotals([zinc.supplement!], 'adult', false);
    expect(d.amount).toBe(45);
    expect(d.share).toBeGreaterThan(1);
  });

  it('a normal multivitamin dose is fine for an adult but over the limit for a child', () => {
    const multi = supp({ facts: [{ name: 'Zinc', amount: 15, unit: 'mg' }, { name: 'Vitamin C', amount: 90, unit: 'mg' }] });
    expect(computeSupplementVerdict(multi, profile(), 'adult').level).toBe('safe');
    const child = computeSupplementVerdict(multi, profile(), '4-8');
    expect(child.level).toBe('caution');
    expect(child.reasons[0]).toMatch(/Zinc: 15 mg a day — the safe upper limit is 12 mg for ages 4–8/);
  });

  it('never checks for a child under 4', () => {
    expect(computeSupplementVerdict(megaD, profile(), '2-3').level).toBe('unknown');
  });

  it('too much preformed vitamin A in pregnancy is NOT SAFE; beta-carotene does not count', () => {
    const retinol = supp({ facts: [{ name: 'Vitamin A (as retinyl palmitate)', amount: 5000, unit: 'mcg' }] });
    expect(computeSupplementVerdict(retinol, profile({ rules: ['pregnancy'] })).level).toBe('not-safe');
    expect(computeSupplementVerdict(retinol, profile()).level).toBe('caution');
    const carotene = supp({ facts: [{ name: 'Vitamin A (as beta-carotene)', amount: 5000, unit: 'mcg' }] });
    expect(computeSupplementVerdict(carotene, profile({ rules: ['pregnancy'] })).level).toBe('safe');
  });

  it('adds doses up across several bottles: each is fine, together they pass the limit', () => {
    const a = { perDay: 1, facts: [{ name: 'Vitamin D', amount: 50, unit: 'mcg' }] };
    const b = { perDay: 1, facts: [{ name: 'Vitamin D3', amount: 2000, unit: 'IU' }] };
    const c = { perDay: 1, facts: [{ name: 'Vitamin D', amount: 25, unit: 'mcg' }] };
    expect(dailyTotals([a], 'adult', false)[0].share).toBeLessThan(1);
    const total = dailyTotals([a, b, c], 'adult', false)[0];
    expect(total.amount).toBe(125);
    expect(total.share).toBeGreaterThan(1);
  });

  it('allergies and diet rules still apply', () => {
    const fishOil = supp({ facts: [] }, { ingredientsText: 'fish oil, gelatin, glycerin. Contains fish (anchovy, sardine).' });
    expect(computeSupplementVerdict(fishOil, profile({ allergies: ['fish'] })).level).toBe('not-safe');
    expect(computeSupplementVerdict(fishOil, profile({ rules: ['vegan'] })).level).toBe('not-safe');
  });

  it('says so when the amounts are missing instead of calling doses fine', () => {
    const v = computeSupplementVerdict(supp({ facts: [] }), profile());
    expect(v.level).toBe('safe');
    expect(v.warnings[0]).toMatch(/doses were not checked/);
  });
});

describe('label checks', () => {
  it('a proprietary blend is flagged: amounts not disclosed', () => {
    const p = supp({ blends: ['Energy Matrix'], facts: [{ name: 'Energy Matrix', amount: 2, unit: 'g' }] });
    expect(supplementNotes(p, profile())[0].title).toBe('Amounts not disclosed');
    expect(computeSupplementVerdict(p, profile()).level).toBe('caution');
  });

  it('adds caffeine up per day and compares it with the FDA figure', () => {
    const pre = supp({ perDay: 2, facts: [{ name: 'Caffeine Anhydrous', amount: 300, unit: 'mg' }] }, { ingredientsText: 'caffeine anhydrous, guarana extract, citric acid' });
    expect(caffeinePerDay(pre)).toBe(600);
    const note = supplementNotes(pre, profile()).find((n) => n.title.startsWith('Caffeine'))!;
    expect(note.title).toBe('Caffeine: 600 mg a day');
    expect(note.text).toMatch(/More than the 400 mg/);
    expect(note.text).toMatch(/guarana/);
    expect(note.tone).toBe('warn');
  });

  it('St. John’s wort carries the medicines warning', () => {
    const p = supp({}, { ingredientsText: "St. John's Wort extract (Hypericum perforatum), cellulose" });
    expect(supplementNotes(p, profile()).some((n) => /birth control pills/.test(n.text))).toBe(true);
  });

  it('protein powder: protein per scoop, share of the scoop, and added amino acids', () => {
    const whey = supp({ servingGrams: 30, facts: [{ name: 'Protein', amount: 24, unit: 'g' }, { name: 'Total Sugars', amount: 2, unit: 'g' }] }, { ingredientsText: 'whey protein concentrate, glycine, cocoa, sucralose' });
    expect(proteinFacts(whey)).toEqual({ grams: 24, share: 0.8, sugar: 2 });
    const note = supplementNotes(whey, profile()).find((n) => n.title.startsWith('Protein'))!;
    expect(note.title).toBe('Protein: 24 g per serving (80% of the scoop)');
    expect(note.text).toMatch(/glycine/);
  });
});

describe('US supplement label database', () => {
  it('formats a barcode the way the database prints it', () => {
    expect(printedUpc('074312726941')).toBe('0 74312 72694 1');
    expect(printedUpc('0074312726941')).toBe('0 74312 72694 1'); // EAN-13 with a leading zero
    expect(printedUpc('3017620422003')).toBeNull(); // not a US code
  });

  it('maps a label: facts per serving, blends, other ingredients, allergy lines', () => {
    const p = mapDsldLabel('074312726941', {
      fullName: 'Daily Multi', brandName: 'Acme', upcSku: '0 74312 72694 1',
      servingSizes: [{ minQuantity: 2, unit: 'Capsule(s)', maxDailyServings: 2 }],
      ingredientRows: [
        { name: 'Vitamin D3', quantity: [{ servingSizeOrder: 1, quantity: 25, unit: 'mcg' }] },
        { name: 'Calories', quantity: [{ servingSizeOrder: 1, quantity: 10, unit: '{Calories}' }] },
        { name: 'Focus Blend', category: 'blend', quantity: [{ servingSizeOrder: 1, quantity: 500, unit: 'mg' }], nestedRows: [{ name: 'Ginkgo', quantity: [{ quantity: 0 }] }, { name: 'Guarana' }] },
      ],
      otheringredients: { ingredients: [{ name: 'Gelatin' }, { name: 'Rice Flour' }] },
      statements: [{ type: 'Precautions re: Allergies', notes: 'Contains soy.' }],
    });
    expect(p.kind).toBe('supplement');
    expect(p.supplement).toMatchObject({ serving: '2 Capsules', perDay: 2, blends: ['Focus Blend'] });
    expect(p.supplement!.facts).toEqual([{ name: 'Vitamin D3', amount: 25, unit: 'mcg' }, { name: 'Focus Blend', amount: 500, unit: 'mg' }]);
    expect(p.ingredientsText).toMatch(/Gelatin/);
    expect(p.ingredientsText).toMatch(/Contains soy/);
    expect(p.ingredientItems).toEqual(['Gelatin', 'Rice Flour']);
  });

  it('tells real supplements from cereal bars filed under supplements', () => {
    expect(isSupplement(['dietary-supplements', 'vitamins'], 'Vitamin D3 1000 IU')).toBe(true);
    expect(isSupplement(['dietary-supplements', 'protein-powders'], 'Whey Isolate')).toBe(true);
    expect(isSupplement(['dietary-supplements', 'snacks', 'bars'], 'Protein Nut Bar')).toBe(false);
    expect(isSupplement(['breakfasts', 'cereals'], 'Corn flakes')).toBe(false);
  });
});

import { countryTag } from '../src/data/alternatives';
import { printedUpc as upc } from '../src/data/dsld';

describe('healthier options and recalls: small helpers', () => {
  it("turns the phone's region into the database's country tag", () => {
    expect(countryTag('en-IN')).toBe('india');
    expect(countryTag('en-GB')).toBe('united-kingdom');
    expect(countryTag('en-US')).toBe('united-states');
    expect(countryTag('en')).toBeNull();
  });
  it('recalls are matched on the exact printed barcode', () => {
    expect(upc('649241898368')).toBe('6 49241 89836 8');
  });
});
