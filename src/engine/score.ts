import type { Profile, ProductData, Score } from '../types';
import { avoidHits } from './verdict';

/** Personal score engine. Pure, deterministic, no network, no AI. */

const GRADE_BASE: Record<string, number> = { a: 90, b: 75, c: 55, d: 35, e: 15 };

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export type Band = { key: 'excellent' | 'good' | 'okay' | 'poor' | 'bad'; label: string };

export function bandFor(value: number): Band {
  if (value >= 80) return { key: 'excellent', label: 'Excellent for you' };
  if (value >= 60) return { key: 'good', label: 'Good for you' };
  if (value >= 40) return { key: 'okay', label: 'Okay sometimes' };
  if (value >= 20) return { key: 'poor', label: 'Poor for you' };
  return { key: 'bad', label: 'Bad for you' };
}

const signed = (n: number) => (n > 0 ? `+${n}` : `−${Math.abs(n)}`);

/** Returns null when there is not enough data to score honestly. */
export function computeScore(product: ProductData, profile: Profile): Score | null {
  const n = product.nutriments ?? {};
  const reasons: string[] = [];
  let value: number;

  const grade = product.nutriscoreGrade?.toLowerCase();
  if (grade && grade in GRADE_BASE) {
    value = GRADE_BASE[grade];
    reasons.push(`Base ${value} — from the generic Nutri-Score ${grade.toUpperCase()}.`);
  } else {
    const known = [n.sugars, n.salt, n.saturatedFat, n.fiber, n.protein].filter((v) => v !== undefined);
    if (known.length === 0) return null;
    value = 60;
    const parts: string[] = [];
    if (n.sugars !== undefined && n.sugars > 10) {
      value -= 10;
      if (n.sugars > 22.5) value -= 10;
      parts.push(n.sugars > 22.5 ? 'very high sugar −20' : 'high sugar −10');
    }
    if (n.salt !== undefined && n.salt > 1.5) {
      value -= 10;
      parts.push('high salt −10');
    }
    if (n.saturatedFat !== undefined && n.saturatedFat > 5) {
      value -= 10;
      parts.push('high saturated fat −10');
    }
    if (n.fiber !== undefined && n.fiber >= 3) {
      value += 10;
      parts.push('good fibre +10');
    }
    if (n.protein !== undefined && n.protein >= 8) {
      value += 10;
      parts.push('good protein +10');
    }
    value = clamp(value, 5, 95);
    reasons.push(
      `Base ${value} — no Nutri-Score, so estimated from nutrition per 100g${parts.length ? ` (${parts.join(', ')})` : ''}.`,
    );
  }

  const adjust = (points: number, why: string) => {
    value += points;
    reasons.push(`${signed(points)} — ${why}`);
  };

  if (profile.watch.includes('diabetes') || profile.watch.includes('low-sugar')) {
    if (n.sugars !== undefined && n.sugars > 5) {
      adjust(n.sugars > 15 ? -25 : -10, `high sugar for your sugar watch (${fmt(n.sugars)}g per 100g).`);
    }
  }

  if (profile.watch.includes('low-salt')) {
    if (n.salt !== undefined && n.salt > 0.6) {
      adjust(n.salt > 1.5 ? -20 : -10, `too salty for your low-salt profile (${fmt(n.salt)}g salt per 100g).`);
    }
  }

  if (profile.watch.includes('cholesterol')) {
    if (n.saturatedFat !== undefined && n.saturatedFat > 5) {
      adjust(n.saturatedFat > 10 ? -20 : -10, `high saturated fat for your cholesterol watch (${fmt(n.saturatedFat)}g per 100g).`);
    }
  }

  if (profile.watch.includes('low-carb')) {
    if (n.carbs !== undefined && n.carbs > 20) {
      adjust(n.carbs > 50 ? -20 : -10, `high in carbohydrates for your low-carb goal (${fmt(n.carbs)}g per 100g).`);
    }
  }

  for (const hit of avoidHits(product, profile)) {
    adjust(-10, `contains ${hit.label}, which you prefer to avoid.`);
  }

  if (profile.goal === 'lose-weight') {
    if (n.kcal !== undefined && n.kcal > 400) adjust(-10, `high in calories for your weight goal (${fmt(n.kcal)} kcal per 100g).`);
    if (n.fat !== undefined && n.fat > 20) adjust(-10, `high in fat for your weight goal (${fmt(n.fat)}g per 100g).`);
  }

  if (profile.goal === 'build-muscle') {
    if (n.protein !== undefined && n.protein >= 10) {
      adjust(n.protein >= 20 ? 15 : 10, `good protein for your goal (${fmt(n.protein)}g per 100g).`);
    }
  }

  if (profile.goal === 'eat-cleaner') {
    if (product.novaGroup === 4) adjust(-10, 'ultra-processed (NOVA group 4).');
    else if (product.novaGroup === 1) adjust(5, 'unprocessed or minimally processed (NOVA group 1).');
  }

  value = clamp(Math.round(value), 0, 100);
  return { value, band: bandFor(value).label, reasons };
}

export function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(n < 1 ? 2 : 1).replace(/\.?0+$/, '');
}
