import type { ProductData, SupplementFact } from '../types';

/**
 * US National Institutes of Health Dietary Supplement Label Database.
 * Free, no key. Holds the full Supplement Facts panel of US products: every amount per serving.
 */

const BASE = 'https://api.ods.od.nih.gov/dsld/v9';
const TIMEOUT_MS = 10_000;

/** The database stores barcodes the way they are printed: "0 74312 72694 1". */
export function printedUpc(barcode: string): string | null {
  let d = barcode.replace(/\D/g, '');
  if (d.length === 13 && d.startsWith('0')) d = d.slice(1);
  if (d.length !== 12) return null; // only US-style 12-digit codes are in this database
  return `${d[0]} ${d.slice(1, 6)} ${d.slice(6, 11)} ${d[11]}`;
}

async function getJson(url: string): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { referrerPolicy: 'no-referrer', signal: controller.signal });
    if (!res.ok) throw new Error(String(res.status));
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const UNITS: Record<string, string> = { 'gram(s)': 'g', 'milligram(s)': 'mg', 'microgram(s)': 'mcg', 'international unit(s)': 'IU' };
const unitOf = (u: unknown) => {
  const s = str(u) ?? '';
  return UNITS[s.toLowerCase()] ?? s;
};

export function mapDsldLabel(barcode: string, d: Record<string, any>): ProductData {
  const facts: SupplementFact[] = [];
  const blends: string[] = [];
  const names: string[] = [];
  const walk = (rows: unknown, depth: number) => {
    if (!Array.isArray(rows)) return;
    for (const r of rows as Record<string, any>[]) {
      const name = str(r?.name);
      if (!name) continue;
      names.push(name);
      const q = Array.isArray(r.quantity) ? r.quantity.find((x: any) => x?.servingSizeOrder === 1) ?? r.quantity[0] : null;
      const amount = typeof q?.quantity === 'number' ? q.quantity : Number(q?.quantity);
      const unit = unitOf(q?.unit);
      const nested = Array.isArray(r.nestedRows) && r.nestedRows.length > 0;
      const isBlend = /blend|proprietary|complex|matrix/i.test(`${r.category ?? ''} ${r.ingredientGroup ?? ''} ${name}`) && nested;
      if (isBlend && r.nestedRows.every((n: any) => !(Array.isArray(n?.quantity) && n.quantity.some((x: any) => Number(x?.quantity) > 0)))) blends.push(name);
      if (depth === 0 && Number.isFinite(amount) && amount > 0 && unit && !/calorie/i.test(unit)) facts.push({ name, amount, unit });
      walk(r.nestedRows, depth + 1);
    }
  };
  walk(d.ingredientRows, 0);

  const other = Array.isArray(d.otheringredients?.ingredients) ? d.otheringredients.ingredients.map((i: any) => str(i?.name)).filter(Boolean) : [];
  const otherText = str(d.otheringredients?.text);
  const statements = Array.isArray(d.statements) ? (d.statements as Record<string, any>[]) : [];
  const allergy = statements.filter((s) => /allerg/i.test(String(s?.type))).map((s) => str(s?.notes)).filter(Boolean);
  const seals = statements.filter((s) => /seal|certif|quality/i.test(String(s?.type))).map((s) => str(s?.notes)).filter(Boolean);
  const serving = Array.isArray(d.servingSizes) ? d.servingSizes[0] : null;
  const servingUnit = unitOf(serving?.unit);
  const servingQty = Number(serving?.minQuantity);
  const perDay = Number(serving?.maxDailyServings ?? serving?.minDailyServings);

  // Everything the checks should read: active ingredients, other ingredients, allergy lines, seals.
  const ingredientsText = [[...new Set(names)].join(', '), other.length ? other.join(', ') : otherText, ...allergy, ...seals].filter(Boolean).join('. ');
  const thumb = str(d.thumbnail);

  return {
    barcode,
    name: str(d.fullName) ?? 'Supplement',
    brand: str(d.brandName),
    imageUrl: thumb?.startsWith('https://') ? thumb : undefined,
    ingredientsText: ingredientsText || undefined,
    ingredientItems: other.length ? (other as string[]) : undefined,
    ingredientNotes: allergy.length ? (allergy as string[]) : undefined,
    allergens: [],
    traces: [],
    labels: [],
    kind: 'supplement',
    supplement: {
      serving: Number.isFinite(servingQty) && servingUnit ? `${servingQty} ${servingUnit.replace(/\(s\)/i, servingQty === 1 ? '' : 's')}` : undefined,
      servingGrams: servingUnit === 'g' && Number.isFinite(servingQty) ? servingQty : undefined,
      perDay: Number.isFinite(perDay) && perDay >= 1 ? Math.min(12, perDay) : 1,
      facts,
      blends,
    },
    userLang: 'en',
    source: 'dsld',
  };
}

/** Looks a US supplement up by barcode. Returns null when it is not in the database. */
export async function lookupDsld(barcode: string): Promise<ProductData | null> {
  const upc = printedUpc(barcode);
  if (!upc) return null;
  const found = await getJson(`${BASE}/search-filter?q=${encodeURIComponent(`"${upc}"`)}&size=5`);
  const hits = Array.isArray(found?.hits) ? found.hits : Array.isArray(found?.hits?.hits) ? found.hits.hits : [];
  // Several label versions can share a barcode: the newest entry that is still on the market wins.
  const best = hits
    .map((h: any) => ({ id: String(h?._id ?? ''), off: String(h?._source?.offMarket ?? '0') === '1', date: String(h?._source?.entryDate ?? '') }))
    .filter((h: { id: string }) => /^\d+$/.test(h.id))
    .sort((a: any, b: any) => Number(a.off) - Number(b.off) || b.date.localeCompare(a.date))[0];
  if (!best) return null;
  const label = await getJson(`${BASE}/label/${best.id}`);
  // The search matches text anywhere on the label, so confirm the barcode really is this product's.
  if (String(label?.upcSku ?? '').replace(/\D/g, '') !== upc.replace(/\D/g, '')) return null;
  return mapDsldLabel(barcode, label);
}
