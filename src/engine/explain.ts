import type { Profile, ProductData, Score, Verdict } from '../types';
import {
  ADDED_SUGAR, ADDITIVE_WORDS, CAFFEINE, HYDROGENATED, MEAT, PALM_OIL, PORK, SWEETENERS,
  eNumbers, findTerm, splitTraces, type TermGroup,
} from './verdict';
import { fmt } from './score';

/**
 * The "why" behind a result, in plain words. Pure and deterministic: everything
 * here is worked out on the device from the product data. No AI, no network.
 */

export type Tone = 'bad' | 'warn' | 'good' | 'info';
export type Insight = { tone: Tone; title: string; detail?: string; short?: string };
export type Flagged = { name: string; tone: Tone; note: string; source?: string };
export type Processing = { group: 1 | 2 | 3 | 4; estimated: boolean; title: string; text: string; source?: string };
export type Explanation = { headline: string; summary: string; insights: Insight[]; ingredients: Flagged[]; processing: Processing | null };

/**
 * Ingredients with recent regulatory action. Every note states what an official
 * body did, checked against that body's own pages (November 2026). Nothing here
 * is a medical claim; unverified claims were deliberately left out.
 */
const NOTABLE: { name: string; group: TermGroup; note: string; source: string; needsMeat?: boolean }[] = [
  {
    name: 'Aspartame',
    group: { terms: ['aspartame', 'e951'] },
    note: 'Sweetener. In 2023 the WHO’s cancer agency (IARC) classed it as “possibly carcinogenic to humans”. The WHO/FAO expert committee kept the acceptable daily intake unchanged.',
    source: 'WHO, July 2023',
  },
  {
    name: 'Red No. 3 (erythrosine)',
    group: { terms: ['erythrosine', 'red 3', 'red no. 3', 'red no 3', 'fd&c red 3', 'fd&c red no. 3', 'e127', 'érythrosine'] },
    note: 'Colour. The US FDA has withdrawn its approval for use in food; manufacturers have until January 2027 to remove it.',
    source: 'US FDA',
  },
  {
    name: 'Brominated vegetable oil',
    group: { terms: ['brominated vegetable oil', 'bvo', 'e443'] },
    note: 'The US FDA withdrew its approval for use in food in July 2024.',
    source: 'US FDA, July 2024',
  },
  {
    name: 'Partially hydrogenated oil',
    group: { terms: ['partially hydrogenated', 'partiellement hydrogénée'] },
    note: 'Main source of industrial trans fat. The US FDA ruled in 2015 that it is no longer “generally recognized as safe”, and the WHO recommends eliminating industrial trans fat.',
    source: 'US FDA; WHO',
  },
  {
    name: 'Titanium dioxide',
    group: { terms: ['titanium dioxide', 'e171', 'dioxyde de titane', 'titandioxid'] },
    note: 'Whitening colour. Still permitted in the US, where the FDA is reviewing a request to withdraw it.',
    source: 'US FDA',
  },
  {
    name: 'BHA',
    group: { terms: ['bha', 'butylated hydroxyanisole', 'e320'] },
    note: 'Preservative. The US FDA began a new safety review of it in 2025.',
    source: 'US FDA, August 2025',
  },
  {
    name: 'Potassium bromate',
    group: { terms: ['potassium bromate', 'bromated flour', 'e924'] },
    note: 'Flour improver. Under safety review by the US FDA.',
    source: 'US FDA',
  },
  {
    name: 'Curing salts (nitrites / nitrates)',
    group: { terms: ['sodium nitrite', 'potassium nitrite', 'sodium nitrate', 'potassium nitrate', 'nitrite', 'nitrate', 'e249', 'e250', 'e251', 'e252', 'nitrite de sodium', 'natriumnitrit'] },
    note: 'A sign of processed (cured) meat. The WHO’s cancer agency (IARC) classifies processed meat as carcinogenic to humans.',
    source: 'WHO / IARC',
    needsMeat: true,
  },
];

const WHOLEGRAIN: TermGroup = {
  terms: ['whole grain', 'wholegrain', 'whole wheat', 'wholewheat', 'wholemeal', 'whole oat', 'rolled oats', 'brown rice', 'céréales complètes', 'farine complète', 'blé complet', 'vollkorn', 'integral', 'integrale'],
};

const NOVA_TITLE = {
  1: 'Unprocessed or minimally processed',
  2: 'Processed cooking ingredient',
  3: 'Processed food',
  4: 'Ultra-processed food',
} as const;

const NOVA_TEXT = {
  1: 'Whole foods, or foods changed only by simple steps such as drying, grinding, chilling or pasteurising.',
  2: 'Ingredients like oils, butter, sugar and salt, made from whole foods and used in cooking rather than eaten alone.',
  3: 'Whole foods with salt, sugar or oil added — for example canned vegetables, cheese or fresh bread.',
  4: 'Industrial formulations made mostly from extracted or refined ingredients and additives you would not use at home. The WHO says diets high in highly processed foods are associated with negative health outcomes, and the 2025–2030 US Dietary Guidelines advise limiting them. This is about your overall diet, not a single product.',
} as const;

/** The same ingredient is often listed in two languages; show it once, in English. */
const ENGLISH: Record<string, string> = {
  sucre: 'sugar', zucker: 'sugar', 'azúcar': 'sugar', zucchero: 'sugar',
  'sirop de glucose': 'glucose syrup', glukosesirup: 'glucose syrup', 'jarabe de glucosa': 'glucose syrup', 'sciroppo di glucosio': 'glucose syrup',
  'sirop de glucose-fructose': 'glucose-fructose syrup',
};
const inEnglish = (terms: string[]) => [...new Set(terms.map((t) => ENGLISH[t] ?? t))];

const list = (items: string[]) =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Every distinct match of a group in the text, in order of appearance (up to `max`). */
function findAll(text: string, group: TermGroup, max = 4): string[] {
  const found: string[] = [];
  let rest = text;
  for (let i = 0; i < 12 && found.length < max; i++) {
    const hit = findTerm(rest, group);
    if (!hit) break;
    if (!found.includes(hit)) found.push(hit);
    rest = rest.split(hit).join(' ');
  }
  return found;
}

/** Ingredients are listed by weight, so the first few are what the product is mostly made of. */
function position(main: string, term: string): number {
  const first = main.split(/ ; /)[0];
  const items = first.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  return items.findIndex((item) => item.includes(term));
}

export function explain(product: ProductData, profile: Profile, verdict: Verdict, score: Score | null): Explanation {
  const n = product.nutriments ?? {};
  const { main } = splitTraces((product.ingredientsText ?? '').toLowerCase());
  const insights: Insight[] = [];
  const watch = new Set(profile.watch);
  const sugarWatch = watch.has('diabetes') || watch.has('low-sugar');

  // --- nutrition ---
  if (n.sugars !== undefined) {
    const spoons = Math.round(n.sugars / 4);
    const personal = sugarWatch ? ' That matters for your sugar watch.' : '';
    if (n.sugars > 22.5) insights.push({ tone: 'bad', short: 'very high sugar', title: `Very high in sugar — ${fmt(n.sugars)}g per 100g`, detail: `About ${spoons} teaspoons of sugar in every 100g.${personal}` });
    else if (n.sugars > 10) insights.push({ tone: 'warn', short: 'high sugar', title: `High in sugar — ${fmt(n.sugars)}g per 100g`, detail: `About ${spoons} teaspoon${spoons === 1 ? '' : 's'} of sugar in every 100g.${personal}` });
    else if (sugarWatch && n.sugars > 5) insights.push({ tone: 'warn', short: 'sugar above your limit', title: `Moderate sugar — ${fmt(n.sugars)}g per 100g`, detail: 'Above the 5g level your sugar watch looks for.' });
    else if (n.sugars <= 5) insights.push({ tone: 'good', short: 'low sugar', title: `Low in sugar — ${fmt(n.sugars)}g per 100g` });
  }
  if (n.salt !== undefined) {
    const personal = watch.has('low-salt') ? ' That matters for your low-salt profile.' : '';
    if (n.salt > 1.5) insights.push({ tone: 'bad', short: 'high salt', title: `High in salt — ${fmt(n.salt)}g per 100g`, detail: `Adults are generally advised to stay under about 5–6g of salt a day.${personal}` });
    else if (watch.has('low-salt') && n.salt > 0.6) insights.push({ tone: 'warn', short: 'salt above your limit', title: `Moderate salt — ${fmt(n.salt)}g per 100g`, detail: 'Above the level your low-salt profile looks for.' });
    else if (n.salt <= 0.3) insights.push({ tone: 'good', short: 'low salt', title: `Low in salt — ${fmt(n.salt)}g per 100g` });
  }
  if (n.saturatedFat !== undefined) {
    const personal = watch.has('cholesterol') ? ' That matters for your cholesterol watch.' : '';
    if (n.saturatedFat > 5) insights.push({ tone: n.saturatedFat > 10 ? 'bad' : 'warn', short: 'high saturated fat', title: `High in saturated fat — ${fmt(n.saturatedFat)}g per 100g`, detail: `Saturated fat is the kind linked to raised cholesterol.${personal}` });
  }
  if (n.kcal !== undefined && n.kcal > 400) {
    insights.push({ tone: profile.goal === 'lose-weight' ? 'warn' : 'info', short: 'calorie-dense', title: `Calorie-dense — ${fmt(n.kcal)} kcal per 100g`, detail: profile.goal === 'lose-weight' ? 'Small portions add up quickly, which works against your weight goal.' : 'Small portions add up quickly.' });
  }
  if (watch.has('low-carb') && n.carbs !== undefined && n.carbs > 20) {
    insights.push({ tone: n.carbs > 50 ? 'bad' : 'warn', short: 'high carbs', title: `High in carbohydrates — ${fmt(n.carbs)}g per 100g`, detail: 'Above what your low-carb goal looks for.' });
  }
  if (n.fiber !== undefined && n.fiber >= 3) insights.push({ tone: 'good', short: 'good fibre', title: `${n.fiber >= 6 ? 'High in' : 'A source of'} fibre — ${fmt(n.fiber)}g per 100g` });
  if (n.protein !== undefined && n.protein >= 10) {
    insights.push({ tone: 'good', short: 'good protein', title: `Good protein — ${fmt(n.protein)}g per 100g`, detail: profile.goal === 'build-muscle' ? 'Helps your muscle-building goal.' : undefined });
  }

  // --- ingredients ---
  const flagged: Flagged[] = [];
  if (main) {
    const sugarTerms = findAll(main, ADDED_SUGAR, 6);
    const sugars = inEnglish(sugarTerms).slice(0, 4);
    if (sugars.length) {
      const pos = Math.min(...sugarTerms.map((t) => position(main, t)).filter((i) => i >= 0), 99);
      const lead = pos === 0 ? ' Sugar is the first ingredient, so it is what this product contains most of.' : pos <= 2 ? ' It is one of the first three ingredients, so it is a main ingredient.' : '';
      insights.push({ tone: pos <= 2 || sugars.length > 1 ? 'warn' : 'info', short: 'added sugars', title: `Added sugar${sugars.length > 1 ? 's' : ''}: ${list(sugars)}`, detail: `${sugars.length > 1 ? `${sugars.length} different kinds of sugar are listed.` : 'Sugar is added rather than naturally present.'}${lead}`.trim() });
    }
    const sweet = findAll(main, SWEETENERS).filter((t) => !/sweetener|édulcorant|süßungsmittel|edulcorante|dolcificante/.test(t));
    if (sweet.length || findTerm(main, SWEETENERS)) {
      insights.push({ tone: watch.has('no-sweeteners') ? 'warn' : 'info', short: 'sweeteners', title: sweet.length ? `Sweetener${sweet.length > 1 ? 's' : ''}: ${list(sweet)}` : 'Contains sweeteners', detail: 'Used to add sweetness with little or no sugar.' });
    }
    const palm = findTerm(main, PALM_OIL);
    if (palm) insights.push({ tone: 'warn', short: 'palm oil', title: 'Contains palm oil', detail: 'A cheap vegetable fat that is high in saturated fat.' });
    const hydro = findTerm(main, HYDROGENATED);
    if (hydro) insights.push({ tone: hydro.startsWith('partial') ? 'bad' : 'warn', short: 'hydrogenated fat', title: `Contains ${hydro} fat`, detail: 'An industrially hardened fat.' });
    if (findTerm(main, CAFFEINE) || (n.caffeine ?? 0) > 0) insights.push({ tone: profile.rules.includes('pregnancy') || watch.has('no-caffeine') ? 'warn' : 'info', short: 'caffeine', title: 'Contains caffeine' });

    const es = eNumbers(main);
    const words = findAll(main, ADDITIVE_WORDS, 5);
    if (es.length >= 1 || words.length >= 2) {
      const count = es.length;
      insights.push({
        tone: count >= 4 || words.length >= 4 ? 'warn' : 'info',
        short: 'several additives',
        title: count ? `${count} additive${count === 1 ? '' : 's'} with E-numbers` : `Additives: ${list(words.slice(0, 3))}`,
        detail: count ? `${es.slice(0, 6).join(', ').toUpperCase()}${words.length ? ` — plus ${list(words.slice(0, 3))}` : ''}. Approved for use, but a sign of industrial processing.` : 'Approved for use, but a sign of industrial processing.',
      });
    }
    if (findTerm(main, WHOLEGRAIN)) insights.push({ tone: 'good', short: 'whole grains', title: 'Made with whole grains', detail: 'Whole grains keep the fibre and nutrients that refining removes.' });

    const hasMeat = !!(findTerm(main, MEAT) || findTerm(main, PORK));
    for (const item of NOTABLE) {
      if (item.needsMeat && !hasMeat) continue;
      if (findTerm(main, item.group)) flagged.push({ name: item.name, tone: 'warn', note: item.note, source: item.source });
    }
  }

  // --- processing ---
  let processing: Processing | null = null;
  const nova = product.novaGroup;
  if (nova === 1 || nova === 2 || nova === 3 || nova === 4) {
    processing = { group: nova, estimated: false, title: NOVA_TITLE[nova], text: NOVA_TEXT[nova], source: nova === 4 ? 'WHO, 2026; US Dietary Guidelines 2025–2030' : undefined };
  } else if (main) {
    const markers = eNumbers(main).length + findAll(main, ADDITIVE_WORDS, 6).length + (findTerm(main, HYDROGENATED) ? 1 : 0) + (findTerm(main, SWEETENERS) ? 1 : 0);
    if (markers >= 3) {
      processing = { group: 4, estimated: true, title: 'Probably ultra-processed', text: `No official rating for this product, but its ingredient list has several signs of industrial processing. ${NOVA_TEXT[4]}`, source: 'Estimated from ingredients' };
    }
  }
  if (processing?.group === 4) insights.push({ tone: 'warn', short: 'ultra-processing', title: processing.estimated ? 'Probably ultra-processed' : 'Ultra-processed', detail: 'See “How processed is it?” below.' });
  if (processing?.group === 1) insights.push({ tone: 'good', short: 'minimal processing', title: 'Minimally processed' });

  // --- headline + summary ---
  const order: Record<Tone, number> = { bad: 0, warn: 1, info: 2, good: 3 };
  insights.sort((a, b) => order[a.tone] - order[b.tone]);
  const negatives = insights.filter((i) => (i.tone === 'bad' || i.tone === 'warn') && i.short).map((i) => i.short!);
  const positives = insights.filter((i) => i.tone === 'good' && i.short).map((i) => i.short!);

  let headline: string;
  let summary: string;
  if (verdict.level === 'not-safe') {
    headline = 'Not one for you.';
    summary = `${verdict.reasons[0]}${negatives.length ? ` Beyond that, it has ${list(negatives.slice(0, 3))}.` : ''}`;
  } else if (!score) {
    headline = verdict.level === 'unknown' ? 'We can’t be sure about this one.' : 'Not much to go on.';
    summary = negatives.length ? `From what is listed: ${list(negatives.slice(0, 3))}.` : 'There isn’t enough nutrition data to judge how healthy it is. Check the label.';
  } else if (score.value >= 60) {
    headline = verdict.level === 'unknown' ? 'Looks healthy, but can’t be confirmed for your rules.' : score.value >= 80 ? 'A great choice for you.' : 'A good choice for you.';
    summary = `${positives.length ? `${cap(list(positives.slice(0, 3)))}.` : 'Nothing stands out as a concern.'}${negatives.length ? ` Worth knowing: ${list(negatives.slice(0, 2))}.` : ''}`;
  } else if (score.value >= 40) {
    headline = 'Fine now and then.';
    summary = negatives.length ? `Held back by ${list(negatives.slice(0, 3))}.${positives.length ? ` On the plus side: ${list(positives.slice(0, 2))}.` : ''}` : 'An average product with nothing especially good or bad.';
  } else {
    headline = verdict.level === 'safe' ? 'Safe for you to eat, but not a healthy choice.' : 'Not a healthy choice.';
    summary = negatives.length ? `Mainly because of ${list(negatives.slice(0, 4))}.` : 'Its overall nutrition rating is low.';
  }

  return { headline, summary, insights, ingredients: flagged, processing };
}
