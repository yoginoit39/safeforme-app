import '@fontsource-variable/fraunces/wght.css';
import './style.css';
import { App as NativeApp } from '@capacitor/app';
import type { HistoryEntry, ProductData, Profile, Verdict } from './types';
import { computeVerdict } from './engine/verdict';
import { bandFor, computeScore, fmt } from './engine/score';
import { explain, type Explanation } from './engine/explain';
import { DEMO_EMOJI, DEMO_PRODUCTS, SAMPLE_BARCODES } from './data/demo';
import { LookupError, lookupBarcode } from './data/off';
import { PhotoError, explainIngredients, readLabelPhoto, testKey, type AiExplanation } from './data/gemini';
import { prewarmScanner, scannerSupported, startScan, type ScanSession } from './scanner';
import {
  addHistory, deleteAllData, loadFlags, loadGeminiKey, loadHistory, loadProfile, loadStats, recordScan,
  saveGeminiKey, saveProfile, setFlag,
} from './storage';

// ---------- constants ----------

const DISCLAIMER =
  'Not medical advice. Product data comes from Open Food Facts and can be incomplete or wrong. Always check the physical label.';

const ATTRIBUTION =
  'Product data: <a href="https://world.openfoodfacts.org" target="_blank" rel="noopener noreferrer">Open Food Facts</a> (ODbL)';

const ALLERGY_OPTS: [string, string][] = [
  ['peanuts', 'Peanuts'], ['tree-nuts', 'Tree nuts'], ['milk', 'Milk'], ['egg', 'Egg'], ['soy', 'Soy'],
  ['gluten', 'Wheat / gluten'], ['fish', 'Fish'], ['shellfish', 'Shellfish'], ['sesame', 'Sesame'],
  ['celery', 'Celery'], ['mustard', 'Mustard'], ['lupin', 'Lupin'], ['sulphites', 'Sulphites'],
];
const RULE_OPTS: [string, string, string][] = [
  ['halal', 'Halal', 'Flags pork and alcohol. Only certified products can show SAFE.'],
  ['kosher', 'Kosher', 'Flags pork and shellfish. Only certified products can show SAFE.'],
  ['vegan', 'Vegan', 'Flags any animal ingredient.'],
  ['vegetarian', 'Vegetarian', 'Flags meat, fish and gelatin.'],
  ['pregnancy', 'Pregnancy', 'Flags alcohol, warns on caffeine.'],
  ['celiac', 'Coeliac / gluten-free', 'Flags gluten, traces of gluten, and oats without a gluten-free label.'],
  ['lactose', 'Lactose intolerant', 'Flags milk ingredients unless the product is labelled lactose-free.'],
];
const WATCH_OPTS: [string, string, string][] = [
  ['diabetes', 'Diabetes', 'Watch sugar.'],
  ['low-sugar', 'Low sugar', 'Watch sugar in general.'],
  ['low-salt', 'Low salt', 'Watch salt, e.g. for blood pressure.'],
  ['cholesterol', 'Cholesterol', 'Watch saturated fat.'],
  ['low-carb', 'Low carb / keto', 'Watch carbohydrates.'],
];
/** Things people choose to avoid. Stored with the health-watch items; they lower the score and add a warning. */
const AVOID_OPTS: [string, string][] = [
  ['no-palm-oil', 'Palm oil'], ['no-added-sugar', 'Added sugar'], ['no-sweeteners', 'Sweeteners'],
  ['no-additives', 'Additives'], ['no-caffeine', 'Caffeine'],
];
const GOAL_OPTS: [Profile['goal'], string][] = [
  ['none', 'No goal'], ['lose-weight', 'Lose weight'], ['build-muscle', 'Build muscle'], ['eat-cleaner', 'Eat cleaner'],
];

const VERDICT_TITLE = { safe: 'Safe for you', 'not-safe': 'Not safe', unknown: 'Can’t confirm' } as const;
const VERDICT_SHORT = { safe: 'Safe', 'not-safe': 'Not safe', unknown: "Can't confirm" } as const;
const ICONS = {
  scan: '<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M7.5 12h9"/>',
  history: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  profile: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 19.5c1.2-3.2 3.8-4.8 7-4.8s5.8 1.6 7 4.8"/>',
  settings: '<path d="M5 7h8M19 7h0M5 17h0M11 17h8"/><circle cx="16" cy="7" r="2.2"/><circle cx="8" cy="17" r="2.2"/>',
  camera: '<path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.2-2h6.6l1.2 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z"/><circle cx="12" cy="13" r="3.2"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  cross: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  question: '<path d="M9 9.2a3 3 0 1 1 4.6 2.5c-.9.6-1.6 1.2-1.6 2.4M12 17.7h0"/>',
  warning: '<path d="M12 4.5l8.5 14.5h-17zM12 10.5v3.5M12 16.6h0"/>',
  shield: '<path d="M12 3.5l7 2.6v5.4c0 4.2-2.8 7.3-7 9-4.2-1.7-7-4.8-7-9V6.1z"/><path d="M9 12l2.2 2.2L15.2 10"/>',
} as const;

const icon = (name: keyof typeof ICONS) =>
  `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

const VERDICT_ICON = { safe: 'check', 'not-safe': 'cross', unknown: 'question' } as const;
const ALLERGY_SINGULAR: Record<string, string> = { peanuts: 'peanut', 'tree-nuts': 'tree nut', gluten: 'wheat/gluten' };

// ---------- state ----------

type View = 'welcome' | 'scan' | 'result' | 'profile' | 'history' | 'settings' | 'key';
type Notice = { kind: 'error' | 'info' | 'warn' | 'not-found' | 'saved'; text: string };
type HistoryFilter = 'all' | Verdict['level'];
type InstallEvent = Event & { prompt(): Promise<unknown> };

let profile: Profile = loadProfile();
let view: View = loadFlags().onboarded || profileSummary(profile) || loadHistory().length ? 'scan' : 'welcome';
let onboarding = view === 'welcome';
let current: ProductData | null = null;
let notice: Notice | null = null;
let busy: string | null = null;
let scanning = false;
let scanSession: ScanSession | null = null;
let deleteArmed = false;
let historyFilter: HistoryFilter = 'all';
let installEvent: InstallEvent | null = null;
let animateScore = false;
let keyDraft = '';
/** AI explanation for the product currently open. Kept in memory only. */
let ai: { product: ProductData; status: 'busy' | 'done' | 'error'; data?: AiExplanation; error?: string } | null = null;

const app = document.getElementById('app')!;

/** True inside the Android / iOS store build (the app shell provides window.Capacitor). */
const isNativeApp = () =>
  !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();

const isStandalone = () =>
  isNativeApp() ||
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as unknown as { standalone?: boolean }).standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

// ---------- helpers ----------

const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function labelOf(opts: readonly (readonly string[])[], id: string): string {
  return opts.find((o) => o[0] === id)?.[1] ?? id;
}

function profileParts(p: Profile): string[] {
  return [
    ...p.allergies.map((a) => `${ALLERGY_SINGULAR[a] ?? labelOf(ALLERGY_OPTS, a).toLowerCase()} allergy`),
    ...p.rules.map((r) => labelOf(RULE_OPTS, r).toLowerCase()),
    ...p.watch.map((w) => (w.startsWith('no-') ? `no ${labelOf(AVOID_OPTS, w).toLowerCase()}` : labelOf(WATCH_OPTS, w).toLowerCase())),
    ...(p.goal !== 'none' ? [labelOf(GOAL_OPTS, p.goal).toLowerCase()] : []),
  ];
}

function profileSummary(p: Profile): string {
  return profileParts(p).join(' · ');
}

function go(next: View, keepNotice = false, fromBackButton = false) {
  stopScanner();
  if (!keepNotice) notice = null;
  deleteArmed = false;
  view = next;
  // Each screen is a history entry, so the phone's Back button steps back through the app instead of closing it.
  if (!fromBackButton && history.state?.view !== next) history.pushState({ view: next }, '');
  render();
  window.scrollTo(0, 0);
}

function stopScanner() {
  scanSession?.stop();
  scanSession = null;
  scanning = false;
}

function finishOnboarding() {
  onboarding = false;
  setFlag('onboarded');
}

// ---------- actions ----------

function openResult(product: ProductData, fresh: boolean) {
  if (ai?.product !== product) ai = null;
  current = product;
  if (fresh) {
    const level = computeVerdict(product, profile).level;
    addHistory(product);
    recordScan(level === 'not-safe');
    navigator.vibrate?.(level === 'not-safe' ? [90, 60, 90] : 30);
  }
  animateScore = true;
  go('result');
}

async function lookup(raw: string) {
  const barcode = raw.replace(/\D/g, '');
  if (barcode.length < 6 || barcode.length > 14) {
    notice = { kind: 'error', text: 'That doesn’t look like a barcode. Type the 8–13 digits printed under the bars.' };
    render();
    return;
  }
  stopScanner();
  // Scanned in the last day? Reuse it: instant, works offline, and spares the free product database.
  const recent = loadHistory().find(
    (e) => e.product.barcode === barcode && e.product.source === 'openfoodfacts' && Date.now() - e.time < 24 * 60 * 60 * 1000,
  );
  if (recent) {
    busy = null;
    openResult(recent.product, true);
    return;
  }
  notice = null;
  busy = 'Looking up the product…';
  if (view !== 'scan') view = 'scan';
  render();
  try {
    const result = await lookupBarcode(barcode);
    busy = null;
    if (result.status === 'found') {
      openResult(result.product, true);
    } else {
      notice = { kind: 'not-found', text: `Product not in the database (barcode ${barcode}).` };
      render();
    }
  } catch (e) {
    busy = null;
    notice = {
      kind: 'error',
      text:
        e instanceof LookupError && e.kind === 'busy'
          ? 'The product database is busy right now. Wait a few seconds and try again — or try the offline demo products below.'
          : 'Can’t reach Open Food Facts right now. Check your connection, or try the offline demo products below.',
    };
    render();
  }
}

async function beginScan() {
  notice = null;
  if (!scannerSupported()) {
    notice = {
      kind: 'info',
      text: 'This browser can’t open the camera here. Type the barcode digits below instead.',
    };
    render();
    document.getElementById('barcode-input')?.focus();
    return;
  }
  scanning = true;
  render();
  const video = document.getElementById('scan-video') as HTMLVideoElement | null;
  if (!video) return;
  try {
    const session = await startScan(video, (code) => {
      scanSession = null;
      scanning = false;
      void lookup(code);
    });
    if (scanning && document.body.contains(video)) scanSession = session;
    else session.stop(); // user left the scanner while the camera was opening
  } catch {
    stopScanner();
    notice = {
      kind: 'info',
      text: 'The camera couldn’t be opened (permission denied or no camera). Type the barcode digits below instead.',
    };
    render();
  }
}

/**
 * The photo pickers live outside the app root, so they exist on every screen
 * and survive re-renders. One opens the camera, the other the photo library.
 */
function makePhotoInput(id: string, camera: boolean): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'file';
  input.id = id;
  input.accept = 'image/*';
  if (camera) input.setAttribute('capture', 'environment');
  input.hidden = true;
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = '';
    if (file) void handlePhoto(file);
  });
  document.body.appendChild(input);
  return input;
}
const cameraInput = makePhotoInput('photo-input', true);
const libraryInput = makePhotoInput('photo-library-input', false);

function requestPhoto(from: 'camera' | 'library' = 'camera') {
  if (!loadGeminiKey()) {
    // No key: walk the user through getting one. No network call is made.
    go('key');
    return;
  }
  (from === 'camera' ? cameraInput : libraryInput).click();
}

async function handlePhoto(file: File) {
  const key = loadGeminiKey();
  if (!key) return requestPhoto();
  notice = null;
  busy = 'Reading the label photo…';
  render();
  try {
    const product = await readLabelPhoto(file, key);
    busy = null;
    openResult(product, true);
  } catch (e) {
    busy = null;
    notice = {
      kind: 'error',
      text: e instanceof PhotoError ? e.message : 'Something went wrong reading that photo. Please try again.',
    };
    render();
  }
}

async function askAi() {
  const product = current;
  if (!product?.ingredientsText) return;
  const key = loadGeminiKey();
  if (!key) {
    go('key');
    return;
  }
  ai = { product, status: 'busy' };
  render();
  try {
    const data = await explainIngredients(product, key);
    if (ai?.product === product) ai = { product, status: 'done', data };
  } catch (e) {
    if (ai?.product === product) {
      ai = { product, status: 'error', error: e instanceof PhotoError ? e.message : 'Something went wrong asking the AI. Please try again.' };
    }
  }
  if (view === 'result' && current === product) render();
}

function saveProfileFromForm(form: HTMLFormElement) {
  const data = new FormData(form);
  profile = {
    allergies: data.getAll('allergies').map(String),
    rules: data.getAll('rules').map(String),
    watch: data.getAll('watch').map(String),
    goal: String(data.get('goal') ?? 'none') as Profile['goal'],
  };
  saveProfile(profile);
  if (onboarding) {
    finishOnboarding();
    notice = { kind: 'saved', text: 'You’re set. Scan your first product — or tap a sample below.' };
    go('scan', true);
  } else if (current) {
    animateScore = true;
    go('result'); // re-scored with the new profile
  } else {
    notice = { kind: 'saved', text: 'Profile saved on this device.' };
    render();
  }
}

// ---------- views ----------

function noticeHtml(): string {
  if (busy) return `<div class="notice notice--busy" role="status"><span class="spinner"></span>${esc(busy)}</div>`;
  if (!notice) return '';
  if (notice.kind === 'not-found') {
    return `<div class="notice notice--warn" role="alert">
      <strong>${esc(notice.text)}</strong>
      <p>You can photograph the ingredients label instead and get the same answers.</p>
      <button class="btn btn--small" data-action="photo">Photograph the label</button>
    </div>`;
  }
  const cls = notice.kind === 'error' ? 'notice--error' : notice.kind === 'saved' ? 'notice--ok' : notice.kind === 'warn' ? 'notice--warn' : 'notice--info';
  return `<div class="notice ${cls}" role="${notice.kind === 'error' ? 'alert' : 'status'}">${esc(notice.text)}</div>`;
}

function welcomeView(): string {
  return `
    <div class="welcome">
      <div class="welcome__mark">${icon('check')}</div>
      <h1>Is this food safe for <em>you</em>?</h1>
      <ul class="welcome__points">
        <li><span>${icon('profile')}</span><div><strong>Tell us what to watch for</strong><small>Allergies, halal, vegan, diabetes, pregnancy, goals.</small></div></li>
        <li><span>${icon('scan')}</span><div><strong>Scan any barcode</strong><small>In the shop, in your kitchen, anywhere.</small></div></li>
        <li><span>${icon('shield')}</span><div><strong>Get your answer instantly</strong><small>SAFE or NOT SAFE, plus a health score made for you.</small></div></li>
      </ul>
      <button class="btn btn--primary btn--big" data-action="onboard-start">Set up my profile · 30 seconds</button>
      <button class="link welcome__skip" data-action="onboard-skip">Skip for now</button>
      <p class="hint">Free. No account. Your profile never leaves this phone. <a href="./privacy.html">Privacy &amp; terms</a></p>
    </div>`;
}

function histRow(e: HistoryEntry, index: number): string {
  const verdict = computeVerdict(e.product, profile);
  const score = computeScore(e.product, profile);
  const source = e.product.source === 'photo' ? ' · label photo' : e.product.source === 'demo' ? ' · demo' : '';
  return `<button class="hist" data-action="history-open" data-index="${index}">
    <span class="thumb">
      ${e.product.imageUrl
        ? `<img src="${esc(e.product.imageUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
        : `<b>${esc(e.product.name.charAt(0).toUpperCase())}</b>`}
      <span class="dot dot--${verdict.level}" title="${VERDICT_TITLE[verdict.level]}"></span>
    </span>
    <span class="hist__main">
      <span class="hist__name">${esc(e.product.name)}</span>
      <span class="hist__time">${VERDICT_SHORT[verdict.level]} · ${esc(timeAgo(e.time))}${source}</span>
    </span>
    <span class="hist__score ${score ? `band--${bandFor(score.value).key}` : ''}">${score ? score.value : '—'}</span>
  </button>`;
}

function timeAgo(t: number): string {
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`;
  return new Date(t).toLocaleDateString([], { dateStyle: 'medium' });
}

function installCard(): string {
  if (isStandalone() || loadFlags().installDismissed || loadStats().scans < 1) return '';
  if (!installEvent && !isIos()) return '';
  return `<section class="card install">
    <div>
      <strong>Keep Greenlit one tap away</strong>
      <p class="hint">${installEvent
        ? 'Add it to your home screen. Opens like an app, works offline.'
        : 'Tap the Share button, then “Add to Home Screen”. Opens like an app.'}</p>
    </div>
    <div class="row">
      ${installEvent ? '<button class="btn btn--small btn--primary" data-action="install">Add to home screen</button>' : ''}
      <button class="btn btn--small btn--ghost" data-action="install-dismiss">Not now</button>
    </div>
  </section>`;
}

/** A nudge, after the first scan, towards the free extras a Google key unlocks. */
function aiTipCard(): string {
  if (loadGeminiKey() || loadFlags().aiTipDismissed || loadStats().scans < 1) return '';
  return `<section class="card ai-tip">
    <div>
      <strong>Get more from Greenlit — still free</strong>
      <p class="hint">Add your own free Google key to scan labels that have no barcode and get plain-English explanations of ingredients.</p>
    </div>
    <div class="row">
      <button class="btn btn--small btn--primary" data-action="nav" data-view="key">Set it up · 1 minute</button>
      <button class="btn btn--small btn--ghost" data-action="ai-tip-dismiss">Not now</button>
    </div>
  </section>`;
}

function samplesHtml(): string {
  return `
    <p class="samples__label">Real products</p>
    <div class="tiles">
      ${SAMPLE_BARCODES.map((s, i) => `<button class="tile tile--${i % 5}" data-action="sample" data-barcode="${esc(s.barcode)}"><span class="tile__emoji" aria-hidden="true">${s.emoji}</span>${esc(s.label)}</button>`).join('')}
    </div>
    <p class="samples__label">Works offline <span class="tag">demo data</span></p>
    <div class="tiles">
      ${DEMO_PRODUCTS.map((d, i) => `<button class="tile tile--${(i + 2) % 5}" data-action="demo" data-index="${i}"><span class="tile__emoji" aria-hidden="true">${DEMO_EMOJI[i]}</span>${esc(d.name)}</button>`).join('')}
    </div>`;
}

function scanView(): string {
  const parts = profileParts(profile);
  const history = loadHistory();
  const stats = loadStats();

  const scanner = scanning
    ? `<div class="scanner">
        <video id="scan-video" playsinline muted autoplay></video>
        <div class="scanner__frame"></div>
        <p class="scanner__hint">Hold the barcode inside the box</p>
        <button class="btn btn--ghost scanner__close" data-action="scan-stop">Cancel</button>
      </div>`
    : `<button class="btn btn--primary btn--scan" data-action="scan-start" ${busy ? 'disabled' : ''}>
        <span class="hero__art" aria-hidden="true"><i></i><i></i><i></i><b></b></span>
        <span class="hero__title">Scan a<br />product</span>
        <small>Point the camera at a barcode</small>
        <span class="hero__cta">${icon('scan')}Tap to scan</span>
      </button>`;

  const profileLine = parts.length
    ? `<div class="pills"><span class="pills__label">Scanning for</span>${parts.map((p) => `<span class="pill">${esc(p)}</span>`).join('')}<button class="link pills__edit" data-action="nav" data-view="profile">Edit</button></div>`
    : `<p class="active-profile">No profile yet, so results aren’t personal. <button class="link" data-action="nav" data-view="profile">Set yours up</button></p>`;

  const statsCard = stats.scans
    ? `<section class="stats">
        <div class="stat"><span class="stat__num">${stats.scans}</span><span class="stat__label">product${stats.scans === 1 ? '' : 's'} checked</span></div>
        <div class="stat stat--caught"><span class="stat__num">${stats.caught}</span><span class="stat__label">problem${stats.caught === 1 ? '' : 's'} caught for you</span></div>
      </section>`
    : '';

  const recent = history.length
    ? `<section class="recent">
        <div class="section-head"><h2>Recent</h2><button class="link" data-action="nav" data-view="history">See all</button></div>
        <div class="hist-list">${history.slice(0, 3).map(histRow).join('')}</div>
      </section>`
    : '';

  const samples = history.length
    ? `<details class="samples"><summary>Try a sample product</summary>${samplesHtml()}</details>`
    : `<section class="samples samples--open"><h2>Nothing to scan right now? Try one</h2>${samplesHtml()}</section>`;

  return `
    <h1 class="title">Is it safe <em>for you?</em></h1>
    ${profileLine}
    ${scanner}
    ${noticeHtml()}
    <form class="manual" data-form="barcode" novalidate>
      <div class="row">
        <input id="barcode-input" name="barcode" inputmode="numeric" autocomplete="off" pattern="[0-9 ]*" aria-label="Type the barcode" placeholder="Or type the barcode digits" />
        <button class="btn" type="submit" ${busy ? 'disabled' : ''}>Look up</button>
      </div>
    </form>
    <button class="btn btn--secondary" data-action="photo" ${busy ? 'disabled' : ''}>${icon('camera')}No barcode? Photograph the label</button>
    <button class="link photo-alt" data-action="photo-library" ${busy ? 'disabled' : ''}>or choose a photo you already took</button>
    ${statsCard}
    ${recent}
    ${aiTipCard()}
    ${installCard()}
    ${samples}`;
}

/** Turns "−25 — high sugar…" into a row with a coloured points chip. */
function reasonRow(reason: string): string {
  const m = /^(Base \d+|[+−]\d+) — (.*)$/s.exec(reason);
  if (!m) return `<li>${esc(reason)}</li>`;
  const base = m[1].startsWith('Base');
  const kind = base ? 'base' : m[1].startsWith('+') ? 'up' : 'down';
  const text = base ? `Starting point — ${m[2]}` : m[2].charAt(0).toUpperCase() + m[2].slice(1);
  return `<li class="adj adj--${kind}"><span class="adj__pts">${esc(m[1].replace('Base ', ''))}</span><span>${esc(text)}</span></li>`;
}

/** Chunky progress bar under the score. Its width is set from script (see fillMeter). */
function scaleSvg(value: number): string {
  return `<div class="meter band--${bandFor(value).key}" aria-hidden="true"><div id="score-meter" class="meter__fill" data-value="${value}"></div></div>`;
}

/** Fills the score bar, and when a result has just opened, counts the number up with it. */
function fillMeter(animate: boolean) {
  const num = document.getElementById('score-num');
  const meter = document.getElementById('score-meter');
  if (!num || !meter) return;
  const target = Number(num.dataset.value);
  const width = `${Math.max(target, 3)}%`;
  if (!animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    meter.style.transition = 'none';
    meter.style.width = width;
    return;
  }
  const start = performance.now();
  const duration = 900;
  const frame = (now: number) => {
    if (!num.isConnected) return;
    const t = Math.min(1, (now - start) / duration);
    num.textContent = String(Math.round(target * (1 - Math.pow(1 - t, 3))));
    if (t < 1) requestAnimationFrame(frame);
  };
  num.textContent = '0';
  requestAnimationFrame((now) => {
    meter.style.width = width; // CSS transition animates the fill
    frame(now);
  });
}

/** The "why" behind the result: summary, what stands out, how processed it is, ingredients to know about. */
function whyHtml(why: Explanation, p: ProductData): string {
  const insights = why.insights.length
    ? `<ul class="insights">${why.insights.map((i) => `<li class="insight insight--${i.tone}"><span class="insight__dot" aria-hidden="true"></span><div><strong>${esc(i.title)}</strong>${i.detail ? `<small>${esc(i.detail)}</small>` : ''}</div></li>`).join('')}</ul>`
    : '';
  const proc = why.processing;
  const processing = proc
    ? `<section class="card">
        <h2>How processed is it?</h2>
        <div class="nova" role="img" aria-label="Processing level ${proc.group} of 4">${[1, 2, 3, 4].map((g) => `<span class="nova__step nova__step--${g} ${g === proc.group ? 'is-on' : ''}">${g}</span>`).join('')}</div>
        <div class="nova__title">${esc(proc.title)}${proc.estimated ? ' <span class="tag">estimate</span>' : ''}</div>
        <p>${esc(proc.text)}</p>
        ${proc.source ? `<p class="source">Source: ${esc(proc.source)}</p>` : ''}
      </section>`
    : '';
  const notable = why.ingredients.length
    ? `<section class="card">
        <h2>Ingredients to know about</h2>
        <ul class="notable">${why.ingredients.map((f) => `<li><strong>${esc(f.name)}</strong><p>${esc(f.note)}</p>${f.source ? `<p class="source">Source: ${esc(f.source)}</p>` : ''}</li>`).join('')}</ul>
        <p class="hint">These notes report what official bodies have decided. They are information, not a diagnosis or medical advice.</p>
      </section>`
    : '';
  const full = p.ingredientsText
    ? `<details class="fulling"><summary>Full ingredient list</summary><p>${esc(p.ingredientsText)}</p></details>`
    : '';
  const mine = ai?.product === p ? ai : null;
  const hasKey = !!loadGeminiKey();
  const aiBlock = !p.ingredientsText
    ? ''
    : mine?.status === 'busy'
      ? `<div class="notice notice--busy" role="status"><span class="spinner"></span>Asking Google’s AI about these ingredients…</div>`
      : mine?.status === 'done' && mine.data
        ? `<div class="ai">
            <span class="tag tag--photo">AI explanation</span>
            <p>${esc(mine.data.overview)}</p>
            ${mine.data.ingredients.length ? `<ul class="notable">${mine.data.ingredients.map((i) => `<li><strong>${esc(i.name)}</strong><p>${esc(i.what)}</p>${i.note ? `<p class="ai__note">${esc(i.note)}</p>` : ''}</li>`).join('')}</ul>` : ''}
            <p class="hint">Written by AI from the ingredient list, so it can be wrong. It is not medical advice, and your safety verdict above never uses AI.</p>
          </div>`
        : `<div class="ai-ask">
            ${mine?.status === 'error' ? `<div class="notice notice--error" role="alert">${esc(mine.error)}</div>` : ''}
            <button class="btn" data-action="ai-explain">${icon('question')}${mine?.status === 'error' ? 'Try again' : 'Explain these ingredients with AI'}</button>
            <p class="hint">${hasKey
              ? 'Uses your own Google key. Only this product’s ingredients are sent — never your profile.'
              : 'A free extra. Add your own free Google key (1 minute) to turn it on.'}</p>
          </div>`;
  return `
    <section class="card why">
      <h2>Why</h2>
      <p class="why__headline">${esc(why.headline)}</p>
      <p class="why__summary">${esc(why.summary)}</p>
      ${insights}
      ${aiBlock}
      ${full}
    </section>
    ${processing}
    ${notable}`;
}

function numberCell(label: string, value: number | undefined, unit = 'g'): string {
  return `<div class="num"><span class="num__value">${value === undefined ? '—' : `${esc(fmt(value))}${unit}`}</span><span class="num__label">${label}</span></div>`;
}

function resultView(): string {
  const p = current;
  if (!p) return `<p class="empty">No result open.</p><button class="btn btn--primary" data-action="nav" data-view="scan">Scan a product</button>`;

  const verdict = computeVerdict(p, profile);
  const score = computeScore(p, profile);
  const summary = profileSummary(profile);
  const n = p.nutriments ?? {};

  const scoreHtml = score
    ? `<div class="score__top band--${bandFor(score.value).key}">
        <div class="score__figure"><span id="score-num" data-value="${score.value}">${score.value}</span><small>/100</small></div>
        <div class="score__meta">
          <div class="score__band">${esc(score.band)}</div>
          <div class="score__generic">${p.nutriscoreGrade
            ? `Generic score: ${esc(p.nutriscoreGrade.toUpperCase())} — yours is personal`
            : 'No generic Nutri-Score for this product'}</div>
        </div>
      </div>
      ${scaleSvg(score.value)}
      <ul class="reasons">${score.reasons.map(reasonRow).join('')}</ul>`
    : `<p class="score__none">Not enough data to score this for you.</p>`;

  const sourceBadge =
    p.source === 'photo' ? '<span class="tag tag--photo">From your label photo</span>'
    : p.source === 'demo' ? '<span class="tag">Demo data</span>'
    : '';

  return `
    <section class="verdict verdict--${verdict.level}" aria-live="polite">
      <span class="verdict__art" aria-hidden="true"><i></i><i></i></span>
      ${p.imageUrl ? `<img class="verdict__img" src="${esc(p.imageUrl)}" alt="" referrerpolicy="no-referrer" />` : ''}
      <div class="verdict__icon">${icon(VERDICT_ICON[verdict.level])}</div>
      <h1 class="verdict__title">${VERDICT_TITLE[verdict.level]}</h1>
      <ul class="verdict__reasons">${verdict.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
      ${verdict.warnings.map((w) => `<p class="verdict__warning">${icon('warning')}<span>${esc(w)}</span></p>`).join('')}
    </section>
    <p class="active-profile">${summary ? `Checked for: <strong>${esc(summary)}</strong>` : 'No profile set — this is a generic check. <button class="link" data-action="nav" data-view="profile">Set up your profile</button>'}</p>

    <section class="card">
      <h2>Your personal score</h2>
      ${scoreHtml}
    </section>

    ${whyHtml(explain(p, profile, verdict, score), p)}

    <section class="card product">
      <div>
        <div class="product__name">${esc(p.name)}</div>
        ${p.brand ? `<div class="product__brand">${esc(p.brand)}</div>` : ''}
        ${p.barcode ? `<div class="product__code">Barcode ${esc(p.barcode)}</div>` : ''}
        ${sourceBadge}
      </div>
    </section>

    <section class="card">
      <h2>Per 100g</h2>
      <div class="nums">
        ${numberCell('Sugar', n.sugars)}${numberCell('Salt', n.salt)}${numberCell('Fat', n.fat)}${numberCell('Protein', n.protein)}
        ${numberCell('Sat. fat', n.saturatedFat)}${numberCell('Carbs', n.carbs)}${numberCell('Fibre', n.fiber)}${numberCell('Energy', n.kcal, ' kcal')}
      </div>
    </section>

    <footer class="legal">
      <p>${ATTRIBUTION}</p>
      ${p.source === 'photo' ? '<p>This result was read from your photo by Google Gemini and may contain reading mistakes.</p>' : ''}
      ${p.source === 'demo' ? '<p>This is made-up demo data, not a real product.</p>' : ''}
      <p>${DISCLAIMER}</p>
    </footer>

    <div class="actionbar"><button class="btn btn--primary btn--big" data-action="scan-next">Scan next product</button></div>`;
}

function check(name: string, value: string, label: string, hint: string | undefined, checked: boolean, type = 'checkbox'): string {
  return `<label class="opt">
    <input type="${type}" name="${name}" value="${esc(value)}" ${checked ? 'checked' : ''} />
    <span class="opt__text"><span>${esc(label)}</span>${hint ? `<small>${esc(hint)}</small>` : ''}</span>
  </label>`;
}

function profileView(): string {
  return `
    <h1 class="title">${onboarding ? 'What should we watch for?' : 'Your profile'}</h1>
    <p class="sub">${onboarding ? 'Tick anything that applies. You can change it any time.' : 'Set once. Stored only on this device.'}</p>
    <form data-form="profile">
      <fieldset><legend>Allergies</legend>
        <div class="opts opts--grid">${ALLERGY_OPTS.map(([v, l]) => check('allergies', v, l, undefined, profile.allergies.includes(v))).join('')}</div>
      </fieldset>
      <fieldset><legend>Diet &amp; intolerances</legend>
        <div class="opts">${RULE_OPTS.map(([v, l, h]) => check('rules', v, l, h, profile.rules.includes(v))).join('')}</div>
      </fieldset>
      <fieldset><legend>Health watch</legend>
        <div class="opts">${WATCH_OPTS.map(([v, l, h]) => check('watch', v, l, h, profile.watch.includes(v))).join('')}</div>
      </fieldset>
      <fieldset><legend>Prefer to avoid</legend>
        <div class="opts opts--grid">${AVOID_OPTS.map(([v, l]) => check('watch', v, l, undefined, profile.watch.includes(v))).join('')}</div>
      </fieldset>
      <fieldset><legend>Goal</legend>
        <div class="opts opts--grid">${GOAL_OPTS.map(([v, l]) => check('goal', v, l, undefined, profile.goal === v, 'radio')).join('')}</div>
      </fieldset>
      ${noticeHtml()}
      <div class="actionbar ${onboarding ? 'actionbar--bottom' : ''}"><button class="btn btn--primary btn--big" type="submit">${onboarding ? 'Save and start scanning' : 'Save profile'}</button></div>
    </form>`;
}

function historyView(): string {
  const entries = loadHistory();
  if (!entries.length) {
    return `<h1 class="title">History</h1>
      <p class="empty">No scans yet. Your last 20 scans will appear here.</p>
      <button class="btn btn--primary" data-action="nav" data-view="scan">Scan a product</button>`;
  }
  const levels = entries.map((e) => computeVerdict(e.product, profile).level);
  const count = (f: HistoryFilter) => (f === 'all' ? entries.length : levels.filter((l) => l === f).length);
  const filters: [HistoryFilter, string][] = [['all', 'All'], ['safe', 'Safe'], ['not-safe', 'Not safe'], ['unknown', "Can't confirm"]];
  const rows = entries
    .map((e, i) => (historyFilter === 'all' || levels[i] === historyFilter ? histRow(e, i) : ''))
    .join('');
  return `<h1 class="title">History</h1>
    <p class="sub">Your last ${entries.length} scan${entries.length > 1 ? 's' : ''}, re-checked against your current profile.</p>
    <div class="chips">${filters.map(([f, l]) => `<button class="chip ${historyFilter === f ? 'is-on' : ''}" data-action="history-filter" data-filter="${f}">${l} ${count(f)}</button>`).join('')}</div>
    <div class="hist-list">${rows || '<p class="empty">Nothing here yet.</p>'}</div>`;
}

function settingsView(): string {
  const hasKey = !!loadGeminiKey();
  const install = isStandalone()
    ? ''
    : `<section class="card">
        <h2>Home screen</h2>
        <p class="hint">${installEvent
          ? 'Add Greenlit to your home screen. It opens like an app and works offline.'
          : isIos()
            ? 'In Safari, tap the Share button, then “Add to Home Screen”. It opens like an app.'
            : 'Use your browser menu → “Add to Home screen” / “Install app” to open Greenlit like an app.'}</p>
        ${installEvent ? '<button class="btn" data-action="install">Add to home screen</button>' : ''}
      </section>`;
  return `
    <h1 class="title">Settings</h1>
    <section class="card">
      <h2>AI extras</h2>
      <p>${hasKey
        ? 'On. Your Gemini key is saved on this device.'
        : 'Off. Label photos and AI ingredient explanations need your own free Google key — about a minute to set up, no card.'}</p>
      <div class="row">
        <button class="btn btn--primary" data-action="nav" data-view="key">${hasKey ? 'Change key' : 'Set up AI extras'}</button>
        ${hasKey ? '<button class="btn btn--ghost" type="button" data-action="key-remove">Remove key</button>' : ''}
      </div>
      <p class="hint">The key is stored only in this browser and is sent only to Google’s API when you photograph a label or ask for an AI explanation. Barcode scanning never needs it.</p>
    </section>
    ${noticeHtml()}
    ${install}
    <section class="card">
      <h2>About</h2>
      <p>${ATTRIBUTION}</p>
      <p>${DISCLAIMER}</p>
      <p class="hint">No account, no tracking. Your profile, history and key never leave this browser.</p>
      <p><a href="./privacy.html">Privacy &amp; terms</a></p>
    </section>
    <section class="card">
      <h2>Your data</h2>
      <p class="hint">Removes your profile, scan history, counters and Gemini key from this device.</p>
      <button class="btn btn--danger" data-action="delete-all">${deleteArmed ? 'Tap again to delete everything' : 'Delete all my data'}</button>
    </section>`;
}

function keyView(): string {
  const hasKey = !!loadGeminiKey();
  return `
    <h1 class="title">Turn on <em>AI extras</em></h1>
    <p class="sub">Two free extras run on Google’s AI with your own key: photographing a label when there is no barcode, and plain-English explanations of ingredients. About a minute, no card. Everything else in Greenlit works without it.</p>
    ${hasKey ? `<div class="notice notice--ok"><strong>AI extras are on.</strong><div class="row"><button class="btn btn--small btn--primary" data-action="photo">Photograph a label</button><button class="btn btn--small" data-action="photo-library">Choose a photo</button><button class="btn btn--small btn--ghost" data-action="key-remove">Remove key</button></div></div>` : ''}
    <ol class="steps">
      <li>
        <span class="steps__n">1</span>
        <div>
          <strong>Open Google AI Studio</strong>
          <small>Sign in with any Google account. It opens in a new tab — come back here after.</small>
          <a class="btn btn--small btn--primary" href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">Open Google AI Studio</a>
        </div>
      </li>
      <li>
        <span class="steps__n">2</span>
        <div>
          <strong>Accept Google’s terms</strong>
          <small>Google then makes a key for you. If you don’t see one, tap “Create API key”.</small>
        </div>
      </li>
      <li>
        <span class="steps__n">3</span>
        <div>
          <strong>Copy the key</strong>
          <small>It’s one long line of letters and numbers. Copy all of it.</small>
        </div>
      </li>
      <li>
        <span class="steps__n">4</span>
        <div>
          <strong>Paste it here</strong>
          <form data-form="key">
            <div class="row">
              <input id="key-input" name="key" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Your Gemini API key" placeholder="${hasKey ? 'Paste a new key to replace it' : 'Your key'}" value="${esc(keyDraft)}" />
              <button class="btn btn--small" type="button" data-action="key-paste">Paste</button>
            </div>
            <button class="btn btn--primary btn--big" type="submit" ${busy ? 'disabled' : ''}>Save and test key</button>
          </form>
        </div>
      </li>
    </ol>
    ${noticeHtml()}
    <p class="hint">Private: the key stays on this phone and is sent only to Google, only when you photograph a label or ask for an AI explanation. Your profile is never sent. Treat the key like a password. Google’s free allowance has daily limits — plenty for personal use.</p>`;
}

async function saveAndTestKey(raw: string) {
  const key = raw.trim();
  keyDraft = key;
  if (!key) {
    notice = { kind: 'info', text: 'Paste your key first.' };
    render();
    return;
  }
  notice = null;
  busy = 'Checking your key with Google…';
  render();
  try {
    await testKey(key);
    saveGeminiKey(key);
    keyDraft = '';
    notice = { kind: 'saved', text: 'Your key works. AI extras are on.' };
  } catch (e) {
    const err = e instanceof PhotoError ? e : new PhotoError('Something went wrong checking the key. Please try again.');
    if (err.kind === 'key' || err.kind === 'model') {
      notice = { kind: 'error', text: err.message }; // not saved: it would only fail later
    } else {
      saveGeminiKey(key);
      keyDraft = '';
      notice = { kind: 'warn', text: `Key saved, but it couldn’t be checked just now. ${err.message}` };
    }
  }
  busy = null;
  render();
}

const NAV: [View, string, keyof typeof ICONS][] = [
  ['scan', 'Scan', 'scan'], ['history', 'History', 'history'], ['profile', 'Profile', 'profile'], ['settings', 'Settings', 'settings'],
];

function render() {
  const body =
    view === 'welcome' ? welcomeView()
    : view === 'scan' ? scanView()
    : view === 'result' ? resultView()
    : view === 'profile' ? profileView()
    : view === 'history' ? historyView()
    : view === 'key' ? keyView()
    : settingsView();
  const activeTab = view === 'result' ? 'scan' : view === 'key' ? 'settings' : view;
  const chrome = !onboarding;
  app.innerHTML = `
    ${view === 'welcome' ? '' : `<header class="top"><span class="logo-mark">${icon('check')}</span><span class="logo">Greenlit</span></header>`}
    <main class="view view--${view} ${chrome ? '' : 'view--bare'}">${body}</main>
    ${chrome
      ? `<nav class="nav" aria-label="Main">
          ${NAV.map(([v, l, ic]) => `<button class="nav__item ${activeTab === v ? 'is-active' : ''}" data-action="nav" data-view="${v}">${icon(ic)}${l}</button>`).join('')}
        </nav>`
      : ''}`;
  if (view === 'result') fillMeter(animateScore);
  animateScore = false;
}

// ---------- events ----------

app.addEventListener('click', (ev) => {
  const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  if (action !== 'delete-all' && deleteArmed) deleteArmed = false;

  switch (action) {
    case 'nav':
      go(el.dataset.view as View);
      break;
    case 'onboard-start':
      go('profile');
      break;
    case 'onboard-skip':
      finishOnboarding();
      go('scan');
      break;
    case 'scan-start':
      void beginScan();
      break;
    case 'scan-next':
      go('scan');
      void beginScan();
      break;
    case 'scan-stop':
      stopScanner();
      render();
      break;
    case 'sample':
      void lookup(el.dataset.barcode ?? '');
      break;
    case 'demo':
      openResult(DEMO_PRODUCTS[Number(el.dataset.index)], true);
      break;
    case 'photo':
      requestPhoto('camera');
      break;
    case 'ai-explain':
      void askAi();
      break;
    case 'ai-tip-dismiss':
      setFlag('aiTipDismissed');
      render();
      break;
    case 'photo-library':
      requestPhoto('library');
      break;
    case 'history-open': {
      const entry = loadHistory()[Number(el.dataset.index)];
      if (entry) openResult(entry.product, false);
      break;
    }
    case 'history-filter':
      historyFilter = el.dataset.filter as HistoryFilter;
      render();
      break;
    case 'install':
      void installEvent?.prompt().finally(() => {
        installEvent = null;
        render();
      });
      break;
    case 'install-dismiss':
      setFlag('installDismissed');
      render();
      break;
    case 'key-paste':
      navigator.clipboard
        ?.readText()
        .then((text) => {
          const input = document.getElementById('key-input') as HTMLInputElement | null;
          if (input) input.value = text.trim();
        })
        .catch(() => {
          notice = { kind: 'info', text: 'Couldn’t read the clipboard. Press and hold the box, then choose Paste.' };
          render();
        });
      break;
    case 'key-remove':
      saveGeminiKey('');
      notice = { kind: 'saved', text: 'Gemini key removed from this device.' };
      render();
      break;
    case 'delete-all':
      if (!deleteArmed) {
        deleteArmed = true;
        notice = null;
      } else {
        deleteAllData();
        profile = loadProfile();
        current = null;
        deleteArmed = false;
        setFlag('onboarded'); // don't replay the welcome screen right after a wipe
        notice = { kind: 'saved', text: 'All your data was deleted from this device.' };
      }
      render();
      break;
  }
});

app.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const form = ev.target as HTMLFormElement;
  switch (form.dataset.form) {
    case 'barcode':
      void lookup(String(new FormData(form).get('barcode') ?? ''));
      break;
    case 'profile':
      saveProfileFromForm(form);
      break;
    case 'key':
      void saveAndTestKey(String(new FormData(form).get('key') ?? ''));
      break;
  }
});

// Offer "add to home screen" where the browser supports it (Android / desktop Chrome).
window.addEventListener('beforeinstallprompt', (ev) => {
  ev.preventDefault();
  installEvent = ev as InstallEvent;
  const typing = (document.getElementById('barcode-input') as HTMLInputElement | null)?.value;
  if ((view === 'scan' || view === 'settings') && !scanning && !busy && !typing) render();
});

// Camera must not keep running when the app goes to the background.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && scanning) {
    stopScanner();
    render();
  }
});

window.addEventListener('popstate', (ev) => {
  const target = (ev.state as { view?: View } | null)?.view ?? 'scan';
  const allowed = (target !== 'welcome' || onboarding) && (target !== 'result' || current !== null);
  go(allowed ? target : 'scan', false, true);
});
history.replaceState({ view }, '');

// Android's Back button in the store build: close the camera, else step back a screen, else leave the app.
if (isNativeApp()) {
  void NativeApp.addListener('backButton', () => {
    if (scanning) {
      stopScanner();
      render();
    } else if (view === 'scan' || view === 'welcome') {
      void NativeApp.exitApp();
    } else if (history.state?.view && history.length > 1) {
      history.back();
    } else {
      go('scan', false, true);
    }
  });
}

// The store build ships its files inside the app, so it needs no offline worker.
if (import.meta.env.PROD && 'serviceWorker' in navigator && !isNativeApp()) {
  void navigator.serviceWorker.register('./sw.js').catch(() => undefined);
}

render();

// Local development only: http://localhost:<port>/#selftest runs a real label-photo check with the saved key.
if (import.meta.env.DEV && location.hash === '#selftest') void import('./selftest').then((m) => m.runSelfTest());

// Get the camera decoder ready in the background once the first screen is up.
setTimeout(prewarmScanner, 1500);
