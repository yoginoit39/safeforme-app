import type { ProductData, Verdict } from '../types';
import { ADDED_SUGAR, CAFFEINE, SWEETENERS, findTerm, type TermGroup } from './verdict';
import type { AgeBand } from './supplements';

/**
 * Food checks for children. Pure, deterministic, no network, no AI.
 *
 * A baby is not a small adult: a biscuit with none of the baby's allergens is still not baby food.
 * Every rule restates published guidance, read from the source pages in November 2026:
 * - US CDC, "Foods and Drinks to Avoid or Limit" (infants and toddlers), updated April 2026
 * - UK NHS, "Foods to avoid giving babies and young children", reviewed February 2026
 * - Health Canada, "Caffeine in foods" (recommended maximum for children)
 * - US FDA, "Spilling the Beans: How Much Caffeine is Too Much?"
 *
 * Two outcomes: "not for this age" where the guidance says do not give, and "not ideal" where it
 * says avoid or limit. It cannot see texture: apart from plain whole nuts it cannot warn about choking.
 */

const HONEY: TermGroup = { terms: ['honey', 'miel', 'honig', 'miele'] };
const UNPASTEURISED: TermGroup = { terms: ['unpasteurised', 'unpasteurized', 'raw milk', 'lait cru', 'rohmilch', 'leche cruda', 'latte crudo'] };
const MERCURY_FISH: TermGroup = { terms: ['shark', 'swordfish', 'marlin', 'king mackerel', 'tilefish', 'orange roughy', 'bigeye tuna', 'espadon', 'requin', 'schwertfisch', 'pez espada'] };
const ALCOHOL: TermGroup = {
  terms: ['alcohol', 'ethanol', 'wine', 'beer', 'rum', 'whisky', 'whiskey', 'vodka', 'brandy', 'liqueur', 'alcool', 'vin', 'bière'],
  except: ['alcohol-free', 'alcohol free', 'sans alcool', 'sugar alcohol', 'wine vinegar', 'vinaigre de vin', 'fatty alcohol', 'cetyl alcohol'],
};
const RICE_DRINK = /\brice (drink|milk)\b|\bboisson (au|de) riz\b|\breisdrink\b/i;
const ENERGY_DRINK = /\benergy[- ]drinks?\b|\bboissons?[- ]énergisantes?\b|\benergydrink/i;
const SLUSH = /\bslush(y|ie|ies)?\b/i;
const JUICE = /\b(fruit[- ])?juices?\b|\bnectars?\b|\bjus de\b|\bsaft\b|\bzumo\b|\bsmoothies?\b/i;
const MILK_DRINK = /^(whole |semi[- ]skimmed |skimmed |full[- ]fat |low[- ]fat |fresh |organic |uht |\d% )*(cow'?s? )?milk$|^lait (entier|demi-écrémé|écrémé)\b/i;
const WHOLE_NUTS = /\b(nuts|peanuts|almonds|cashews|pistachios|hazelnuts|walnuts|pecans|macadamias)\b/i;
const NOT_WHOLE = /butter|spread|flour|milk|drink|oil|bar|cookie|biscuit|chocolate|cereal|muesli|granola|yogurt|ground|powder|paste|crushed|chopped|flaked|cake|ice cream/i;

export type ChildConcerns = { notForAge: string[]; caution: string[] };

const UNDER_4: AgeBand[] = ['under1', '1', '2-3'];
export const isUnder4 = (age: AgeBand) => UNDER_4.includes(age);
export const AGE_LABEL: Record<AgeBand, string> = { under1: 'under 1', '1': 'age 1', '2-3': 'ages 2–3', '4-8': 'ages 4–8', '9-18': 'ages 9–18', adult: 'adults' };

export function childConcerns(product: ProductData, age: AgeBand): ChildConcerns {
  const out: ChildConcerns = { notForAge: [], caution: [] };
  if (age === 'adult') return out;
  const text = (product.ingredientsText ?? '').toLowerCase();
  const name = product.name ?? '';
  const cats = (product.categories ?? []).join(' ');
  const about = `${name} ${cats}`;
  const n = product.nutriments ?? {};
  const baby = age === 'under1';
  const under2 = baby || age === '1';
  const under4 = isUnder4(age);

  // Alcohol: no age at which a product with alcohol is a child's.
  if (findTerm(text, ALCOHOL) || product.photoFlags?.containsAlcohol === true) out.notForAge.push('Contains alcohol. Not for children.');

  // Energy drinks and caffeine.
  const energy = ENERGY_DRINK.test(about);
  const caffeine = findTerm(text, CAFFEINE) || (n.caffeine !== undefined && n.caffeine > 0);
  if (energy) out.notForAge.push('Energy drink. Doctors advise against energy drinks for children and teens, because of the caffeine and sugar (US FDA, citing the American Academy of Pediatrics).');
  else if (caffeine && under4) out.notForAge.push(`Contains caffeine. ${under2 ? 'Children under 2 should have none' : 'No safe amount is established for young children'} (US CDC).`);
  else if (caffeine) out.caution.push('Contains caffeine. Health Canada’s recommended maximum for children is 2.5 mg per kg of body weight a day: about 60–75 mg for a 25–30 kg child, less than two cans of cola.');

  if (under4 && findTerm(text, UNPASTEURISED)) out.notForAge.push('Unpasteurised. The US CDC says not to give young children unpasteurised milk, juice, yogurt or cheese.');

  // Honey: a hard rule under 12 months.
  const honey = findTerm(text, HONEY) || /\bhoney\b/i.test(name);
  if (honey && baby) out.notForAge.push('Contains honey. Never before 12 months: it can cause infant botulism (US CDC, NHS).');

  // Added sugar and sweeteners.
  const sugar = findTerm(text, ADDED_SUGAR) || (honey && !baby);
  const sweetener = findTerm(text, SWEETENERS);
  if (sugar || sweetener) {
    const what = sugar && sweetener ? 'added sugar and sweeteners' : sugar ? 'added sugar' : 'sweeteners';
    if (under2) out.notForAge.push(`Contains ${what}. Children under 2 should have no added sugars or sugary drinks (US CDC).`);
    else if (age === '2-3') out.caution.push(`Contains ${what}. The NHS says to avoid sweetened food and drink at age 4 and under.`);
  }

  // Drinks that are fine later but not as a baby's drink.
  if (baby && JUICE.test(about)) out.notForAge.push('Juice. Children under 12 months should not drink any fruit or vegetable juice (US CDC).');
  else if (under4 && JUICE.test(about)) out.caution.push('Juice. The US CDC calls juice unnecessary after 12 months and cites a limit of 4 oz (120 ml) of 100% juice a day for ages 1–3; the NHS says to avoid it at 4 and under.');
  if (baby && (MILK_DRINK.test(name.trim()) || /\b(cow-?milks?|whole-milks|semi-skimmed-milks|skimmed-milks)\b/.test(cats))) {
    out.notForAge.push('Cow’s milk as a drink. Not before 12 months: it can cause intestinal bleeding and is too heavy for a baby’s kidneys (US CDC). Milk cooked into food is a different matter.');
  }
  if (under4 && RICE_DRINK.test(`${name} ${text}`)) out.caution.push('Rice drink. The NHS says under-fives should not have rice drinks in place of milk, because of arsenic.');
  if ((under4 || age === '4-8') && SLUSH.test(about)) out.caution.push('Slush ice drink. The NHS warns these may contain too much glycerol for children aged 7 and under.');

  if (under4 && n.salt !== undefined && n.salt > 1.5) out.caution.push(`High in salt (${n.salt}g per 100g). Babies and young children should not have salty foods (US CDC, NHS).`);

  // The one choking risk a name can reveal: a pack of plain whole nuts.
  if (under4 && WHOLE_NUTS.test(name) && !NOT_WHOLE.test(name)) out.caution.push('Whole nuts are a choking risk: the NHS says not to give them to children under 5. Crushed, ground or as a thin spread is fine from about 6 months.');

  if (findTerm(text, MERCURY_FISH)) out.caution.push('Contains a fish high in mercury. The NHS says children under 16 should avoid shark, swordfish and marlin; the US CDC lists more for young children.');
  return out;
}

/** Folds the child checks into the verdict already worked out for allergies and diet. */
export function withChildChecks(base: Verdict, product: ProductData, age: AgeBand): Verdict {
  const c = childConcerns(product, age);
  if (!c.notForAge.length && !c.caution.length) return base;
  if (base.level === 'not-safe') return { ...base, reasons: [...base.reasons, ...c.notForAge], warnings: [...c.caution, ...base.warnings] };
  if (c.notForAge.length) return { level: 'not-safe', reasons: [...c.notForAge, ...c.caution], warnings: base.level === 'unknown' ? [...base.reasons, ...base.warnings] : base.warnings };
  if (base.level === 'unknown') return { ...base, warnings: [...c.caution, ...base.warnings] };
  return { level: 'caution', reasons: [...c.caution, ...(base.level === 'caution' ? base.reasons : [])], warnings: base.warnings };
}
