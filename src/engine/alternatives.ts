import type { ProductData } from '../types';
import { ADDED_SUGAR, CAFFEINE, SWEETENERS, findTerm } from './verdict';

/**
 * Chooses "healthier options" from candidates the database returned. Pure and deterministic.
 *
 * The database's shelves are messy: its "biscuits" hold instant oatmeal and brewer's yeast, its
 * "sodas" hold protein drinks, and some entries carry one product's name on another's barcode.
 * A suggestion people can't make sense of is worse than none, so a candidate must clear every
 * gate below, and when nothing does the answer is an honest "nothing found".
 */

export type Alt = { product: ProductData; score: number; reasons: string[] };

export type AltContext = {
  /** The user's personal score for a product, when it can be scored. */
  scoreOf(p: ProductData): number | undefined;
  /** Passes the profile of everyone being shopped for. */
  passes(p: ProductData): boolean;
};

/** Enough people have scanned it that it is a real, findable product with a checked entry. */
const MIN_SCANS = 5;
const LIQUID = /\b(water|juice|milk|tea|coffee|infusion|whey|kombucha|coconut water|eau|jus|lait|agua|zumo|leche|wasser|saft|milch)\b/i;
const DRINK = /\bbeverages?\b|\bdrinks?\b|\bwaters?\b|\bjuices?\b|\bsodas?\b/;
/** Shelves that are a different purchase even when the database files them alongside. */
const OTHER_SHELF = /energy-drinks|protein|meal-replacement|dietary-supplements|sports-nutrition|(^|\s)alcoholic|baby-foods|infant/;

const n1 = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

export function pickAlternatives(scanned: ProductData, candidates: ProductData[], ctx: AltContext, limit = 4): Alt[] {
  const mine = ctx.scoreOf(scanned) ?? 0;
  const myCats = new Set(scanned.categories ?? []);
  const isDrink = DRINK.test([...myCats].join(' '));
  const a = scanned.nutriments ?? {};
  const myText = (scanned.ingredientsText ?? '').toLowerCase();
  const mySweet = !!findTerm(myText, SWEETENERS);
  const myCaffeine = !!findTerm(myText, CAFFEINE);
  const mySugarAdded = !!findTerm(myText, ADDED_SUGAR);

  const out: Alt[] = [];
  for (const c of candidates) {
    if (!c.barcode || c.barcode === scanned.barcode) continue;
    const text = (c.ingredientsText ?? '').toLowerCase();
    const cats = c.categories ?? [];
    const b = c.nutriments ?? {};

    // 1. A real, checkable, findable entry.
    if (!text || !c.imageUrl || c.name.trim().length < 3) continue;
    if ((c.popularity ?? 0) < MIN_SCANS) continue;
    if (c.ingredientLangs?.length && !c.ingredientLangs.includes('en')) continue;
    if (c.unknownShare !== undefined && c.unknownShare > 0.5) continue;

    // 2. The same shelf.
    const shared = cats.filter((t) => myCats.has(t)).length;
    if (shared < Math.min(3, myCats.size)) continue;
    if (OTHER_SHELF.test(cats.join(' ')) && !OTHER_SHELF.test([...myCats].join(' '))) continue;
    // A drink's first ingredient is a liquid. This catches a wrong product filed under a drink's barcode.
    if (isDrink && !LIQUID.test(text.split(/[,;(]/)[0] ?? '')) continue;

    // 3. Right for the people being shopped for.
    if (!ctx.passes(c)) continue;

    // 4. Better with no trade-off: swapping sugar for sweeteners or caffeine is not "healthier".
    if (findTerm(text, SWEETENERS)) continue;
    if (!myCaffeine && findTerm(text, CAFFEINE)) continue;
    if (c.novaGroup && scanned.novaGroup && c.novaGroup > scanned.novaGroup) continue;
    const worse = (x: number | undefined, y: number | undefined, slack: number) => x !== undefined && y !== undefined && x > y * 1.1 + slack;
    if (worse(b.sugars, a.sugars, 0.5) || worse(b.salt, a.salt, 0.1) || worse(b.saturatedFat, a.saturatedFat, 0.5)) continue;
    const score = ctx.scoreOf(c);
    if (score === undefined || score < 60 || score < mine + 15) continue;

    // 5. Say why, in numbers.
    const reasons: string[] = [];
    const less = (x: number | undefined, y: number | undefined, min: number) => x !== undefined && y !== undefined && y >= min && x <= y * 0.7;
    if (mySugarAdded && !findTerm(text, ADDED_SUGAR) && (b.sugars === undefined || b.sugars <= 5)) reasons.push('No added sugar');
    else if (less(b.sugars, a.sugars, 3)) reasons.push(`${n1(b.sugars!)}g sugar per 100g, not ${n1(a.sugars!)}g`);
    if (less(b.salt, a.salt, 0.5)) reasons.push(`${n1(b.salt!)}g salt, not ${n1(a.salt!)}g`);
    if (less(b.saturatedFat, a.saturatedFat, 2)) reasons.push(`${n1(b.saturatedFat!)}g saturated fat, not ${n1(a.saturatedFat!)}g`);
    if (mySweet) reasons.push('No sweeteners');
    if (c.novaGroup && scanned.novaGroup && c.novaGroup < scanned.novaGroup) reasons.push(`NOVA group ${c.novaGroup}, not ${scanned.novaGroup}`);
    if (!reasons.length) continue; // a higher number with nothing to point to is not a reason

    out.push({ product: c, score, reasons: reasons.slice(0, 2) });
  }

  // One per brand, most reasons first, then score, then how well known it is.
  out.sort((x, y) => y.reasons.length - x.reasons.length || y.score - x.score || (y.product.popularity ?? 0) - (x.product.popularity ?? 0));
  const brands = new Set<string>();
  const names = new Set<string>();
  return out.filter((alt) => {
    const brand = (alt.product.brand ?? alt.product.name).toLowerCase();
    const name = alt.product.name.toLowerCase();
    if (brands.has(brand) || names.has(name)) return false;
    brands.add(brand);
    names.add(name);
    return true;
  }).slice(0, limit);
}
