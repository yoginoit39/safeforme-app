import { describe, expect, it } from 'vitest';
import { explain } from '../src/engine/explain';
import { computeVerdict, eNumbers } from '../src/engine/verdict';
import { computeScore } from '../src/engine/score';
import { DEMO_PRODUCTS } from '../src/data/demo';
import { EMPTY_PROFILE, type ProductData, type Profile } from '../src/types';

const profile = (p: Partial<Profile>): Profile => ({ ...EMPTY_PROFILE, ...p });
const product = (p: Partial<ProductData>): ProductData => ({ name: 'Test', allergens: [], traces: [], labels: [], source: 'openfoodfacts', ...p });
const why = (p: ProductData, pr: Profile = EMPTY_PROFILE) => explain(p, pr, computeVerdict(p, pr), computeScore(p, pr));
const titles = (p: ProductData, pr?: Profile) => why(p, pr).insights.map((i) => i.title).join(' | ');
const [cookies, oats, cola] = DEMO_PRODUCTS;

const spread = product({
  ingredientsText: 'Sugar, palm oil, hazelnuts 13%, skimmed milk powder, cocoa, emulsifier: lecithins (soya), vanillin',
  allergens: ['nuts', 'milk'], nutriscoreGrade: 'e', novaGroup: 4,
  nutriments: { sugars: 56.3, salt: 0.1, saturatedFat: 10.6, fat: 31, protein: 6.3, kcal: 539 },
});

describe('why: summary of what is in a product', () => {
  it('explains a sugary spread: sugar first, palm oil, saturated fat, ultra-processed', () => {
    const w = why(spread);
    expect(w.headline).toBe('Safe for you to eat, but not a healthy choice.');
    expect(w.summary).toMatch(/Mainly because of very high sugar/);
    const t = titles(spread);
    expect(t).toMatch(/Very high in sugar — 56.3g per 100g/);
    expect(t).toMatch(/Contains palm oil/);
    expect(t).toMatch(/High in saturated fat/);
    expect(t).toMatch(/Ultra-processed/);
    expect(w.insights.find((i) => i.title.startsWith('Added sugar'))!.detail).toMatch(/first ingredient/);
    expect(w.insights[0].tone).toBe('bad'); // worst news first
  });

  it('does not count the same sugar twice when a label is in two languages', () => {
    const w = why(product({ ingredientsText: 'Sucre, huile de palme, noisettes ; sugar, palm oil, hazelnuts' }));
    expect(w.insights.find((i) => i.title.startsWith('Added sugar'))!.title).toBe('Added sugar: sugar');
  });

  it('makes it personal: links sugar to the sugar watch', () => {
    const w = why(cola, profile({ watch: ['diabetes'] }));
    expect(w.insights.find((i) => /sugar/i.test(i.title))!.detail).toMatch(/your sugar watch/);
  });

  it('praises a clean product', () => {
    const w = why(oats);
    expect(w.headline).toBe('A great choice for you.');
    expect(titles(oats)).toMatch(/fibre/);
    expect(titles(oats)).toMatch(/Minimally processed/);
    expect(w.insights.every((i) => i.tone === 'good' || i.tone === 'info')).toBe(true);
  });

  it('leads with the safety reason when the product is not safe', () => {
    const w = why(cookies, profile({ allergies: ['peanuts'] }));
    expect(w.headline).toBe('Not one for you.');
    expect(w.summary).toMatch(/^Contains peanuts\./);
  });

  it('says so honestly when there is nothing to go on', () => {
    const w = why(product({}));
    expect(w.headline).toBe('We can’t be sure about this one.');
    expect(w.insights).toHaveLength(0);
    expect(w.processing).toBeNull();
  });
});

describe('why: processing level', () => {
  it('uses the official NOVA group when present and cites sources for group 4', () => {
    const w = why(spread);
    expect(w.processing).toMatchObject({ group: 4, estimated: false, title: 'Ultra-processed food' });
    expect(w.processing!.text).toMatch(/overall diet, not a single product/);
    expect(w.processing!.source).toMatch(/WHO/);
  });

  it('estimates only when there are several clear signs, and labels it an estimate', () => {
    const fizzy = product({ ingredientsText: 'Water, sweetener (aspartame), colour E150d, acidity regulator E330, flavourings, preservative E211' });
    expect(why(fizzy).processing).toMatchObject({ group: 4, estimated: true });
    expect(why(product({ ingredientsText: 'Tomatoes, salt' })).processing).toBeNull();
  });

  it('counts E-numbers', () => {
    expect(eNumbers('colour e150d, E 330, e-211, vitamin e, e150d')).toEqual(['e150d', 'e330', 'e211']);
  });
});

describe('why: ingredients with official action', () => {
  it('flags aspartame with an attributed note', () => {
    const w = why(product({ ingredientsText: 'Carbonated water, sweeteners (aspartame, acesulfame K), flavourings' }));
    expect(w.ingredients.map((f) => f.name)).toEqual(['Aspartame']);
    expect(w.ingredients[0].note).toMatch(/IARC/);
    expect(w.ingredients[0].source).toBeTruthy();
  });

  it('flags curing salts only in meat products', () => {
    expect(why(product({ ingredientsText: 'Pork, salt, preservative: sodium nitrite' })).ingredients.map((f) => f.name)).toContain('Curing salts (nitrites / nitrates)');
    expect(why(product({ ingredientsText: 'Spinach, water, potassium nitrate' })).ingredients).toHaveLength(0);
  });

  it('stays silent for ordinary ingredients', () => {
    expect(why(oats).ingredients).toHaveLength(0);
  });
});

describe('new profile options', () => {
  it('coeliac: gluten, traces and unlabelled oats', () => {
    const p = profile({ rules: ['celiac'] });
    expect(computeVerdict(product({ ingredientsText: 'wheat flour, water' }), p).level).toBe('not-safe');
    expect(computeVerdict(product({ ingredientsText: 'rice, salt', traces: ['gluten'] }), p).reasons[0]).toMatch(/traces of gluten/);
    expect(computeVerdict(oats, p).level).toBe('unknown');
    expect(computeVerdict(product({ ingredientsText: 'rolled oats', labels: ['no-gluten'] }), p).level).toBe('safe');
    expect(computeVerdict(product({ ingredientsText: 'rice, salt' }), p).level).toBe('safe');
  });

  it('lactose intolerance: milk ingredients unless labelled lactose-free', () => {
    const p = profile({ rules: ['lactose'] });
    expect(computeVerdict(product({ ingredientsText: 'cream, sugar' }), p).reasons[0]).toMatch(/source of lactose/);
    expect(computeVerdict(product({ ingredientsText: 'milk, lactase enzyme', labels: ['no-lactose'] }), p).level).toBe('safe');
    expect(computeVerdict(product({ ingredientsText: 'cocoa butter, coconut milk' }), p).level).toBe('safe');
  });

  it('more allergens: celery, mustard, lupin, sulphites', () => {
    expect(computeVerdict(product({ ingredientsText: 'water, mustard seeds' }), profile({ allergies: ['mustard'] })).level).toBe('not-safe');
    expect(computeVerdict(product({ ingredientsText: 'x', allergens: ['sulphur-dioxide-and-sulphites'] }), profile({ allergies: ['sulphites'] })).level).toBe('not-safe');
    expect(computeVerdict(product({ ingredientsText: 'dried apricots, preservative E220' }), profile({ allergies: ['sulphites'] })).level).toBe('not-safe');
    expect(computeVerdict(product({ ingredientsText: 'celeriac, lupin flour' }), profile({ allergies: ['celery', 'lupin'] })).reasons).toHaveLength(2);
  });

  it('avoid list: a warning and score points, never "not safe"', () => {
    const p = profile({ watch: ['no-palm-oil', 'no-additives'] });
    const v = computeVerdict(spread, p);
    expect(v.level).toBe('safe');
    expect(v.warnings.join(' ')).toMatch(/palm oil.*avoid list/);
    expect(computeScore(spread, p)!.value).toBe(0); // 15 − 10 − 10, clamped
    expect(computeScore(oats, p)!.value).toBe(90);
  });

  it('cholesterol and low-carb watches adjust the score', () => {
    const p = product({ nutriscoreGrade: 'b', nutriments: { saturatedFat: 12, carbs: 60 } });
    expect(computeScore(p, profile({ watch: ['cholesterol'] }))!.value).toBe(55);
    expect(computeScore(p, profile({ watch: ['low-carb'] }))!.value).toBe(55);
  });
});
