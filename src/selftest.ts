/**
 * Developer self-test (local development only; never shipped).
 * Runs label-photo reading and the AI explanation for real, with the key saved
 * in this browser, against a known test label, and reports pass/fail.
 * The key itself is never included in the report.
 */
import { explainIngredients, lastModelUsed, readLabelPhoto } from './data/gemini';
import { computeVerdict } from './engine/verdict';
import { computeScore } from './engine/score';
import { loadGeminiKey } from './storage';
import type { Profile } from './types';

const TEST_PROFILE: Profile = { allergies: ['peanuts'], rules: ['halal'], watch: ['diabetes'], goal: 'none' };

type Check = { name: string; pass: boolean; got: string };

export async function runSelfTest() {
  const root = document.getElementById('app')!;
  const show = (html: string) => (root.innerHTML = `<main class="view"><h1 class="title">Label photo <em>self-test</em></h1>${html}</main>`);
  const report: Record<string, unknown> = { when: new Date().toISOString(), browser: navigator.userAgent };
  const send = () => fetch('/__selftest', { method: 'POST', body: JSON.stringify(report, null, 1) }).catch(() => undefined);

  const key = loadGeminiKey();
  if (!key) {
    report.outcome = 'no-key';
    show('<div class="notice notice--warn"><strong>No Gemini key is saved in this browser.</strong><p>Open this same link in the browser where you saved your key, or add the key under Settings → Set up AI extras, then reload this page.</p></div>');
    return send();
  }

  show('<div class="notice notice--busy"><span class="spinner"></span>Reading the test label with your key… (real call to Google)</div>');
  const checks: Check[] = [];
  try {
    const blob = await (await fetch('/release/test-label.jpg')).blob();
    const file = new File([blob], 'test-label.jpg', { type: 'image/jpeg' });
    const t0 = performance.now();
    const product = await readLabelPhoto(file, key);
    report.photoSeconds = +((performance.now() - t0) / 1000).toFixed(1);
    report.model = lastModelUsed();
    report.product = product;

    const verdict = computeVerdict(product, TEST_PROFILE);
    const score = computeScore(product, TEST_PROFILE);
    report.verdict = verdict;
    report.score = score;
    const n = product.nutriments ?? {};
    const near = (v: number | undefined, want: number) => v !== undefined && Math.abs(v - want) < 0.05;
    const text = (product.ingredientsText ?? '').toLowerCase();
    const reasons = verdict.reasons.join(' ').toLowerCase();
    checks.push(
      { name: 'Ingredients were read and translated to English', pass: /wheat/.test(text) && /peanut/.test(text) && /pork/.test(text), got: product.ingredientsText ?? '(nothing)' },
      { name: 'Verdict is Not safe', pass: verdict.level === 'not-safe', got: verdict.level },
      { name: 'Peanut allergy caught', pass: /peanut/.test(reasons), got: verdict.reasons.join(' | ') },
      { name: 'Pork caught for halal', pass: /pork/.test(reasons) && /halal/.test(reasons), got: verdict.reasons.join(' | ') },
      { name: '"May contain" allergens kept as traces, not as ingredients', pass: product.traces.includes('nuts') && !product.allergens.includes('nuts'), got: `contains: ${product.allergens.join(', ')} · traces: ${product.traces.join(', ')}` },
      { name: 'Sugar read as 28g', pass: near(n.sugars, 28), got: String(n.sugars) },
      { name: 'Salt read as 0.6g (label uses a comma: 0,6)', pass: near(n.salt, 0.6), got: String(n.salt) },
      { name: 'Fat read as 24g', pass: near(n.fat, 24), got: String(n.fat) },
      { name: 'Saturated fat read as 9g', pass: near(n.saturatedFat, 9), got: String(n.saturatedFat) },
      { name: 'Protein read as 8g', pass: near(n.protein, 8), got: String(n.protein) },
      { name: 'Energy read as 480 kcal (not the kJ figure)', pass: near(n.kcal, 480), got: String(n.kcal) },
      { name: 'Personal score is 15', pass: score?.value === 15, got: String(score?.value) },
    );

    show('<div class="notice notice--busy"><span class="spinner"></span>Label read. Now asking for the AI explanation…</div>');
    try {
      const t1 = performance.now();
      const ai = await explainIngredients(product, key);
      report.aiSeconds = +((performance.now() - t1) / 1000).toFixed(1);
      report.ai = ai;
      checks.push({ name: 'AI explanation returned an overview and ingredients', pass: ai.overview.length > 30 && ai.ingredients.length > 0, got: `${ai.ingredients.length} ingredients — ${ai.overview}` });
    } catch (e) {
      report.aiError = e instanceof Error ? e.message : String(e);
      checks.push({ name: 'AI explanation returned an overview and ingredients', pass: false, got: String(report.aiError) });
    }
    report.outcome = checks.every((c) => c.pass) ? 'all-passed' : 'some-failed';
  } catch (e) {
    report.outcome = 'error';
    report.error = e instanceof Error ? e.message : String(e);
    checks.push({ name: 'Label photo could be read', pass: false, got: String(report.error) });
  }
  report.checks = checks;

  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
  const passed = checks.filter((c) => c.pass).length;
  show(`
    <div class="notice ${passed === checks.length ? 'notice--ok' : 'notice--warn'}"><strong>${passed} of ${checks.length} checks passed.</strong>
      <p>Model: ${esc(String(report.model ?? '?'))} · photo ${report.photoSeconds ?? '?'}s${report.aiSeconds ? ` · AI ${report.aiSeconds}s` : ''}</p></div>
    <ul class="insights">${checks.map((c) => `<li class="insight insight--${c.pass ? 'good' : 'bad'}"><span class="insight__dot"></span><div><strong>${c.pass ? '✓' : '✕'} ${esc(c.name)}</strong><small>Got: ${esc(c.got).slice(0, 260)}</small></div></li>`).join('')}</ul>
    <p class="hint">Result was reported to the developer console on this Mac. Your key was not included.</p>
    <a class="btn btn--primary btn--big" href="./">Back to the app</a>`);
  await send();
}
