import { recognised } from './ingredients';
/** Language the user wants product names and ingredient lists in. The app's own text stays English. */

export const LANGS: { code: string; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'it', label: 'Italiano' },
  { code: 'pt', label: 'Português' },
  { code: 'nl', label: 'Nederlands' },
  { code: 'hi', label: 'हिन्दी (Hindi)' },
  { code: 'ar', label: 'العربية (Arabic)' },
  { code: 'tr', label: 'Türkçe' },
  { code: 'pl', label: 'Polski' },
  { code: 'ru', label: 'Русский' },
  { code: 'id', label: 'Bahasa Indonesia' },
  { code: 'sw', label: 'Kiswahili' },
  { code: 'zh', label: '中文 (Chinese)' },
  { code: 'ja', label: '日本語 (Japanese)' },
];

const NAMES: Record<string, string> = {
  en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian', pt: 'Portuguese', nl: 'Dutch', hi: 'Hindi',
  ar: 'Arabic', tr: 'Turkish', pl: 'Polish', ru: 'Russian', id: 'Indonesian', sw: 'Swahili', zh: 'Chinese', ja: 'Japanese',
  el: 'Greek', sv: 'Swedish', da: 'Danish', fi: 'Finnish', nb: 'Norwegian', cs: 'Czech', hu: 'Hungarian', ro: 'Romanian',
  bg: 'Bulgarian', th: 'Thai', vi: 'Vietnamese', ko: 'Korean', he: 'Hebrew', uk: 'Ukrainian', ca: 'Catalan', hr: 'Croatian',
};

export const isLang = (code: unknown): code is string => typeof code === 'string' && LANGS.some((l) => l.code === code);

/** English name of a language code, for notes such as "Shown in French". */
export const langName = (code: string | undefined): string => (code && NAMES[code]) || 'another language';

/** The phone's language when we support it, otherwise English. */
export function detectLang(): string {
  const nav = typeof navigator !== 'undefined' ? navigator.language : '';
  const code = (nav || 'en').slice(0, 2).toLowerCase();
  return isLang(code) ? code : 'en';
}

/**
 * Volunteers sometimes paste marketing copy into the ingredients box. A real list is short
 * items separated by commas; sentences are not. Text that fails this is treated as missing,
 * so the app says "Check the label" instead of judging a product on an advert.
 */
export function looksLikeIngredients(text: string): boolean {
  const parts = text
    .split(/[,;:•·\n()[\]،、*]|\.\s|\s[-–]\s/)
    .map((s) => s.trim())
    .filter((s) => /\p{L}/u.test(s));
  if (!parts.length) return false;
  const words = parts.map((s) => s.split(/\s+/).length);
  const total = words.reduce((a, b) => a + b, 0);
  const long = words.filter((w) => w >= 10);
  const longShare = long.reduce((a, b) => a + b, 0) / total;
  // Tuned on 400 real products: rejects pasted adverts, keeps lists with long bracketed notes.
  return !(long.length >= 2 && longShare >= 0.45 && total / parts.length >= 6);
}

type Parsed = { id?: unknown; text?: unknown; is_in_taxonomy?: unknown };

/** Canonical ingredient ids ('en:palm-oil') that the database recognised, in list order. */
export function recognisedIds(ingredients: unknown): { ids: string[]; total: number } {
  const list = Array.isArray(ingredients) ? (ingredients as Parsed[]) : [];
  const ids = list.map((i) => (recognised(i) ? (i.id as string) : ''));
  return { ids, total: list.length };
}

/** Readable name from a canonical id: 'en:palm-oil' → 'palm oil'. */
export const idToEnglish = (id: string): string => id.replace(/^en:/, '').replace(/-/g, ' ');

/**
 * Builds a translated list from the names the database knows. Returns nothing unless most
 * of the list could be translated: a half-translated list would mislead.
 */
export function buildTranslation(ingredients: unknown, nameFor: (id: string) => string | undefined): string | undefined {
  const list = Array.isArray(ingredients) ? (ingredients as Parsed[]) : [];
  if (list.length < 1) return undefined;
  let done = 0;
  const out = list.map((i) => {
    const id = typeof i?.id === 'string' ? i.id : '';
    const name = recognised(i) ? nameFor(id) : undefined;
    if (name) {
      done++;
      return name.toLowerCase();
    }
    return typeof i?.text === 'string' ? i.text : '';
  }).filter(Boolean);
  return done / list.length >= 0.7 ? out.join(', ') : undefined;
}
