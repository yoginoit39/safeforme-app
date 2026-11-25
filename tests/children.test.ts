import { describe, expect, it } from 'vitest';
import type { ProductData } from '../src/types';
import { EMPTY_PROFILE } from '../src/types';
import { computeVerdict } from '../src/engine/verdict';
import { childConcerns, withChildChecks } from '../src/engine/children';
import { AGES, PRODUCTS, cell, why } from './child-grid';

/**
 * What the app says for everyday products at every age, with no allergy involved.
 * Columns: under 1 | age 1 | ages 2–3 | ages 4–8 | ages 9–18 | adult.
 * no = "Not for this age", ?? = "Not ideal", ok = no age concern.
 */
const GRID: Record<string, string> = {
  'Cola':                        'no no no ?? ?? ok',
  'Diet cola':                   'no no no ?? ?? ok',
  'Energy drink':                'no no no no no ok',
  'Iced tea':                    'no no no ?? ?? ok',
  'Chocolate chip cookies':      'no no ?? ok ok ok',
  'Plain rusks, no added sugar': 'ok ok ok ok ok ok',
  'Strawberry yogurt':           'no no ?? ok ok ok',
  'Plain whole milk yogurt':     'ok ok ok ok ok ok',
  'Honey oat cereal':            'no no ?? ok ok ok',
  'Clear honey':                 'no no ?? ok ok ok',
  'Apple juice':                 'no ?? ?? ok ok ok',
  'Whole milk':                  'no ok ok ok ok ok',
  'Apple puree, nothing added':  'ok ok ok ok ok ok',
  'Salted potato crisps':        '?? ?? ?? ok ok ok',
  'Roasted salted peanuts':      '?? ?? ?? ok ok ok',
  'Smooth peanut butter':        'ok ok ok ok ok ok',
  'Raw milk Camembert':          'no no no ok ok ok',
  'Swordfish steak':             '?? ?? ?? ?? ?? ok',
  'Rice drink':                  '?? ?? ?? ok ok ok',
  'Tiramisu':                    'no no no no no ok',
  'Coffee ice cream':            'no no no ?? ?? ok',
  'Blue raspberry slush':        '?? ?? ?? ?? ok ok',
  'Plain pasta':                 'ok ok ok ok ok ok',
  'Beef stock cubes':            '?? ?? ?? ok ok ok',
};
const CODE = { OK: 'ok', 'Not ideal': '??', 'Not for this age': 'no' } as const;

describe('children: every product at every age', () => {
  it('the grid covers every product', () => {
    expect(PRODUCTS.map((p) => p.name).sort()).toEqual(Object.keys(GRID).sort());
  });

  for (const p of PRODUCTS) {
    it(`${p.name}: ${GRID[p.name]}`, () => {
      expect(AGES.map((a) => CODE[cell(p, a)]).join(' ')).toBe(GRID[p.name]);
    });
  }

  it('an adult never gets a child rule', () => {
    for (const p of PRODUCTS) expect(childConcerns(p, 'adult')).toEqual({ notForAge: [], caution: [] });
  });

  it('rules only ever relax with age: nothing is stricter for an older child than a younger one', () => {
    const rank = { OK: 0, 'Not ideal': 1, 'Not for this age': 2 } as const;
    for (const p of PRODUCTS) {
      const levels = AGES.map((a) => rank[cell(p, a)]);
      for (let i = 1; i < levels.length; i++) expect(levels[i], `${p.name} at ${AGES[i]}`).toBeLessThanOrEqual(levels[i - 1]);
    }
  });
});

describe('children: the reason given, by age', () => {
  const get = (name: string) => PRODUCTS.find((p) => p.name === name)!;

  it('cookies: a firm no under 2, a softer note at 2–3, nothing at 11', () => {
    const cookies = get('Chocolate chip cookies');
    expect(why(cookies, 'under1')).toBe('Contains added sugar');
    expect(childConcerns(cookies, '1').notForAge[0]).toBe('Contains added sugar. Children under 2 should have no added sugars or sugary drinks (US CDC).');
    expect(childConcerns(cookies, '2-3').caution[0]).toBe('Contains added sugar. The NHS says to avoid sweetened food and drink at age 4 and under.');
    expect(why(cookies, '9-18')).toBe('');
  });

  it('cola for an 11-year-old: not ideal, with the caffeine limit in everyday terms', () => {
    const c = childConcerns(get('Cola'), '9-18');
    expect(c.notForAge).toEqual([]);
    expect(c.caution[0]).toMatch(/2\.5 mg per kg of body weight a day: about 60–75 mg for a 25–30 kg child/);
  });

  it('energy drink for a teenager: not for this age', () => {
    expect(childConcerns(get('Energy drink'), '9-18').notForAge[0]).toMatch(/Doctors advise against energy drinks for children and teens/);
  });

  it('honey: botulism warning under 1, counted as added sugar at 1', () => {
    expect(childConcerns(get('Clear honey'), 'under1').notForAge[0]).toMatch(/Never before 12 months.*infant botulism/);
    expect(childConcerns(get('Clear honey'), '1').notForAge[0]).toMatch(/added sugar/);
  });

  it('milk and juice: not as a baby’s drink; juice limited at 1–3; milk fine from 1', () => {
    expect(childConcerns(get('Whole milk'), 'under1').notForAge[0]).toMatch(/Cow’s milk as a drink\. Not before 12 months/);
    expect(childConcerns(get('Plain whole milk yogurt'), 'under1')).toEqual({ notForAge: [], caution: [] }); // milk in food is fine
    expect(childConcerns(get('Apple juice'), 'under1').notForAge[0]).toMatch(/under 12 months should not drink any/);
    expect(childConcerns(get('Apple juice'), '1').caution[0]).toMatch(/4 oz \(120 ml\)/);
  });

  it('whole nuts are flagged under 4; peanut butter is not', () => {
    expect(childConcerns(get('Roasted salted peanuts'), '2-3').caution[0]).toMatch(/choking risk.*under 5/);
    expect(childConcerns(get('Smooth peanut butter'), '2-3')).toEqual({ notForAge: [], caution: [] });
  });
});

describe('children: together with the rest of the profile', () => {
  const food = (p: Partial<ProductData>): ProductData => ({ name: 'Test', allergens: [], traces: [], labels: [], source: 'openfoodfacts', kind: 'food', ingredientLangs: ['en'], ...p });
  const baby = { ...EMPTY_PROFILE, allergies: ['milk', 'egg', 'soy'] };
  const check = (p: ProductData, age: Parameters<typeof withChildChecks>[2], profile = EMPTY_PROFILE) => withChildChecks(computeVerdict(p, profile), p, age);

  it('the case that started this: a cola with none of the baby’s allergens is not a green dot', () => {
    const cola = PRODUCTS[0];
    expect(computeVerdict(cola, baby).level).toBe('safe'); // allergies alone see nothing wrong
    expect(check(cola, 'under1', baby).level).toBe('not-safe');
    expect(check(cola, '2-3', baby).level).toBe('not-safe');
  });

  it('an allergy still comes first, with the age reasons added', () => {
    const v = check(food({ ingredientsText: 'milk chocolate (sugar, cocoa butter, whole milk powder), coffee extract' }), '1', baby);
    expect(v.level).toBe('not-safe');
    expect(v.reasons[0]).toMatch(/milk/i);
    expect(v.reasons.join(' ')).toMatch(/caffeine/);
  });

  it('a missing ingredient list stays CHECK THE LABEL at any age', () => {
    expect(check(food({ ingredientsText: undefined }), 'under1', baby).level).toBe('unknown');
    expect(check(food({ ingredientsText: undefined }), '9-18').level).toBe('unknown');
  });

  it('wine vinegar is not alcohol', () => {
    expect(check(food({ ingredientsText: 'white wine vinegar, mustard seeds' }), '4-8').level).toBe('safe');
  });
});
