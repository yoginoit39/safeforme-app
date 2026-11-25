import { printedUpc } from './dsld';

/**
 * US Food and Drug Administration recall notices (openFDA). Free, no key.
 * Matched by the exact printed barcode only: a name match could accuse the wrong product.
 */

export type Recall = { date: string; firm: string; reason: string; status: string };

const cache = new Map<string, Promise<Recall | null>>();

export function recallFor(barcode: string): Promise<Recall | null> {
  let job = cache.get(barcode);
  if (!job) {
    job = find(barcode).catch(() => null);
    cache.set(barcode, job);
  }
  return job;
}

async function find(barcode: string): Promise<Recall | null> {
  const upc = printedUpc(barcode);
  if (!upc) return null;
  const q = `(product_description:"${upc}"+code_info:"${upc}")`;
  const url = `https://api.fda.gov/food/enforcement.json?search=${encodeURIComponent(q).replace(/%2B/g, '+')}&sort=recall_initiation_date:desc&limit=5`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { referrerPolicy: 'no-referrer', signal: controller.signal });
    if (!res.ok) return null; // 404 means no notice
    const json = await res.json();
    const digits = upc.replace(/\D/g, '');
    for (const r of Array.isArray(json?.results) ? json.results : []) {
      // The search is word-based: confirm the full barcode appears in the notice.
      const text = `${r.product_description ?? ''} ${r.code_info ?? ''}`.replace(/[\s-]/g, '');
      if (!text.includes(digits)) continue;
      const d = String(r.recall_initiation_date ?? '');
      return {
        date: /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : '',
        firm: String(r.recalling_firm ?? '').slice(0, 80),
        reason: String(r.reason_for_recall ?? '').slice(0, 300),
        status: String(r.status ?? ''),
      };
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}
