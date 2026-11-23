import type { Nutriments, ProductData } from '../types';
import { normalizeAllergenName } from '../engine/verdict';

/**
 * Label-photo mode. Uses the user's own Gemini key. The key and the photo are
 * sent to exactly one host — Google's Generative Language API — and nowhere else.
 */

const API = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Tried in order. Google points new keys at the newer model, while some older
 * keys only have the older one, so a "model not found" moves on to the next.
 */
const MODELS = ['gemini-3.5-flash-lite', 'gemini-2.5-flash-lite'];
let workingModel: string | null = null;

const INSTRUCTION =
  'Read this food label photo (any language). Return ONLY JSON: {product_name, ingredients_text (translated to English), allergens: [..], nutriments per 100g if shown: {sugars, salt, saturated_fat, fat, protein, fiber, kcal}, contains_pork, contains_alcohol, contains_gelatin, halal_certified, kosher_certified}. Use null for anything not visible. Do not guess.';

export type PhotoErrorKind = 'key' | 'quota' | 'network' | 'model' | 'photo' | 'other';

/** An error whose message is safe and friendly enough to show to the user. */
export class PhotoError extends Error {
  constructor(message: string, readonly kind: PhotoErrorKind = 'other') {
    super(message);
  }
}

const num = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
};
const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);

/** Converts the model's JSON into the same product shape Open Food Facts lookups produce. */
export function mapPhotoJson(j: Record<string, any>): ProductData {
  const raw = j.nutriments && typeof j.nutriments === 'object' ? j.nutriments : {};
  const nutriments: Nutriments = {
    sugars: num(raw.sugars),
    salt: num(raw.salt),
    saturatedFat: num(raw.saturated_fat),
    fat: num(raw.fat),
    protein: num(raw.protein),
    fiber: num(raw.fiber),
    kcal: num(raw.kcal),
  };
  const hasNutriments = Object.values(nutriments).some((v) => v !== undefined);
  const allergens = Array.isArray(j.allergens)
    ? [...new Set(j.allergens.filter((a: unknown): a is string => typeof a === 'string' && !!a.trim()).map(normalizeAllergenName))]
    : [];
  const text = typeof j.ingredients_text === 'string' && j.ingredients_text.trim() ? j.ingredients_text.trim() : undefined;
  const name = typeof j.product_name === 'string' && j.product_name.trim() ? j.product_name.trim() : 'Label photo';

  return {
    name,
    ingredientsText: text,
    allergens: allergens as string[],
    traces: [],
    labels: [],
    nutriments: hasNutriments ? nutriments : undefined,
    photoFlags: {
      containsPork: bool(j.contains_pork),
      containsAlcohol: bool(j.contains_alcohol),
      containsGelatin: bool(j.contains_gelatin),
      halalCertified: bool(j.halal_certified),
      kosherCertified: bool(j.kosher_certified),
    },
    source: 'photo',
  };
}

/** Downscales the photo (keeps requests small and fast) and returns base64 JPEG data. */
async function toJpegBase64(file: File, maxSide = 1600): Promise<string> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new PhotoError('That file couldn’t be opened as a photo. Try a JPEG or PNG.', 'photo');
  }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
}

async function toError(res: Response): Promise<PhotoError> {
  let reason = '';
  let message = '';
  try {
    const err = (await res.json())?.error;
    message = String(err?.message ?? '');
    reason = String(err?.details?.find((d: { reason?: string }) => d.reason)?.reason ?? err?.status ?? '');
  } catch {
    // no readable error body
  }
  if (res.status === 429) {
    return new PhotoError('Your free Google allowance is used up for now. Wait a minute and try again (daily limits reset overnight).', 'quota');
  }
  if (reason === 'API_KEY_INVALID' || res.status === 401 || /api key/i.test(message)) {
    return new PhotoError('Google says this key isn’t valid. Copy it again from Google AI Studio — the whole key, with nothing extra.', 'key');
  }
  if (res.status === 403) {
    return new PhotoError('Google refused this key. Open Google AI Studio and check the key isn’t marked Blocked or Unrestricted, then try again.', 'key');
  }
  if (res.status === 404) {
    return new PhotoError('This key can’t use the AI model the app needs for photos. Barcode scanning still works.', 'model');
  }
  if (res.status === 400) {
    return new PhotoError('Google couldn’t process that. Try again with a clearer photo.', 'photo');
  }
  return new PhotoError(`Google’s AI service had a problem (error ${res.status}). Try again in a moment.`);
}

/** Calls Gemini with the user's key. The key goes in a header, to Google only. */
async function generate(apiKey: string, body: unknown): Promise<any> {
  const order = workingModel ? [workingModel, ...MODELS.filter((m) => m !== workingModel)] : MODELS;
  let last: Response | null = null;
  for (const model of order) {
    let res: Response;
    try {
      res = await fetch(`${API}/${model}:generateContent`, {
        method: 'POST',
        referrerPolicy: 'no-referrer',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
      });
    } catch {
      throw new PhotoError('Couldn’t reach Google. Check your connection and try again.', 'network');
    }
    if (res.ok) {
      workingModel = model;
      return res.json();
    }
    last = res;
    if (res.status !== 404) break; // only "model not found" is worth trying the next model for
  }
  throw await toError(last!);
}

/** Checks a key really works by asking Google for a one-word reply. Throws PhotoError if not. */
export async function testKey(apiKey: string): Promise<void> {
  await generate(apiKey, {
    contents: [{ parts: [{ text: 'Reply with the single word OK.' }] }],
    generationConfig: { temperature: 0 },
  });
}

export async function readLabelPhoto(file: File, apiKey: string): Promise<ProductData> {
  const data = await toJpegBase64(file);
  const body = await generate(apiKey, {
    contents: [{ parts: [{ text: INSTRUCTION }, { inline_data: { mime_type: 'image/jpeg', data } }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0 },
  });

  const unreadable = () =>
    new PhotoError('The label couldn’t be read from that photo. Retake it closer, flat, and in good light.', 'photo');
  let parsed: unknown;
  try {
    const text: string = (body?.candidates?.[0]?.content?.parts ?? [])
      .map((p: { text?: string }) => p.text ?? '')
      .join('');
    parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  } catch {
    throw unreadable();
  }
  if (!parsed || typeof parsed !== 'object') throw unreadable();
  return mapPhotoJson(parsed as Record<string, any>);
}
