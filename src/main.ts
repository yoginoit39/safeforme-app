import '@fontsource-variable/fraunces/wght.css';
import './style.css';
import { App as NativeApp } from '@capacitor/app';
import { Haptics, NotificationType } from '@capacitor/haptics';
import type { HistoryEntry, Member, ProductData, ProductKind, Profile, StackItem, Verdict } from './types';
import { LIMITS_SOURCE, computeSupplementVerdict, dailyTotals, doseText, limitKey, supplementNotes, type AgeBand } from './engine/supplements';
import { childConcerns, isUnder4, withChildChecks } from './engine/children';
import { recallFor, type Recall } from './data/recalls';
import { countryTag, findAlternatives } from './data/alternatives';
import { allergyNeeds, computeVerdict } from './engine/verdict';
import { beautyFlags, computeBeautyVerdict } from './engine/beauty';
import { computePetVerdict, petFoodSpecies, type Species } from './engine/pets';
import { bandFor, computeScore, fmt } from './engine/score';
import { explain, type Explanation } from './engine/explain';
import { DEMO_EMOJI, DEMO_PRODUCTS, SAMPLE_BARCODES } from './data/demo';
import { LookupError, lookupBarcode, lookupIn, setLookupLang } from './data/off';
import { cutoutFor, type Cutout } from './cutout';
import { parseIngredients } from './ingredients';
import { langName } from './lang';
import { searchByName, type SearchHit } from './data/search';
import { PhotoError, explainIngredients, readLabelPhoto, testKey, type AiExplanation } from './data/gemini';
import { prewarmScanner, scannerSupported, startScan, type ScanSession } from './scanner';
import {
  FAMILY_LIMIT, addHistory, deleteAllData, loadFamily, loadFlags, loadGeminiKey, loadHistory, loadLang, loadProfile, loadStack, loadStats,
  recordScan, saveFamily, saveGeminiKey, saveProfile, saveStack, setFlag,
} from './storage';

// ---------- constants ----------

const DISCLAIMER =
  'Not medical advice. Product data comes from Open Food Facts and can be incomplete or wrong. Always check the physical label.';

const ATTRIBUTION =
  'Product data: <a href="https://world.openfoodfacts.org" target="_blank" rel="noopener noreferrer">Open Food Facts</a> (ODbL)';

/** The databases are edited by volunteers. A wrong entry is fixed at the source, for everyone. */
function fixLink(p: ProductData): string {
  const host = { openfoodfacts: 'world.openfoodfacts.org', openbeautyfacts: 'world.openbeautyfacts.org', openpetfoodfacts: 'world.openpetfoodfacts.org' }[p.source as string];
  if (!host || !p.barcode || !/^\d{6,14}$/.test(p.barcode)) return '';
  return `<p>Doesn’t match the pack? ${link(`https://${host}/product/${p.barcode}`, 'Correct it at the source')} — recipes change and volunteers make mistakes. Until then, trust the printed label.</p>`;
}

const link = (href: string, text: string) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;
/** Every result names where its data came from. */
const SOURCE_CREDIT: Partial<Record<ProductData['source'], string>> = {
  openbeautyfacts: `Product data: ${link('https://world.openbeautyfacts.org', 'Open Beauty Facts')} (ODbL)`,
  openpetfoodfacts: `Product data: ${link('https://world.openpetfoodfacts.org', 'Open Pet Food Facts')} (ODbL)`,
  usda: `Product data: ${link('https://fdc.nal.usda.gov', 'USDA FoodData Central')} (US government, public domain)`,
  dsld: `Label data: ${link('https://dsld.od.nih.gov', 'NIH Dietary Supplement Label Database')} (US government, public domain)`,
};
const KIND_DISCLAIMER: Record<ProductKind, string> = {
  food: DISCLAIMER,
  beauty: 'Not medical advice. Ingredient data can be incomplete or wrong, and formulas change. Always check the physical label, and patch-test a new product first.',
  petfood: 'Not veterinary advice. Product data can be incomplete or wrong. Always check the physical label, and ask your vet about your pet’s diet.',
  supplement: 'Not medical advice. Supplements are not tested by regulators before they are sold, and Greenlit cannot tell whether one works or what a lab would find in it. Label data can be incomplete or wrong. Ask a doctor or pharmacist, especially if you take medicines, are pregnant, or are giving it to a child.',
};
const KIND_LABEL: Record<ProductKind, string> = { food: 'Food', beauty: 'Cosmetics', petfood: 'Pet food', supplement: 'Supplement' };
const AGE_OPTS: [string, string][] = [['adult', 'Adult'], ['9-18', 'Age 9–18'], ['4-8', 'Age 4–8'], ['2-3', 'Age 2–3'], ['1', 'Age 1'], ['under1', 'Under 1']];

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
/** Cosmetics preferences. Stored on the profile as `skin`. */
const SKIN_OPTS: [string, string, string][] = [
  ['fragrance', 'Fragrance allergy', 'Flags perfume and the scent allergens the EU requires on labels.'],
  ['sensitive', 'Sensitive skin', 'Warns on fragrance, sulfates and drying alcohol.'],
];
const SKIN_AVOID_OPTS: [string, string][] = [
  ['no-parabens', 'Parabens'], ['no-sulfates', 'Sulfates'], ['no-alcohol', 'Alcohol'], ['no-silicones', 'Silicones'],
];
const GOAL_OPTS: [Profile['goal'], string][] = [
  ['none', 'No goal'], ['lose-weight', 'Lose weight'], ['build-muscle', 'Build muscle'], ['eat-cleaner', 'Eat cleaner'],
];

const VERDICT_TITLE = { safe: 'Safe for you', caution: 'Not ideal for you', 'not-safe': 'Not safe', unknown: 'Check the label' } as const;
const VERDICT_SHORT = { safe: 'Safe', caution: 'Not ideal', 'not-safe': 'Not safe', unknown: 'Check label' } as const;
const ICONS = {
  scan: '<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M7.5 12h9"/>',
  history: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  profile: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 19.5c1.2-3.2 3.8-4.8 7-4.8s5.8 1.6 7 4.8"/>',
  settings: '<path d="M5 7h8M19 7h0M5 17h0M11 17h8"/><circle cx="16" cy="7" r="2.2"/><circle cx="8" cy="17" r="2.2"/>',
  camera: '<path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.2-2h6.6l1.2 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z"/><circle cx="12" cy="13" r="3.2"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  cross: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  question: '<path d="M9 9.2a3 3 0 1 1 4.6 2.5c-.9.6-1.6 1.2-1.6 2.4M12 17.7h0"/>',
  alert: '<path d="M12 6.5v7M12 17.5h0"/>',
  warning: '<path d="M12 4.5l8.5 14.5h-17zM12 10.5v3.5M12 16.6h0"/>',
  shield: '<path d="M12 3.5l7 2.6v5.4c0 4.2-2.8 7.3-7 9-4.2-1.7-7-4.8-7-9V6.1z"/><path d="M9 12l2.2 2.2L15.2 10"/>',
} as const;

const icon = (name: keyof typeof ICONS) =>
  `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

const VERDICT_ICON = { safe: 'check', caution: 'alert', 'not-safe': 'cross', unknown: 'question' } as const;
const ALLERGY_SINGULAR: Record<string, string> = { peanuts: 'peanut', 'tree-nuts': 'tree nut', gluten: 'wheat/gluten' };

// ---------- state ----------

type View = 'welcome' | 'scan' | 'result' | 'profile' | 'history' | 'settings' | 'key';
type Notice = { kind: 'error' | 'info' | 'warn' | 'not-found' | 'saved'; text: string };
type HistoryFilter = 'all' | Verdict['level'];
type InstallEvent = Event & { prompt(): Promise<unknown> };

let profile: Profile = loadProfile();
/** Other people and pets the user shops for. */
let family: Member[] = loadFamily();
/** Whose profile the Profile screen is showing: 'me' or a family member's id. */
let editing = 'me';
/** Results of the last search by name, shown under the search box. */
let search: { query: string; hits: SearchHit[] } | null = null;
/** Barcode a label photo is being taken for, so the result is remembered under it. */
let photoFor: string | null = null;
/** Supplements taken daily, for adding doses up across bottles. */
let stack: StackItem[] = loadStack();
/** Healthier options found for the open product. */
type Alt = { product: ProductData; score: number };
let alts: { for: string; status: 'loading' | 'done' | 'error'; items: Alt[]; local: boolean } | null = null;
/** FDA recall lookups already done, by barcode. */
const recallDone = new Map<string, Recall | null>();
/** Language for product names and ingredient lists. */
let lang = loadLang();
setLookupLang(lang);
let view: View = loadFlags().onboarded || profileSummary(profile) || loadHistory().length ? 'scan' : 'welcome';
let onboarding = view === 'welcome';
let current: ProductData | null = null;
let notice: Notice | null = null;
let busy: string | null = null;
let scanning = false;
let scanSession: ScanSession | null = null;
/** Counts scans, so a late answer from an old camera session is ignored. */
let scanRun = 0;
let scanProblem: 'slow' | 'stalled' | null = null;
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

const kindOf = (p: ProductData): ProductKind => p.kind ?? 'food';
const pets = () => family.filter((m) => m.kind !== 'person');
const people = () => family.filter((m) => m.kind === 'person');
const WORST = { safe: 0, caution: 1, unknown: 2, 'not-safe': 3 } as const;

/** The check for one person, for whatever kind of product this is. */
function verdictForPerson(p: ProductData, who: Profile, age: AgeBand = 'adult'): Verdict {
  const kind = kindOf(p);
  if (kind === 'supplement') return computeSupplementVerdict(p, who, age);
  if (kind === 'beauty') return computeBeautyVerdict(p, who);
  // A child is not a small adult: caffeine, added sugar, honey and the rest are checked by age.
  return withChildChecks(computeVerdict(p, who), p, age);
}

/** Pet food is judged for the user's pets (or for dogs and cats in general when none are set up). */
function petFoodVerdict(p: ProductData): Verdict {
  const madeFor = petFoodSpecies(p);
  const mine = pets();
  const matching = madeFor ? mine.filter((m) => m.kind === madeFor) : mine;
  const targets: { label: string; species: Species }[] = (matching.length ? matching : mine).map((m) => ({ label: m.name, species: m.kind as Species }));
  if (!targets.length) {
    if (madeFor) targets.push({ label: '', species: madeFor });
    else targets.push({ label: 'Dogs', species: 'dog' }, { label: 'Cats', species: 'cat' });
  }
  const results = targets.map((t) => ({ t, v: computePetVerdict(p, t.species) }));
  const level = results.reduce<Verdict['level']>((worst, r) => (WORST[r.v.level] > WORST[worst] ? r.v.level : worst), 'safe');
  const named = targets.length > 1;
  const reasons = results
    .filter((r) => r.v.level === level)
    .flatMap((r) => r.v.reasons.map((x) => (named && r.t.label ? `${r.t.label}: ${x}` : x)));
  return { level, reasons: [...new Set(reasons)], warnings: [] };
}

/** The headline verdict for a product: the user's own, or their pets' for pet food. */
function mainVerdict(p: ProductData): Verdict {
  return kindOf(p) === 'petfood' ? petFoodVerdict(p) : verdictForPerson(p, profile);
}

function verdictTitle(level: Verdict['level'], kind: ProductKind, allergy = false): string {
  // With an allergy in the profile the app reports what it checked. It does not promise "safe".
  if (level === 'safe' && allergy && (kind === 'food' || kind === 'supplement')) return 'No allergens found';
  if (level === 'safe' && kind === 'beauty') return 'No red flags';
  if (level === 'safe' && kind === 'petfood') return 'Safe for your pet';
  if (level === 'safe' && kind === 'supplement') return 'No concerns found';
  return VERDICT_TITLE[level];
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
  scanRun++;
  scanSession?.stop();
  scanSession = null;
  scanning = false;
  scanProblem = null;
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
    const level = mainVerdict(product).level;
    addHistory(product);
    recordScan(level === 'not-safe');
    // A physical cue for the verdict: native haptics in the store apps, vibration in browsers that have it.
    if (isNativeApp()) {
      const type = level === 'not-safe' ? NotificationType.Error : level === 'unknown' ? NotificationType.Warning : NotificationType.Success;
      void Haptics.notification({ type }).catch(() => undefined);
    } else {
      navigator.vibrate?.(level === 'not-safe' ? [90, 60, 90] : 30);
    }
  }
  animateScore = true;
  go('result');
}

/** A barcode goes straight to lookup; anything else is treated as a product name. */
function submitQuery(raw: string) {
  const text = raw.trim();
  if (/^[\d\s-]*$/.test(text)) void lookup(text);
  else void runSearch(text);
}

async function runSearch(query: string) {
  if (query.length < 2) return;
  stopScanner();
  notice = null;
  search = null;
  busy = `Searching for “${query}”…`;
  render();
  try {
    const hits = await searchByName(query, lang);
    busy = null;
    search = { query, hits };
    if (!hits.length) notice = { kind: 'not-found', text: `Nothing found for “${query}”.` };
  } catch {
    busy = null;
    notice = { kind: 'error', text: 'Search isn’t reachable right now. Check your connection, or scan the barcode instead.' };
  }
  render();
}

/** `kind` is set when the product was picked from a name search, so only that database is asked. */
async function lookup(raw: string, kind?: ProductKind) {
  const barcode = raw.replace(/\D/g, '');
  if (barcode.length < 6 || barcode.length > 14) {
    notice = { kind: 'error', text: 'That doesn’t look like a barcode. Type the 8–13 digits printed under the bars, or type a product name.' };
    render();
    return;
  }
  stopScanner();
  // Scanned in the last day? Reuse it: instant, works offline, and spares the free product database.
  // A label the user photographed for this barcode is kept for as long as it stays in history.
  const recent = loadHistory().find(
    (e) =>
      e.product.barcode === barcode &&
      e.product.source !== 'demo' &&
      (e.product.source === 'photo' || (e.product.userLang ?? 'en') === lang) &&
      (e.product.source === 'photo' || Date.now() - e.time < 24 * 60 * 60 * 1000),
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
    const result = await (kind ? lookupIn(barcode, kind) : lookupBarcode(barcode));
    busy = null;
    if (result.status === 'found') {
      openResult(result.product, true);
    } else {
      notice = { kind: 'not-found', text: `Product not in the database (barcode ${barcode}).` };
      photoFor = barcode;
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
  scanProblem = null;
  render();
  const video = document.getElementById('scan-video') as HTMLVideoElement | null;
  if (!video) return;
  // A camera left open by an earlier scan would block this one on some phones.
  scanSession?.stop();
  scanSession = null;
  const run = ++scanRun;
  try {
    const session = await startScan(
      video,
      (code) => {
        scanSession = null;
        scanning = false;
        void lookup(code);
      },
      (problem) => {
        if (run !== scanRun) return;
        scanProblem = problem;
        syncScanner();
      },
    );
    if (!scanning || run !== scanRun) {
      session.stop(); // user left the scanner while the camera was opening
      return;
    }
    scanSession = session;
    syncScanner(); // the screen may have been redrawn while the camera was opening
  } catch {
    if (run !== scanRun) return;
    stopScanner();
    notice = {
      kind: 'info',
      text: 'The camera didn’t open. Check that Greenlit is allowed to use the camera and no other app is using it, then tap Scan again — or type the barcode digits below.',
    };
    render();
  }
}

/**
 * Called after every redraw. A redraw replaces the video box, so the live picture is moved into
 * the new one and the help and light buttons are brought back to match the scan in progress.
 */
function syncScanner(): void {
  if (!scanning) return;
  const video = document.getElementById('scan-video') as HTMLVideoElement | null;
  if (video && scanSession) scanSession.attach(video);
  const help = document.getElementById('scan-help');
  const text = document.getElementById('scan-help-text');
  const retry = document.getElementById('scan-retry');
  if (help && text && retry) {
    help.hidden = !scanProblem;
    retry.hidden = scanProblem !== 'stalled';
    text.textContent =
      scanProblem === 'stalled' ? 'The camera stopped responding.'
      : scanProblem === 'slow' ? 'Not reading it? Move a little closer, tilt away from glare, or turn on the light.'
      : '';
  }
  const torch = document.getElementById('scan-torch');
  if (torch) torch.hidden = !scanSession?.hasTorch;
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

function requestPhoto(from: 'camera' | 'library' = 'camera', forBarcode: string | null = null) {
  photoFor = forBarcode;
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
    if (photoFor) {
      // Remember this label under the barcode, so the next scan of it answers instantly.
      product.barcode = photoFor;
      if (current?.barcode === photoFor) {
        if (product.name === 'Label photo') product.name = current.name;
        product.brand ??= current.brand;
        product.imageUrl ??= current.imageUrl;
      }
      photoFor = null;
    }
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
  const next: Profile = {
    allergies: data.getAll('allergies').map(String),
    rules: data.getAll('rules').map(String),
    watch: data.getAll('watch').map(String),
    goal: String(data.get('goal') ?? 'none') as Profile['goal'],
    skin: data.getAll('skin').map(String),
    avoidCustom: [...new Set(String(data.get('avoidCustom') ?? '').toLowerCase().split(/[,;\n]/).map((t) => t.trim()).filter((t) => t.length >= 2 && t.length <= 40))].slice(0, 20),
  };
  const member = family.find((m) => m.id === editing);
  if (member) {
    member.name = String(data.get('name') ?? '').trim().slice(0, 24) || member.name;
    if (member.kind === 'person') {
      member.profile = next;
      const age = String(data.get('age') ?? 'adult');
      member.age = age === 'under1' || age === '1' || age === '2-3' || age === '4-8' || age === '9-18' ? age : undefined;
    }
    else member.kind = data.get('species') === 'cat' ? 'cat' : 'dog';
    saveFamily(family);
    notice = { kind: 'saved', text: `${member.name} saved on this device.` };
    render();
    return;
  }
  profile = next;
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

function addMember(kind: Member['kind']) {
  if (family.length >= FAMILY_LIMIT) return;
  const count = family.filter((m) => (m.kind === 'person') === (kind === 'person')).length + 1;
  const member: Member = {
    id: `m${Date.now().toString(36)}`,
    name: kind === 'person' ? `Person ${count}` : count > 1 ? `Pet ${count}` : 'My pet',
    kind,
    profile: { allergies: [], rules: [], watch: [], goal: 'none', skin: [] },
  };
  family = [...family, member];
  saveFamily(family);
  editing = member.id;
  notice = null;
  render();
  (document.getElementById('member-name') as HTMLInputElement | null)?.select();
}

function removeMember(id: string) {
  const gone = family.find((m) => m.id === id);
  family = family.filter((m) => m.id !== id);
  saveFamily(family);
  editing = 'me';
  notice = gone ? { kind: 'saved', text: `${gone.name} removed.` } : null;
  render();
}

// ---------- views ----------

function noticeHtml(): string {
  if (busy) return `<div class="notice notice--busy" role="status"><span class="spinner"></span>${esc(busy)}</div>`;
  if (!notice) return '';
  if (notice.kind === 'not-found') {
    return `<div class="notice notice--warn" role="alert">
      <strong>${esc(notice.text)}</strong>
      <p>You can photograph the ingredients label instead and get the same answers.${photoFor ? ' It will be remembered for next time.' : ''}</p>
      <div class="row">
        <button class="btn btn--small" data-action="photo" ${photoFor ? `data-for="${esc(photoFor)}"` : ''}>Photograph the label</button>
        ${photoFor ? link('https://world.openfoodfacts.org/cgi/product.pl', 'Add it to Open Food Facts').replace('<a ', '<a class="link" ') : ''}
      </div>
    </div>`;
  }
  const cls = notice.kind === 'error' ? 'notice--error' : notice.kind === 'saved' ? 'notice--ok' : notice.kind === 'warn' ? 'notice--warn' : 'notice--info';
  return `<div class="notice ${cls}" role="${notice.kind === 'error' ? 'alert' : 'status'}">${esc(notice.text)}</div>`;
}

function welcomeView(): string {
  return `
    <div class="welcome">
      <div class="welcome__mark">${icon('check')}</div>
      <h1>Is this safe for <em>you</em>?</h1>
      <ul class="welcome__points">
        <li><span>${icon('profile')}</span><div><strong>Tell us what to watch for</strong><small>Allergies, halal, vegan, diabetes, pregnancy, goals. Add family and pets too.</small></div></li>
        <li><span>${icon('scan')}</span><div><strong>Scan any barcode</strong><small>Food, cosmetics and pet food. Or search by name.</small></div></li>
        <li><span>${icon('shield')}</span><div><strong>Get your answer instantly</strong><small>Safe or Not safe, with the reason. Food also gets a health score made for you.</small></div></li>
      </ul>
      <button class="btn btn--primary btn--big" data-action="onboard-skip">Start scanning</button>
      <button class="btn btn--secondary btn--big" data-action="onboard-start">Set up my profile first · 30 seconds</button>
      <p class="hint"><strong>Free, for good.</strong> No account, no sign-up, no subscription, no trial, no ads. Your profile never leaves this phone. <a href="./privacy.html">Privacy &amp; terms</a></p>
    </div>`;
}

function histRow(e: HistoryEntry, index: number): string {
  const kind = kindOf(e.product);
  const verdict = mainVerdict(e.product);
  const score = kind === 'food' ? computeScore(e.product, profile) : null;
  const source =
    (kind !== 'food' ? ` · ${KIND_LABEL[kind].toLowerCase()}` : '') +
    (e.product.source === 'photo' ? ' · label photo' : e.product.source === 'demo' ? ' · demo' : '');
  return `<button class="hist" data-action="history-open" data-index="${index}">
    <span class="thumb">
      ${e.product.imageUrl
        ? `<img src="${esc(e.product.imageUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
        : `<b>${esc(e.product.name.charAt(0).toUpperCase())}</b>`}
      <span class="dot dot--${verdict.level}" title="${verdictTitle(verdict.level, kind, allergyNeeds(profile).length > 0)}"></span>
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
      ${SAMPLE_BARCODES.map((s, i) => `<button class="tile tile--${i % 5}" data-action="sample" data-barcode="${esc(s.barcode)}" data-kind="${s.kind}"><span class="tile__emoji" aria-hidden="true">${s.emoji}</span>${esc(s.label)}</button>`).join('')}
    </div>
    <p class="samples__label">Works offline <span class="tag">demo data</span></p>
    <div class="tiles">
      ${DEMO_PRODUCTS.map((d, i) => `<button class="tile tile--${(i + 2) % 5}" data-action="demo" data-index="${i}"><span class="tile__emoji" aria-hidden="true">${DEMO_EMOJI[i]}</span>${esc(d.name)}</button>`).join('')}
    </div>`;
}

/** Results of a search by name. Tapping one runs the normal check on it. */
function searchHtml(): string {
  if (!search || !search.hits.length) return '';
  return `<section class="recent search">
    <div class="section-head"><h2>Results for “${esc(search.query)}”</h2><button class="link" data-action="search-clear">Clear</button></div>
    <div class="hist-list">${search.hits.map((h) => `<button class="hist" data-action="search-open" data-barcode="${esc(h.barcode)}" data-kind="${h.kind}" ${busy ? 'disabled' : ''}>
      <span class="thumb">${h.imageUrl ? `<img src="${esc(h.imageUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : `<b>${esc(h.name.charAt(0).toUpperCase())}</b>`}</span>
      <span class="hist__main">
        <span class="hist__name">${esc(h.name)}</span>
        <span class="hist__time">${h.brand ? `${esc(h.brand)} · ` : ''}${KIND_LABEL[h.kind]}</span>
      </span>
    </button>`).join('')}</div>
  </section>`;
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
        <div class="scanner__help" id="scan-help" hidden>
          <p id="scan-help-text"></p>
          <button class="btn scanner__btn" data-action="scan-type">Type the number instead</button>
          <button class="btn scanner__btn" data-action="scan-retry" id="scan-retry" hidden>Restart camera</button>
        </div>
        <div class="scanner__bar">
          <button class="btn scanner__btn" data-action="scan-torch" id="scan-torch" aria-pressed="false" hidden>Light</button>
          <button class="btn scanner__btn" data-action="scan-stop">Cancel</button>
        </div>
      </div>`
    : `<button class="btn btn--primary btn--scan" data-action="scan-start" ${busy ? 'disabled' : ''}>
        <span class="hero__art" aria-hidden="true"><i></i><i></i><i></i><b></b></span>
        <span class="hero__title">Scan a<br />product</span>
        <small>Food, cosmetics or pet food</small>
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
        <input id="barcode-input" name="barcode" type="search" enterkeyhint="search" autocomplete="off" autocapitalize="off" maxlength="80" aria-label="Type a barcode or a product name" placeholder="Barcode or product name" />
        <button class="btn" type="submit" ${busy ? 'disabled' : ''}>Look up</button>
      </div>
    </form>
    ${searchHtml()}
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
    ? `<div class="fulling"><h3 class="ing__title">Ingredients</h3>${ingredientsBody(p)}</div>`
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

/** One line per family member and pet: the same product, checked for each of them. */
function familyHtml(p: ProductData): string {
  const kind = kindOf(p);
  if (kind === 'petfood') {
    return pets().length ? '' : `<p class="active-profile">Checked for dogs and cats in general. <button class="link" data-action="nav" data-view="profile">Add your pet</button></p>`;
  }
  const rows: string[] = [];
  for (const m of people()) {
    const v = verdictForPerson(p, m.profile, m.age ?? 'adult');
    const clean = v.level === 'safe' && kind !== 'beauty' && allergyNeeds(m.profile).length > 0;
    const young = isUnder4(m.age ?? 'adult') && kind === 'food' && v.level === 'safe';
    // "Not safe" is the wrong word for a biscuit: when age is the only reason, say that.
    const ageOnly = v.level === 'not-safe' && kind === 'food' && childConcerns(p, m.age ?? 'adult').notForAge.length > 0 && computeVerdict(p, m.profile).level !== 'not-safe';
    // For the youngest, a clean result still can't see texture: say so rather than show a bare green dot.
    rows.push(famRow(m.name, v.level, ageOnly ? 'Not for this age' : clean ? 'No allergens found' : VERDICT_SHORT[v.level], young ? `${v.reasons[0]} Not checked for choking risk: whole nuts and hard pieces are not for under-fives (NHS).` : v.reasons[0]));
  }
  if (kind === 'food' || kind === 'supplement') {
    for (const m of pets()) {
      const v = computePetVerdict(p, m.kind as Species);
      const status = v.level === 'not-safe' ? 'Not safe' : p.ingredientsText ? 'No toxins found' : 'Check label';
      rows.push(famRow(`${m.name} (${m.kind})`, v.level, status, v.reasons[0]));
    }
  }
  if (!rows.length) {
    return family.length ? '' : `<p class="active-profile fam-hint">Shopping for others too? <button class="link" data-action="nav" data-view="profile">Add family or pets</button></p>`;
  }
  return `<section class="card fam">
    <h2>${pets().length && (kind === 'food' || kind === 'supplement') ? 'Family &amp; pets' : 'Family'}</h2>
    <ul class="fam__list">${rows.join('')}</ul>
  </section>`;
}

function famRow(name: string, level: Verdict['level'], status: string, reason: string): string {
  return `<li class="fam__row fam__row--${level}">
    <span class="dot dot--${level}" aria-hidden="true"></span>
    <div><strong>${esc(name)} · ${esc(status)}</strong><small>${esc(reason)}</small></div>
  </li>`;
}

/** Finished cut-outs by photo address; null means "tried, keep the framed photo". */
const cutDone = new Map<string, Cutout | null>();

/** The product photo on the result: cut out from its backdrop when that is cleanly possible, neatly framed otherwise. */
function heroImage(p: ProductData): string {
  const src = p.imageFullUrl ?? p.imageUrl;
  if (!src) return '';
  const cut = src.startsWith('https://') ? cutDone.get(src) : undefined;
  if (cut) return `<img class="verdict__img verdict__img--cut" src="${esc(cut.url)}" alt="" />`;
  const remote = src.startsWith('https://');
  return `<img class="verdict__img" src="${esc(src)}" alt="" referrerpolicy="no-referrer" ${remote ? `crossorigin="anonymous" data-cut="${esc(src)}"` : ''} />`;
}

/** After a render: ask the FDA once whether this exact barcode is under recall (US food and supplements). */
function checkRecall(): void {
  const p = view === 'result' ? current : null;
  if (!p?.barcode || recallDone.has(p.barcode)) return;
  const kind = kindOf(p);
  if ((kind !== 'food' && kind !== 'supplement') || p.source === 'demo') return;
  const code = p.barcode;
  recallDone.set(code, null);
  void recallFor(code).then((r) => {
    if (!r) return;
    recallDone.set(code, r);
    if (view === 'result' && current?.barcode === code) render();
  });
}

/** After a render: try to cut out any product photo that hasn't been tried yet, and swap it in place. */
function enhanceImages(): void {
  app.querySelectorAll<HTMLImageElement>('img[data-cut]').forEach((img) => {
    const src = img.dataset.cut ?? '';
    if (!src || cutDone.has(src)) return;
    void cutoutFor(src).then((cut) => {
      cutDone.set(src, cut);
      if (!cut || !img.isConnected) return;
      img.removeAttribute('data-cut');
      img.removeAttribute('crossorigin');
      img.classList.add('verdict__img--cut');
      img.src = cut.url;
    });
  });
}

/** Does this one ingredient trip a check for the people or pets being shopped for? */
function chipTone(p: ProductData, name: string): '' | 'warn' | 'danger' {
  const one: ProductData = { name: '', allergens: [], traces: [], labels: [], ingredientsText: name, kind: p.kind, source: p.source };
  const kind = kindOf(p);
  if (kind === 'petfood') {
    const species: Species[] = pets().length ? [...new Set(pets().map((m) => m.kind as Species))] : ['dog', 'cat'];
    return species.some((sp) => computePetVerdict(one, sp).level === 'not-safe') ? 'danger' : '';
  }
  if (kind === 'beauty' && beautyFlags(one).some((f) => f.severity === 'danger')) return 'danger';
  const levels = [profile, ...people().map((m) => m.profile)].map((who) => verdictForPerson(one, who).level);
  if (levels.includes('not-safe')) return 'danger';
  if (kind === 'food' && pets().some((m) => computePetVerdict({ ...one, kind: 'food' }, m.kind as Species).level === 'not-safe')) return 'danger';
  return levels.includes('caution') ? 'warn' : '';
}

/** One ingredient as a chip: the name stands out, bracketed detail sits quietly after it. */
function chipHtml(name: string, tone: string, minor = false): string {
  const cut = name.search(/\s[([]/);
  const main = cut > 0 ? name.slice(0, cut) : name;
  const rest = cut > 0 ? name.slice(cut) : '';
  return `<li class="ing__chip${tone && !minor ? ` ing__chip--${tone}` : ''}">${esc(main)}${rest ? `<small>${esc(rest)}</small>` : ''}</li>`;
}

const MAIN_COUNT = 5;

/**
 * Most people don't want forty chemical names. Show what the product is mostly made of and
 * anything flagged for them; the full list is one tap away.
 */
function chipsHtml(p: ProductData, list: { items: string[]; notes: string[]; additives: string[] }, langCode?: string): string {
  const langAttr = langCode ? ` lang="${esc(langCode)}"` : '';
  const toned = list.items.map((name) => ({ name, tone: chipTone(p, name) }));
  const chip = (c: { name: string; tone: string }) => chipHtml(c.name, c.tone);
  const short = toned.length <= MAIN_COUNT + 3;
  const main = short ? toned : toned.slice(0, MAIN_COUNT);
  const flagged = short ? [] : toned.slice(MAIN_COUNT).filter((c) => c.tone);
  const hidden = toned.length - main.length - flagged.length;
  const anyTone = toned.some((c) => c.tone);
  return `
    <p class="ing__meta">${short ? `${toned.length} ingredient${toned.length === 1 ? '' : 's'} · most first` : 'Mostly made of'}</p>
    <ol class="ing ing--main"${langAttr}>${main.map(chip).join('')}</ol>
    ${flagged.length ? `<p class="ing__meta">Also contains</p><ul class="ing"${langAttr}>${flagged.map(chip).join('')}</ul>` : ''}
    ${anyTone ? `<p class="ing__legend"><i class="ing__dot ing__dot--danger"></i>flagged for you<i class="ing__dot ing__dot--warn"></i>worth knowing</p>` : ''}
    ${!short && !anyTone ? `<p class="ing__clear">Nothing in the rest of the list is flagged for you.</p>` : ''}
    ${list.notes.map((n) => `<p class="ing__note"${langAttr}>${esc(n)}</p>`).join('')}
    ${hidden > 0 || list.additives.length
      ? `<details class="ing__all"><summary>See all ${toned.length} ingredients</summary>
          <ol class="ing"${langAttr}>${toned.map(chip).join('')}</ol>
          ${list.additives.length ? `<p class="ing__label">Added vitamins &amp; additives</p><ul class="ing ing--minor"${langAttr}>${list.additives.map((i) => chipHtml(i, '', true)).join('')}</ul>` : ''}
        </details>`
      : ''}`;
}

/**
 * The ingredient list as chips, in the user's language when there is one; otherwise the original,
 * clearly labelled. The untouched database text is always one tap away.
 */
function ingredientsBody(p: ProductData): string {
  const raw = p.ingredientsShown ?? p.ingredientsText ?? '';
  const stored = p.ingredientItems?.length ? { items: p.ingredientItems, notes: p.ingredientNotes ?? [], additives: p.ingredientAdditives ?? [] } : null;
  const list = stored ?? parseIngredients(raw);
  const original = `<details class="ing__raw"><summary>Exact text from the database</summary><p lang="${esc(p.ingredientsLang ?? '')}">${esc(raw)}</p></details>`;
  if (!list.items.length) return `<p>${esc(raw)}</p>`;
  const foreign = !!p.ingredientsLang && p.ingredientsLang !== lang;
  if (!foreign) return chipsHtml(p, list) + original;
  const from = langName(p.ingredientsLang);
  if (p.ingredientsTranslated) {
    const translated = parseIngredients(p.ingredientsTranslated);
    return `${chipsHtml(p, { ...translated, additives: [] })}
      <p class="hint">Translated word for word from ${esc(from)} using the database’s ingredient names. The printed label is the authority.</p>
      <details class="ing__raw"><summary>Original (${esc(from)})</summary><p lang="${esc(p.ingredientsLang ?? '')}">${esc(raw)}</p></details>`;
  }
  return `<p class="hint">Shown in ${esc(from)}: the database has no ${esc(langName(lang))} version of this list.</p>
    ${chipsHtml(p, list, p.ingredientsLang)}${original}`;
}

const trimNum = (n: number) => (n >= 100 ? String(Math.round(n)) : String(Math.round(n * 100) / 100));

/** One nutrient against its safe upper limit, as a bar. */
function doseRow(d: ReturnType<typeof dailyTotals>[number]): string {
  const pct = Math.round(d.share * 100);
  const tone = d.share > 1 ? 'over' : d.share > 0.75 ? 'near' : 'ok';
  return `<li class="dose dose--${tone}">
    <div class="dose__top"><strong>${esc(d.label)}</strong><span>${pct}% of the safe limit</span></div>
    <div class="dose__bar"><i style="width:${Math.min(100, Math.max(3, pct))}%"></i></div>
    <small>${esc(doseText(d))}${d.note ? ` (${esc(d.note)})` : ''}</small>
  </li>`;
}

/** A candidate is only an alternative if it passes for everyone being shopped for and scores clearly better. */
function goodAlternatives(p: ProductData, candidates: ProductData[]): Alt[] {
  const mine = computeScore(p, profile)?.value ?? 0;
  const seen = new Set<string>();
  const out: Alt[] = [];
  for (const c of candidates) {
    if (!c.ingredientsText) continue; // never suggest what can't be checked
    if (verdictForPerson(c, profile).level !== 'safe') continue;
    if (people().some((m) => verdictForPerson(c, m.profile, m.age ?? 'adult').level === 'not-safe')) continue;
    const score = computeScore(c, profile)?.value;
    if (score === undefined || score < 60 || score < mine + 15) continue;
    const key = `${c.name.toLowerCase()}|${(c.brand ?? '').toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ product: c, score });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 5);
}

async function loadAlternatives(): Promise<void> {
  const p = current;
  if (!p || kindOf(p) !== 'food') return;
  const id = p.barcode ?? p.name;
  alts = { for: id, status: 'loading', items: [], local: false };
  render();
  try {
    const found = await findAlternatives(p, countryTag(navigator.language), (items) => goodAlternatives(p, items).length >= 3);
    alts = { for: id, status: 'done', items: goodAlternatives(p, found.items), local: found.local };
  } catch {
    alts = { for: id, status: 'error', items: [], local: false };
  }
  if (current === p) render();
}

/** Offered when a food scores poorly for the user or isn't a good fit. Loaded only on request. */
function alternativesHtml(p: ProductData, verdict: Verdict, score: number | null): string {
  if (kindOf(p) !== 'food' || !p.categories?.length || p.source === 'demo') return '';
  if (verdict.level === 'safe' && (score === null || score >= 60)) return '';
  const mine = alts && alts.for === (p.barcode ?? p.name) ? alts : null;
  const head = '<h2>Healthier options</h2>';
  if (!mine) {
    return `<section class="card alts">${head}
      <p class="hint">Similar products that score better and pass every check in your profile.</p>
      <button class="btn btn--secondary" data-action="alts-load">Find healthier options</button>
    </section>`;
  }
  if (mine.status === 'loading') return `<section class="card alts">${head}<p class="hint" role="status">Looking for similar products…</p></section>`;
  if (mine.status === 'error') {
    return `<section class="card alts">${head}
      <p class="hint">The product database is busy right now. Wait a moment and try again.</p>
      <button class="btn btn--secondary" data-action="alts-load">Try again</button>
    </section>`;
  }
  if (!mine.items.length) return `<section class="card alts">${head}<p>No clearly better option was found in this category that also passes your profile.</p></section>`;
  return `<section class="card alts">${head}
    <p class="hint">Same kind of product, better score, and each one passes your profile${people().length ? ' and has no allergen for your family' : ''}.${mine.local ? '' : ' These may not be sold near you.'}</p>
    <ul class="alts__list">${mine.items.map((a) => `
      <li><button class="alt" data-action="alt-open" data-barcode="${esc(a.product.barcode ?? '')}">
        <span class="thumb">${a.product.imageUrl ? `<img src="${esc(a.product.imageUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : `<b>${esc(a.product.name.charAt(0).toUpperCase())}</b>`}</span>
        <span class="alt__text"><strong>${esc(a.product.name)}</strong>${a.product.brand ? `<small>${esc(a.product.brand)}</small>` : ''}</span>
        <span class="alt__score band--${bandFor(a.score).key}">${a.score}</span>
      </button></li>`).join('')}</ul>
    <p class="hint">Scores are yours, worked out on this phone. Nobody pays to appear here. Check the pack before buying.</p>
  </section>`;
}

/** FDA recall notice for this exact barcode, when one exists. */
function recallHtml(p: ProductData): string {
  const r = p.barcode ? recallDone.get(p.barcode) : null;
  if (!r) return '';
  return `<section class="card recall" role="alert">
    <h2>${icon('warning')}FDA recall notice</h2>
    <p><strong>${esc(r.reason)}</strong></p>
    <p class="hint">${r.date ? `Started ${esc(r.date)}. ` : ''}${r.firm ? `Recalled by ${esc(r.firm)}. ` : ''}${r.status ? `Status: ${esc(r.status)}. ` : ''}This notice names this barcode. A recall can cover only some batches: check the lot number on your pack at ${link('https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts', 'fda.gov')}.</p>
  </section>`;
}

/** Supplements: no score. Doses against official limits, what the label hides, and the daily total. */
function supplementHtml(p: ProductData): string {
  const s = p.supplement;
  const pregnant = profile.rules.includes('pregnancy');
  const inStack = stack.some((i) => i.id === stackId(p));
  const doses = s ? dailyTotals([s], 'adult', pregnant) : [];
  const perDay = s?.perDay ?? 1;
  const others = (s?.facts ?? []).filter((f) => !limitKey(f.name));
  const notes = supplementNotes(p, profile);

  const factsCard = s?.facts.length
    ? `<section class="card">
        <h2>What a day adds up to</h2>
        <p class="hint">${s.serving ? `Serving: ${esc(s.serving)}. ` : ''}${perDay > 1 ? `The label directs up to ${perDay} servings a day, so amounts are multiplied by ${perDay}.` : 'Based on one serving a day.'}</p>
        ${doses.length
          ? `<ul class="doses">${doses.map(doseRow).join('')}</ul>
             <p class="hint">Safe upper limit: the highest daily amount likely to pose no risk${pregnant ? ' in pregnancy' : ' for adults'}. Source: ${esc(LIMITS_SOURCE)}.</p>`
          : '<p>No vitamin or mineral with an official upper limit is listed.</p>'}
        ${others.length
          ? `<details class="ing__all"><summary>Everything else per serving (${others.length})</summary>
              <ul class="facts">${others.map((f) => `<li><span>${esc(f.name)}</span><b>${esc(trimNum(f.amount))} ${esc(f.unit)}</b></li>`).join('')}</ul>
            </details>`
          : ''}
      </section>`
    : `<section class="card">
        <h2>Doses not checked</h2>
        <p>The amounts per serving aren’t in the database for this product.</p>
        <button class="btn btn--secondary" data-action="photo" ${p.barcode ? `data-for="${esc(p.barcode)}"` : ''}>${icon('camera')}Photograph the Supplement Facts panel</button>
      </section>`;

  const notesCard = notes.length
    ? `<section class="card">
        <h2>Worth knowing</h2>
        <ul class="notable">${notes.map((n) => `<li class="flag flag--${n.tone === 'warn' ? 'restricted' : 'info'}"><strong>${esc(n.title)}</strong>${n.text ? `<p>${esc(n.text)}</p>` : ''}${n.source ? `<p class="source">Source: ${esc(n.source)}</p>` : ''}</li>`).join('')}</ul>
      </section>`
    : '';

  const stackCard = s?.facts.length
    ? `<section class="card">
        <h2>My daily supplements</h2>
        ${stackTotalsHtml(inStack ? null : p)}
        <button class="btn ${inStack ? 'btn--ghost' : 'btn--secondary'}" data-action="${inStack ? 'stack-remove' : 'stack-add'}" data-id="${esc(stackId(p))}">${inStack ? 'Remove from my daily supplements' : 'I take this every day'}</button>
      </section>`
    : '';

  const ingredients = p.ingredientsText
    ? `<section class="card"><h2>Other ingredients</h2>${ingredientsBody(p)}</section>`
    : '';
  return factsCard + notesCard + stackCard + ingredients;
}

const stackId = (p: ProductData) => p.barcode ?? p.name;

/** The saved daily supplements added together. `preview` shows what adding this product would do. */
function stackTotalsHtml(preview: ProductData | null): string {
  if (!stack.length) return '<p class="hint">Save what you take every day. Greenlit adds each vitamin and mineral up across all of them and warns when the total passes the safe limit. Several bottles together can pass a limit that no single one does.</p>';
  const pregnant = profile.rules.includes('pregnancy');
  const items = [...stack, ...(preview?.supplement ? [preview.supplement] : [])];
  const totals = dailyTotals(items, 'adult', pregnant).filter((d) => d.share > 0.5).slice(0, 6);
  return `
    <ul class="stack">${stack.map((i) => `<li><span>${esc(i.name)}${i.perDay > 1 ? ` · ${i.perDay} a day` : ''}</span><button class="link" data-action="stack-remove" data-id="${esc(i.id)}" aria-label="Remove ${esc(i.name)}">Remove</button></li>`).join('')}</ul>
    <p class="ing__meta">${preview ? 'Your total if you add this one' : 'Your daily total'}</p>
    ${totals.length ? `<ul class="doses">${totals.map(doseRow).join('')}</ul>` : '<p class="hint">Nothing is above half of its safe limit.</p>'}`;
}

/** Cosmetics: no score, just the ingredients worth knowing about. */
function beautyHtml(p: ProductData): string {
  if (!p.ingredientsText) return '';
  const flags = beautyFlags(p);
  return `<section class="card">
    <h2>What’s in it</h2>
    ${flags.length
      ? `<ul class="notable">${flags.map((f) => `<li class="flag flag--${f.severity}"><strong>${esc(f.name)}</strong><p>${esc(f.note)}</p>${f.source ? `<p class="source">Source: ${esc(f.source)}</p>` : ''}</li>`).join('')}</ul>
         <p class="hint">These notes report what regulators have decided. Cosmetics have no official health score, so Greenlit doesn’t invent one.</p>`
      : `<p>No ingredients that regulators have banned, restricted or flagged were found in this list.</p>
         <p class="hint">Cosmetics have no official health score, so Greenlit doesn’t invent one.</p>`}
    <div class="fulling"><h3 class="ing__title">Ingredients</h3>${ingredientsBody(p)}</div>
  </section>`;
}

function resultView(): string {
  const p = current;
  if (!p) return `<p class="empty">No result open.</p><button class="btn btn--primary" data-action="nav" data-view="scan">Scan a product</button>`;

  const kind = kindOf(p);
  const verdict = mainVerdict(p);
  const allergy = kind !== 'petfood' && kind !== 'beauty' && allergyNeeds(profile).length > 0;
  const score = kind === 'food' ? computeScore(p, profile) : null;
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
    (kind !== 'food' ? `<span class="tag">${KIND_LABEL[kind]}</span>` : '') +
    (p.source === 'photo' ? '<span class="tag tag--photo">From your label photo</span>'
    : p.source === 'demo' ? '<span class="tag">Demo data</span>'
    : '');

  const checkedFor =
    kind === 'petfood' ? ''
    : `<p class="active-profile">${summary ? `Checked for: <strong>${esc(summary)}</strong>` : 'No profile set — this is a generic check. <button class="link" data-action="nav" data-view="profile">Set up your profile</button>'}</p>`;

  const foodCards = kind !== 'food' ? '' : `
    <section class="card">
      <h2>Your personal score</h2>
      ${scoreHtml}
    </section>

    ${whyHtml(explain(p, profile, verdict, score), p)}`;

  const petCard = kind === 'petfood' && p.ingredientsText
    ? `<section class="card"><h2>Ingredients</h2>${ingredientsBody(p)}</section>`
    : '';

  return `
    <section class="verdict verdict--${verdict.level}" aria-live="polite">
      <span class="verdict__art" aria-hidden="true"><i></i><i></i></span>
      ${heroImage(p)}
      <div class="verdict__icon">${icon(VERDICT_ICON[verdict.level])}</div>
      <h1 class="verdict__title">${verdictTitle(verdict.level, kind, allergy)}</h1>
      <ul class="verdict__reasons">${verdict.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
      ${verdict.warnings.map((w) => `<p class="verdict__warning">${icon('warning')}<span>${esc(w)}</span></p>`).join('')}
      ${p.badIngredients ? '<p class="verdict__note">The database entry for this product has advertising text where the ingredients should be, so Greenlit ignored it.</p>' : ''}
      ${(!p.ingredientsText || (allergy && verdict.level !== 'not-safe')) && p.source !== 'photo' && p.source !== 'demo' ? `<button class="btn verdict__action" data-action="photo" ${p.barcode ? `data-for="${esc(p.barcode)}"` : ''}>${icon('camera')}${p.ingredientsText ? 'Check against my pack' : 'Photograph the label'}</button>` : ''}
    </section>
    ${recallHtml(p)}
    ${checkedFor}
    ${familyHtml(p)}
    ${foodCards}
    ${kind === 'beauty' ? beautyHtml(p) : ''}
    ${kind === 'supplement' ? supplementHtml(p) : ''}
    ${alternativesHtml(p, verdict, score?.value ?? null)}
    ${petCard}

    <section class="card product">
      <div>
        <div class="product__name">${esc(p.name)}</div>
        ${p.brand ? `<div class="product__brand">${esc(p.brand)}</div>` : ''}
        ${p.barcode ? `<div class="product__code">Barcode ${esc(p.barcode)}</div>` : ''}
        ${sourceBadge}
      </div>
    </section>

    ${kind !== 'food' ? '' : `<section class="card">
      <h2>Per 100g</h2>
      <div class="nums">
        ${numberCell('Sugar', n.sugars)}${numberCell('Salt', n.salt)}${numberCell('Fat', n.fat)}${numberCell('Protein', n.protein)}
        ${numberCell('Sat. fat', n.saturatedFat)}${numberCell('Carbs', n.carbs)}${numberCell('Fibre', n.fiber)}${numberCell('Energy', n.kcal, ' kcal')}
      </div>
    </section>`}

    <footer class="legal">
      <p>${SOURCE_CREDIT[p.source] ?? ATTRIBUTION}</p>
      ${p.source === 'photo' ? '<p>This result was read from your photo by Google Gemini and may contain reading mistakes.</p>' : ''}
      ${p.source === 'demo' ? '<p>This is made-up demo data, not a real product.</p>' : ''}
      ${fixLink(p)}
      <p>${KIND_DISCLAIMER[kind]}</p>
    </footer>

    <div class="actionbar"><button class="btn btn--primary btn--big" data-action="scan-next">Scan next product</button></div>`;
}

function check(name: string, value: string, label: string, hint: string | undefined, checked: boolean, type = 'checkbox'): string {
  return `<label class="opt">
    <input type="${type}" name="${name}" value="${esc(value)}" ${checked ? 'checked' : ''} />
    <span class="opt__text"><span>${esc(label)}</span>${hint ? `<small>${esc(hint)}</small>` : ''}</span>
  </label>`;
}

/** Who the Profile screen can show: the user, then people, then pets as their own group. */
function memberChips(): string {
  const chip = (id: string, label: string) =>
    `<button type="button" class="chip ${editing === id ? 'is-on' : ''}" data-action="member-select" data-id="${esc(id)}">${esc(label)}</button>`;
  const full = family.length >= FAMILY_LIMIT;
  return `<section class="members">
    <div class="members__group">
      <span class="members__label">People</span>
      <div class="chips">${chip('me', 'You')}${people().map((m) => chip(m.id, m.name)).join('')}${full ? '' : '<button type="button" class="chip chip--add" data-action="member-add" data-kind="person">+ Add person</button>'}</div>
    </div>
    <div class="members__group">
      <span class="members__label">Pets</span>
      <div class="chips">${pets().map((m) => chip(m.id, m.name)).join('')}${full ? '' : '<button type="button" class="chip chip--add" data-action="member-add" data-kind="dog">+ Add pet</button>'}</div>
    </div>
    ${full ? `<p class="hint">You can keep up to ${FAMILY_LIMIT} family members and pets.</p>` : ''}
  </section>`;
}

function profileView(): string {
  const member = onboarding ? undefined : family.find((m) => m.id === editing);
  const who = member?.profile ?? profile;
  const skin = who.skin ?? [];
  const nameField = member
    ? `<fieldset><legend>Name</legend>
        <input id="member-name" name="name" maxlength="24" autocomplete="off" aria-label="Name" value="${esc(member.name)}" />
      </fieldset>
      ${member.kind === 'person'
        ? `<fieldset><legend>Age</legend>
            <div class="opts opts--grid">${AGE_OPTS.map(([v, l]) => check('age', v, l, undefined, (member.age ?? 'adult') === v, 'radio')).join('')}</div>
            <p class="hint">Children are checked differently: caffeine, added sugar, honey and salt for the youngest, and lower safe limits for supplements.</p>
          </fieldset>`
        : ''}`
    : '';
  const removeButton = member
    ? `<button class="btn btn--ghost" type="button" data-action="member-remove" data-id="${esc(member.id)}">Remove ${esc(member.name)}</button>`
    : '';

  if (member && member.kind !== 'person') {
    return `
      <h1 class="title">Your pets</h1>
      <p class="sub">Every food you scan is checked for ingredients that are toxic to your pet. Stored only on this device.</p>
      ${memberChips()}
      <form data-form="profile">
        ${nameField}
        <fieldset><legend>Animal</legend>
          <div class="opts opts--grid">${check('species', 'dog', 'Dog', undefined, member.kind === 'dog', 'radio')}${check('species', 'cat', 'Cat', undefined, member.kind === 'cat', 'radio')}</div>
        </fieldset>
        <p class="hint">Checks for chocolate, xylitol, grapes and raisins, onion, garlic, alcohol, caffeine and more, using the ASPCA Animal Poison Control list. Not veterinary advice.</p>
        ${noticeHtml()}
        ${removeButton}
        <div class="actionbar"><button class="btn btn--primary btn--big" type="submit">Save pet</button></div>
      </form>`;
  }

  return `
    <h1 class="title">${onboarding ? 'What should we watch for?' : member ? 'Family profile' : 'Your profile'}</h1>
    <p class="sub">${onboarding ? 'Tick anything that applies. You can change it any time.' : member ? 'Every scan is also checked for this person. Stored only on this device.' : 'Set once. Stored only on this device.'}</p>
    ${onboarding ? '' : memberChips()}
    <form data-form="profile">
      ${nameField}
      <fieldset><legend>Allergies</legend>
        <div class="opts opts--grid">${ALLERGY_OPTS.map(([v, l]) => check('allergies', v, l, undefined, who.allergies.includes(v))).join('')}</div>
      </fieldset>
      <fieldset><legend>Diet &amp; intolerances</legend>
        <div class="opts">${RULE_OPTS.map(([v, l, h]) => check('rules', v, l, h, who.rules.includes(v))).join('')}</div>
      </fieldset>
      <fieldset><legend>Health watch</legend>
        <div class="opts">${WATCH_OPTS.map(([v, l, h]) => check('watch', v, l, h, who.watch.includes(v))).join('')}</div>
      </fieldset>
      <fieldset><legend>Prefer to avoid</legend>
        <div class="opts opts--grid">${AVOID_OPTS.map(([v, l]) => check('watch', v, l, undefined, who.watch.includes(v))).join('')}</div>
        <label class="field field--gap" for="avoid-custom">Anything else to avoid?</label>
        <input id="avoid-custom" name="avoidCustom" type="text" autocomplete="off" autocapitalize="off" maxlength="300" placeholder="e.g. sucralose, canola oil, MSG" value="${esc((who.avoidCustom ?? []).join(', '))}" />
        <p class="hint">Separate with commas. A product that lists one is marked “Not ideal”.</p>
      </fieldset>
      <fieldset><legend>Goal</legend>
        <div class="opts opts--grid">${GOAL_OPTS.map(([v, l]) => check('goal', v, l, undefined, who.goal === v, 'radio')).join('')}</div>
      </fieldset>
      <fieldset><legend>Skin &amp; cosmetics</legend>
        <div class="opts">${SKIN_OPTS.map(([v, l, h]) => check('skin', v, l, h, skin.includes(v))).join('')}</div>
        <p class="opts__label">Avoid in cosmetics</p>
        <div class="opts opts--grid">${SKIN_AVOID_OPTS.map(([v, l]) => check('skin', v, l, undefined, skin.includes(v))).join('')}</div>
      </fieldset>
      ${noticeHtml()}
      ${removeButton}
      <div class="actionbar ${onboarding ? 'actionbar--bottom' : ''}"><button class="btn btn--primary btn--big" type="submit">${onboarding ? 'Save and start scanning' : member ? `Save ${esc(member.name)}` : 'Save profile'}</button></div>
    </form>`;
}

function historyView(): string {
  const entries = loadHistory();
  if (!entries.length) {
    return `<h1 class="title">History</h1>
      <p class="empty">No scans yet. Your last 20 scans will appear here.</p>
      <button class="btn btn--primary" data-action="nav" data-view="scan">Scan a product</button>`;
  }
  const levels = entries.map((e) => mainVerdict(e.product).level);
  const count = (f: HistoryFilter) => (f === 'all' ? entries.length : levels.filter((l) => l === f).length);
  const filters: [HistoryFilter, string][] = [['all', 'All'], ['safe', 'Safe'], ['not-safe', 'Not safe'], ['unknown', 'Check label']];
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
      <p>Cosmetics: ${link('https://world.openbeautyfacts.org', 'Open Beauty Facts')} (ODbL). Pet food: ${link('https://world.openpetfoodfacts.org', 'Open Pet Food Facts')} (ODbL). Extra US foods: ${link('https://fdc.nal.usda.gov', 'USDA FoodData Central')}.</p>
      <p>${DISCLAIMER}</p>
      <p class="hint">No account, no tracking. Your profile, history and key never leave this browser.</p>
      <p><a href="./privacy.html">Privacy &amp; terms</a> · <a href="./support.html">Help &amp; support</a></p>
    </section>
    <section class="card">
      <h2>Your data</h2>
      <p class="hint">Removes your profile, family and pets, scan history, counters and Gemini key from this device.</p>
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
  enhanceImages();
  checkRecall();
  syncScanner();
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
    case 'scan-type':
      stopScanner();
      render();
      document.getElementById('barcode-input')?.focus();
      break;
    case 'scan-retry':
      stopScanner();
      void beginScan();
      break;
    case 'scan-torch': {
      const on = el.getAttribute('aria-pressed') !== 'true';
      void scanSession?.torch(on).then((now) => {
        el.setAttribute('aria-pressed', String(now));
        el.textContent = now ? 'Light on' : 'Light';
      });
      break;
    }
    case 'sample':
      void lookup(el.dataset.barcode ?? '', el.dataset.kind as ProductKind | undefined);
      break;
    case 'demo':
      openResult(DEMO_PRODUCTS[Number(el.dataset.index)], true);
      break;
    case 'photo':
      requestPhoto('camera', el.dataset.for ?? null);
      break;
    case 'search-open':
      void lookup(el.dataset.barcode ?? '', el.dataset.kind as ProductKind);
      break;
    case 'search-clear':
      search = null;
      notice = null;
      render();
      break;
    case 'member-select':
      editing = el.dataset.id ?? 'me';
      notice = null;
      render();
      window.scrollTo(0, 0);
      break;
    case 'member-add':
      addMember(el.dataset.kind === 'person' ? 'person' : 'dog');
      break;
    case 'member-remove':
      removeMember(el.dataset.id ?? '');
      break;
    case 'alts-load':
      void loadAlternatives();
      break;
    case 'alt-open':
      void lookup(el.dataset.barcode ?? '', 'food');
      break;
    case 'stack-add':
      if (current?.supplement && !stack.some((i) => i.id === stackId(current!))) {
        stack = [...stack, { id: stackId(current), name: current.name, perDay: current.supplement.perDay ?? 1, facts: current.supplement.facts }];
        saveStack(stack);
        stack = loadStack();
      }
      render();
      break;
    case 'stack-remove':
      stack = stack.filter((i) => i.id !== el.dataset.id);
      saveStack(stack);
      render();
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
        lang = loadLang();
        setLookupLang(lang);
        family = loadFamily();
        stack = loadStack();
        editing = 'me';
        search = null;
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
      submitQuery(String(new FormData(form).get('barcode') ?? ''));
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
