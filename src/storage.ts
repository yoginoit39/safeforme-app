import { isLang } from './lang';
import { EMPTY_PROFILE, type HistoryEntry, type Member, type ProductData, type Profile, type StackItem } from './types';

/** Everything the app remembers lives in this browser's localStorage. Nothing is sent anywhere. */

const KEYS = {
  profile: 'safescan.profile.v1',
  family: 'safescan.family.v1',
  history: 'safescan.history.v1',
  geminiKey: 'safescan.geminiKey',
  stats: 'safescan.stats.v1',
  flags: 'safescan.flags.v1',
  lang: 'safescan.lang.v1',
  stack: 'safescan.stack.v1',
} as const;

const HISTORY_LIMIT = 20;

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked (private mode): the app keeps working for this session.
  }
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Accepts anything that was stored and returns a well-formed profile. */
function cleanProfile(p: Partial<Profile> | null | undefined): Profile {
  if (!p || typeof p !== 'object') return { ...EMPTY_PROFILE, skin: [] };
  const goals: Profile['goal'][] = ['none', 'lose-weight', 'build-muscle', 'eat-cleaner'];
  return {
    allergies: strings(p.allergies),
    rules: strings(p.rules),
    watch: strings(p.watch),
    goal: goals.includes(p.goal as Profile['goal']) ? (p.goal as Profile['goal']) : 'none',
    skin: strings(p.skin),
    avoidCustom: strings(p.avoidCustom).map((t) => t.toLowerCase().trim()).filter((t) => t.length >= 2 && t.length <= 40).slice(0, 20),
  };
}

export const loadProfile = (): Profile => cleanProfile(read<Partial<Profile>>(KEYS.profile));

/** The other people and pets the user shops for. Stored only on this device, like the profile. */
export const FAMILY_LIMIT = 6;

export function loadFamily(): Member[] {
  const list = read<Partial<Member>[]>(KEYS.family);
  if (!Array.isArray(list)) return [];
  return list
    .filter((m) => m && typeof m.id === 'string' && typeof m.name === 'string' && m.name.trim())
    .slice(0, FAMILY_LIMIT)
    .map((m) => ({
      id: m.id!,
      name: m.name!.trim().slice(0, 24),
      kind: m.kind === 'dog' || m.kind === 'cat' ? m.kind : 'person',
      profile: cleanProfile(m.profile),
      // 'under4' was a single band in an earlier version: keep the strictest reading of it.
      age: (m.age as string) === 'under4' ? 'under1' : m.age === 'under1' || m.age === '1' || m.age === '2-3' || m.age === '4-8' || m.age === '9-18' ? m.age : undefined,
    }));
}

export const saveFamily = (family: Member[]) => write(KEYS.family, family.slice(0, FAMILY_LIMIT));

export const saveProfile = (profile: Profile) => write(KEYS.profile, profile);

export function loadHistory(): HistoryEntry[] {
  const h = read<HistoryEntry[]>(KEYS.history);
  return Array.isArray(h) ? h.filter((e) => e && typeof e.time === 'number' && e.product?.name) : [];
}

export function addHistory(product: ProductData): void {
  const rest = loadHistory().filter((e) => !(product.barcode && e.product.barcode === product.barcode));
  write(KEYS.history, [{ time: Date.now(), product }, ...rest].slice(0, HISTORY_LIMIT));
}

export function loadGeminiKey(): string {
  try {
    return localStorage.getItem(KEYS.geminiKey) ?? '';
  } catch {
    return '';
  }
}

export function saveGeminiKey(key: string): void {
  try {
    if (key) localStorage.setItem(KEYS.geminiKey, key);
    else localStorage.removeItem(KEYS.geminiKey);
  } catch {
    // ignore
  }
}

export function deleteAllData(): void {
  try {
    // Only this app's keys: other sites' apps on the same origin are left alone.
    Object.keys(localStorage)
      .filter((k) => k.startsWith('safescan.'))
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    // ignore
  }
}

/** Lifetime counters shown on the home screen. Kept on this device only. */
export type Stats = { scans: number; caught: number };

export function loadStats(): Stats {
  const s = read<Partial<Stats>>(KEYS.stats);
  return { scans: Number(s?.scans) || 0, caught: Number(s?.caught) || 0 };
}

export function recordScan(wasCaught: boolean): void {
  const s = loadStats();
  write(KEYS.stats, { scans: s.scans + 1, caught: s.caught + (wasCaught ? 1 : 0) });
}

/** Small UI flags: has the welcome screen been seen, was the install tip dismissed. */
export type Flags = { onboarded?: boolean; installDismissed?: boolean; aiTipDismissed?: boolean };

export const loadFlags = (): Flags => read<Flags>(KEYS.flags) ?? {};
export const setFlag = (flag: keyof Flags) => write(KEYS.flags, { ...loadFlags(), [flag]: true });

/** Language for product names and ingredient lists. Defaults to the phone's language. */
export function loadLang(): string {
  return 'en'; // English only for now; the per-language plumbing stays for later.
}
export const saveLang = (lang: string) => write(KEYS.lang, isLang(lang) ? lang : 'en');

/** Supplements the user takes every day, so doses can be added up across bottles. On this device only. */
export const STACK_LIMIT = 15;
export function loadStack(): StackItem[] {
  const list = read<Partial<StackItem>[]>(KEYS.stack);
  if (!Array.isArray(list)) return [];
  return list
    .filter((i) => i && typeof i.id === 'string' && typeof i.name === 'string' && Array.isArray(i.facts))
    .slice(0, STACK_LIMIT)
    .map((i) => ({
      id: i.id!,
      name: i.name!.slice(0, 80),
      perDay: Number.isFinite(i.perDay) && i.perDay! >= 1 ? Math.min(12, Math.round(i.perDay!)) : 1,
      facts: i.facts!.filter((f) => f && typeof f.name === 'string' && Number.isFinite(f.amount) && typeof f.unit === 'string').slice(0, 80),
    }));
}
export const saveStack = (stack: StackItem[]) => write(KEYS.stack, stack.slice(0, STACK_LIMIT));
