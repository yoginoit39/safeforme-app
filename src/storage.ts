import { EMPTY_PROFILE, type HistoryEntry, type ProductData, type Profile } from './types';

/** Everything the app remembers lives in this browser's localStorage. Nothing is sent anywhere. */

const KEYS = {
  profile: 'safescan.profile.v1',
  history: 'safescan.history.v1',
  geminiKey: 'safescan.geminiKey',
  stats: 'safescan.stats.v1',
  flags: 'safescan.flags.v1',
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

export function loadProfile(): Profile {
  const p = read<Partial<Profile>>(KEYS.profile);
  if (!p || typeof p !== 'object') return { ...EMPTY_PROFILE };
  const goals: Profile['goal'][] = ['none', 'lose-weight', 'build-muscle', 'eat-cleaner'];
  return {
    allergies: strings(p.allergies),
    rules: strings(p.rules),
    watch: strings(p.watch),
    goal: goals.includes(p.goal as Profile['goal']) ? (p.goal as Profile['goal']) : 'none',
  };
}

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
