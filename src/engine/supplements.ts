import type { ProductData, Profile, SupplementFact, Verdict } from '../types';
import { computeVerdict, findTerm } from './verdict';

/**
 * Supplement check. Pure, deterministic, no network, no AI.
 *
 * It does NOT say whether a supplement works, and it cannot see contamination: that needs a lab.
 * It checks what a label can tell: how much of each vitamin and mineral a day's servings add up
 * to against the official safe upper limit, hidden amounts, caffeine, and the profile's rules.
 */

export type AgeBand = 'under1' | '1' | '2-3' | '4-8' | '9-18' | 'adult';
type Column = 'adult' | 'pregnancy' | '9-13' | '4-8';

type Limit = {
  label: string;
  unit: 'mg' | 'mcg';
  /** [adult, pregnancy, 9–13 years, 4–8 years] */
  ul: [number, number, number, number];
  match: RegExp;
  /** What the limit covers, when it is narrower than the nutrient's name. */
  note?: string;
};

export const LIMITS_SOURCE = 'Health Canada / US National Academies Dietary Reference Intakes';

/**
 * Tolerable Upper Intake Levels: the highest daily amount likely to pose no risk.
 * Read from Health Canada's Dietary Reference Intake tables (the US and Canada share them),
 * fetched November 2026. Adult figures use the lowest value across adult ages.
 * Ages 14–18 are checked against the 9–13 column, which is lower: an early warning, never a late one.
 */
export const LIMITS: Record<string, Limit> = {
  vitaminA: { label: 'Vitamin A', unit: 'mcg', ul: [3000, 3000, 1700, 900], match: /\bvitamin a\b|\bretin(ol|yl)\b/i, note: 'as preformed vitamin A (retinol); beta-carotene does not count' },
  vitaminD: { label: 'Vitamin D', unit: 'mcg', ul: [100, 100, 100, 75], match: /\bvitamin d\d?\b|\bcholecalciferol\b|\bergocalciferol\b/i },
  vitaminE: { label: 'Vitamin E', unit: 'mg', ul: [1000, 1000, 600, 300], match: /\bvitamin e\b|\btocopher/i },
  vitaminC: { label: 'Vitamin C', unit: 'mg', ul: [2000, 2000, 1200, 650], match: /\bvitamin c\b|\bascorb/i },
  niacin: { label: 'Niacin', unit: 'mg', ul: [35, 35, 20, 15], match: /\bniacin|\bnicotin(ic acid|amide)\b|\bvitamin b-?3\b/i },
  vitaminB6: { label: 'Vitamin B6', unit: 'mg', ul: [100, 100, 60, 40], match: /\bvitamin b-?6\b|\bpyridox/i },
  folate: { label: 'Folate (folic acid)', unit: 'mcg', ul: [1000, 1000, 600, 400], match: /\bfol(ate|ic acid)\b|\bvitamin b-?9\b/i, note: 'as folic acid from supplements' },
  choline: { label: 'Choline', unit: 'mg', ul: [3500, 3500, 2000, 1000], match: /\bcholine\b/i },
  calcium: { label: 'Calcium', unit: 'mg', ul: [2000, 2500, 3000, 2500], match: /\bcalcium\b/i },
  copper: { label: 'Copper', unit: 'mcg', ul: [10000, 10000, 5000, 3000], match: /\bcopper\b/i },
  fluoride: { label: 'Fluoride', unit: 'mg', ul: [10, 10, 10, 2.2], match: /\bfluoride\b/i },
  iodine: { label: 'Iodine', unit: 'mcg', ul: [1100, 1100, 600, 300], match: /\biodine\b|\biodide\b/i },
  iron: { label: 'Iron', unit: 'mg', ul: [45, 45, 40, 40], match: /\biron\b|\bferrous\b|\bferric\b/i },
  magnesium: { label: 'Magnesium', unit: 'mg', ul: [350, 350, 350, 110], match: /\bmagnesium\b/i, note: 'from supplements, not food' },
  manganese: { label: 'Manganese', unit: 'mg', ul: [11, 11, 6, 3], match: /\bmanganese\b/i },
  molybdenum: { label: 'Molybdenum', unit: 'mcg', ul: [2000, 2000, 1100, 600], match: /\bmolybdenum\b/i },
  phosphorus: { label: 'Phosphorus', unit: 'mg', ul: [3000, 3500, 4000, 3000], match: /\bphosphorus\b/i },
  selenium: { label: 'Selenium', unit: 'mcg', ul: [400, 400, 280, 150], match: /\bselenium\b/i },
  zinc: { label: 'Zinc', unit: 'mg', ul: [40, 40, 23, 12], match: /\bzinc\b/i },
  boron: { label: 'Boron', unit: 'mg', ul: [20, 20, 11, 6], match: /\bboron\b/i },
};

const COLUMNS: Column[] = ['adult', 'pregnancy', '9-13', '4-8'];

function columnFor(band: AgeBand, pregnant: boolean): Column {
  if (band === '4-8') return '4-8';
  if (band === '9-18') return '9-13';
  return pregnant ? 'pregnancy' : 'adult';
}

export function limitKey(name: string): string | null {
  // "Calcium (as calcium carbonate)": only the nutrient's own name decides, not the form in brackets.
  const head = name.replace(/\(.*$/, '').trim() || name;
  for (const [key, l] of Object.entries(LIMITS)) if (l.match.test(head)) return key;
  return null;
}

/**
 * Converts a label amount to the unit the limit is stated in. Returns null when it can't be done safely.
 * IU conversions: vitamin D 40 IU = 1 mcg and vitamin A (retinol) 1 IU = 0.3 mcg, both shown in the
 * Health Canada tables. Vitamin E uses 0.9 mg per IU, the most cautious reading (NOT confirmed from a
 * fetched source; modern labels state mg). Folate "mcg DFE" × 0.6 = mcg folic acid (US labelling rule).
 */
export function toLimitUnit(key: string, amount: number, unit: string, name = ''): number | null {
  const l = LIMITS[key];
  const u = unit.toLowerCase().replace(/\(s\)|\.|\s/g, '').replace('µ', 'μ');
  if (!l || !Number.isFinite(amount) || amount < 0) return null;
  let mg: number | null = null;
  if (/^(mg|milligrams?)/.test(u)) mg = amount;
  else if (/^(mcg|μg|ug|micrograms?)/.test(u)) mg = amount / 1000;
  else if (/^(g|grams?)$/.test(u)) mg = amount * 1000;
  else if (/^iu$/.test(u)) {
    if (key === 'vitaminD') mg = amount / 40 / 1000;
    else if (key === 'vitaminA') mg = (amount * 0.3) / 1000;
    else if (key === 'vitaminE') mg = amount * 0.9;
  }
  if (mg === null) return null;
  if (key === 'folate' && /dfe/i.test(`${unit} ${name}`)) mg *= 0.6;
  return l.unit === 'mg' ? mg : mg * 1000;
}

const trim = (n: number) => (n >= 100 ? String(Math.round(n)) : n >= 10 ? String(Math.round(n * 10) / 10) : String(Math.round(n * 100) / 100));

export type DoseLine = { key: string; label: string; amount: number; unit: string; limit: number; share: number; note?: string };

/** Adds up a day's worth of each limited nutrient across one or more supplements. */
export function dailyTotals(items: { facts: SupplementFact[]; perDay?: number }[], band: AgeBand, pregnant: boolean): DoseLine[] {
  const col = COLUMNS.indexOf(columnFor(band, pregnant));
  const totals = new Map<string, number>();
  for (const item of items) {
    const perDay = Math.min(12, Math.max(1, item.perDay ?? 1));
    const seen = new Set<string>();
    for (const f of item.facts) {
      const key = limitKey(f.name);
      if (!key || seen.has(key)) continue; // one row per nutrient per product
      // The vitamin A limit covers retinol only. A row that is entirely beta-carotene does not count.
      if (key === 'vitaminA' && /beta[- ]?carotene/i.test(f.name) && !/retin|palmitate|acetate/i.test(f.name)) continue;
      const v = toLimitUnit(key, f.amount, f.unit, f.name);
      if (v === null) continue;
      seen.add(key);
      totals.set(key, (totals.get(key) ?? 0) + v * perDay);
    }
  }
  return [...totals.entries()]
    .map(([key, amount]) => ({ key, label: LIMITS[key].label, amount, unit: LIMITS[key].unit, limit: LIMITS[key].ul[col], share: amount / LIMITS[key].ul[col], note: LIMITS[key].note }))
    .sort((a, b) => b.share - a.share);
}

export const doseText = (d: DoseLine) => `${trim(d.amount)} ${d.unit} a day — the official upper limit is ${trim(d.limit)} ${d.unit}`;

/* ---------- other label checks ---------- */

export type SupplementNote = { title: string; text: string; source?: string; tone: 'warn' | 'info' };

const CAFFEINE_SOURCES = { terms: ['guarana', 'green tea extract', 'yerba mate', 'kola nut', 'cola nut', 'coffee bean', 'green coffee', 'tea extract', 'matcha', 'cacao extract'] };
const SPIKING = { terms: ['glycine', 'taurine', 'creatine', 'l-glutamine', 'glutamine', 'beta-alanine', 'l-arginine'] };
const SEALS: [RegExp, string][] = [
  [/\busp verified\b/i, 'USP Verified'],
  [/\bnsf certified for sport\b/i, 'NSF Certified for Sport'],
  [/\bnsf (certified|contents certified)\b/i, 'NSF Certified'],
  [/\binformed[- ]sport\b/i, 'Informed Sport'],
  [/\binformed[- ]choice\b/i, 'Informed Choice'],
];

export function caffeinePerDay(p: ProductData): number | null {
  const s = p.supplement;
  if (!s) return null;
  let mg = 0;
  let found = false;
  for (const f of s.facts) {
    if (!/\bcaffeine\b/i.test(f.name)) continue;
    const u = f.unit.toLowerCase();
    const v = /^mg/.test(u) ? f.amount : /^(g|gram)/.test(u) ? f.amount * 1000 : null;
    if (v === null) continue;
    mg += v;
    found = true;
  }
  return found ? mg * Math.min(12, Math.max(1, s.perDay ?? 1)) : null;
}

export function supplementNotes(p: ProductData, profile: Profile): SupplementNote[] {
  const s = p.supplement;
  const text = `${p.ingredientsText ?? ''} ${(s?.facts ?? []).map((f) => f.name).join(', ')}`.toLowerCase();
  const out: SupplementNote[] = [];
  const pregnant = profile.rules.includes('pregnancy');

  if (s?.blends.length) {
    out.push({
      title: 'Amounts not disclosed',
      text: `${s.blends.slice(0, 3).join(', ')}: the label gives one total for the blend, not how much of each ingredient is inside. Doses can't be checked.`,
      tone: 'warn',
    });
  }

  const caffeine = caffeinePerDay(p);
  const hiddenSource = findTerm(text, CAFFEINE_SOURCES);
  if (caffeine !== null) {
    out.push({
      title: `Caffeine: ${trim(caffeine)} mg a day`,
      text:
        (caffeine > 400 ? 'More than the 400 mg a day the FDA cites as not generally associated with negative effects for most adults.' : 'The FDA cites 400 mg a day as an amount not generally associated with negative effects for most adults.') +
        (hiddenSource ? ` Also contains ${hiddenSource}, which adds caffeine the label doesn't count.` : '') +
        (pregnant ? ' If you are pregnant, ask your doctor about caffeine.' : ''),
      source: 'US Food and Drug Administration',
      tone: caffeine > 400 || pregnant ? 'warn' : 'info',
    });
  } else if (/\bcaffeine\b/.test(text) || hiddenSource) {
    out.push({
      title: 'Contains caffeine, amount not stated',
      text: `From ${/\bcaffeine\b/.test(text) ? 'caffeine' : hiddenSource}. The FDA cites 400 mg a day from all sources as an amount not generally associated with negative effects for most adults.${pregnant ? ' If you are pregnant, ask your doctor about caffeine.' : ''}`,
      source: 'US Food and Drug Administration',
      tone: 'warn',
    });
  }

  if (/st\.?\s?john'?s?[- ]?wort|hypericum/.test(text)) {
    out.push({
      title: 'St. John’s wort',
      text: 'Can weaken many medicines, including birth control pills, some antidepressants and the blood thinner warfarin. Ask a pharmacist before taking it with any medicine.',
      source: 'US National Center for Complementary and Integrative Health',
      tone: 'warn',
    });
  }

  const protein = proteinFacts(p);
  if (protein) {
    const spike = findTerm(text, SPIKING);
    out.push({
      title: `Protein: ${trim(protein.grams)} g per serving${protein.share !== null ? ` (${Math.round(protein.share * 100)}% of the scoop)` : ''}`,
      text:
        (protein.sugar !== null ? `Sugar: ${trim(protein.sugar)} g per serving. ` : '') +
        (spike ? `Lists ${spike} as an added ingredient. Added amino acids can raise the protein figure on a lab test without being complete protein.` : ''),
      tone: spike ? 'warn' : 'info',
    });
  }

  const seals = SEALS.filter(([re]) => re.test(text)).map(([, name]) => name);
  if (seals.length) {
    out.push({ title: `Label claims: ${[...new Set(seals)].join(', ')}`, text: 'An independent testing mark. Greenlit reads the claim from the label; it cannot confirm it.', tone: 'info' });
  }
  return out;
}

function grams(f: SupplementFact | undefined): number | null {
  if (!f) return null;
  const u = f.unit.toLowerCase();
  return /^(g|gram)/.test(u) ? f.amount : /^mg/.test(u) ? f.amount / 1000 : null;
}

export function proteinFacts(p: ProductData): { grams: number; share: number | null; sugar: number | null } | null {
  const s = p.supplement;
  if (!s) return null;
  const g = grams(s.facts.find((f) => /^\s*(total )?protein\b/i.test(f.name)));
  if (g === null || g < 5) return null;
  const sugar = grams(s.facts.find((f) => /^\s*(total |added )?sugars?\b/i.test(f.name)));
  const share = s.servingGrams && s.servingGrams >= g ? g / s.servingGrams : null;
  return { grams: g, share, sugar };
}

/* ---------- verdict ---------- */

export function computeSupplementVerdict(product: ProductData, profile: Profile, band: AgeBand = 'adult'): Verdict {
  if (band === 'under1' || band === '1' || band === '2-3') {
    return { level: 'unknown', reasons: ['Not checked for children under 4. Their upper limits are much lower. Ask a doctor before giving any supplement.'], warnings: [] };
  }
  // Allergies, diet rules and the avoid list work exactly as for food.
  const base = computeVerdict({ ...product, nutriments: undefined }, profile);
  if (base.level === 'not-safe') return base;

  const pregnant = profile.rules.includes('pregnancy');
  const over = dailyTotals(product.supplement ? [product.supplement] : [], band, pregnant).filter((d) => d.share > 1);
  const who = band === 'adult' ? (pregnant ? 'in pregnancy' : 'for adults') : `for ages ${band === '9-18' ? '9–18' : '4–8'}`;
  const overReasons = over.map((d) => `${d.label}: ${doseText(d)} ${who}${d.note ? ` (${d.note})` : ''}.`);

  // Too much preformed vitamin A in pregnancy is a recognised cause of birth defects: not a "caution".
  if (pregnant && over.some((d) => d.key === 'vitaminA')) {
    return { level: 'not-safe', reasons: overReasons, warnings: base.warnings };
  }
  if (base.level === 'unknown') return { ...base, warnings: [...overReasons, ...base.warnings] };

  const notes = supplementNotes(product, profile).filter((n) => n.tone === 'warn').map((n) => `${n.title}. ${n.text}`);
  const concerns = [...overReasons, ...(base.level === 'caution' ? base.reasons : []), ...notes];
  if (concerns.length) return { level: 'caution', reasons: concerns, warnings: base.warnings };

  if (!product.supplement?.facts.length) {
    return {
      level: 'safe',
      reasons: ['Nothing in the ingredients clashes with your profile.'],
      warnings: ['The amounts per serving aren’t in the database, so doses were not checked. Photograph the Supplement Facts panel to check them.'],
    };
  }
  return { level: 'safe', reasons: ['Nothing clashes with your profile, and no vitamin or mineral is above its official upper limit.'], warnings: base.warnings };
}
