import type { Nutriments, ProductData, SupplementInfo } from '../types';
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

/** Which model answered the last successful request (for diagnostics). */
export const lastModelUsed = (): string | null => workingModel;

const INSTRUCTION =
  'Read this product label photo (any language). It may be food, a cosmetic, pet food or a dietary supplement. Return ONLY JSON: {product_type, product_name, ingredients_text (translated to English), allergens: [..], traces: [..], nutriments: {sugars, salt, saturated_fat, fat, protein, fiber, kcal, carbs}, contains_pork, contains_alcohol, contains_gelatin, halal_certified, kosher_certified, supplement_facts, serving_size, serving_grams, servings_per_day, proprietary_blends}. product_type is "supplement" for vitamins, minerals, protein powders, pre-workouts, herbal capsules and anything with a Supplement Facts panel; "cosmetic" for skincare, haircare, make-up, soap, toothpaste and similar; "dog_food", "cat_food" or "pet_food" for animal food; otherwise "food". For a cosmetic, ingredients_text keeps the ingredient names as printed (INCI names) and nutriments is null. "allergens" are allergens the product contains as ingredients; "traces" are allergens mentioned only as "may contain" or "traces of". "nutriments" are per 100g or 100ml as numbers without units (use kcal, not kJ; a comma is a decimal point); if the label only gives per-serving values, use null. halal_certified and kosher_certified are true only if a certification mark or statement is visible. For a supplement: supplement_facts lists every row of the Supplement Facts panel as {name, amount, unit} PER SERVING exactly as printed (amount is a number; unit is mg, mcg, g or IU; keep the form in the name, e.g. "Vitamin A (as beta-carotene)" or "Folate (mcg DFE)"); skip rows with no amount; serving_size is the printed serving ("2 capsules"); serving_grams is the serving weight in grams if printed; servings_per_day is the highest number of servings a day the directions allow, as a number; proprietary_blends lists the names of blends that show one total but not the amount of each ingredient inside; ingredients_text holds the "Other ingredients" plus the names of the active ingredients. Use null for anything not visible. Do not guess.';

/** Forces the reply into exactly this shape, so field names never vary between models. */
const NUM = { type: 'NUMBER', nullable: true };
const BOOL = { type: 'BOOLEAN', nullable: true };
const LABEL_SCHEMA = {
  type: 'OBJECT',
  properties: {
    product_type: { type: 'STRING', enum: ['food', 'cosmetic', 'dog_food', 'cat_food', 'pet_food', 'supplement'], nullable: true },
    product_name: { type: 'STRING', nullable: true },
    ingredients_text: { type: 'STRING', nullable: true },
    allergens: { type: 'ARRAY', items: { type: 'STRING' } },
    traces: { type: 'ARRAY', items: { type: 'STRING' } },
    nutriments: {
      type: 'OBJECT',
      nullable: true,
      properties: { sugars: NUM, salt: NUM, saturated_fat: NUM, fat: NUM, protein: NUM, fiber: NUM, kcal: NUM, carbs: NUM },
    },
    contains_pork: BOOL,
    contains_alcohol: BOOL,
    contains_gelatin: BOOL,
    halal_certified: BOOL,
    kosher_certified: BOOL,
    supplement_facts: { type: 'ARRAY', nullable: true, items: { type: 'OBJECT', properties: { name: { type: 'STRING' }, amount: { type: 'NUMBER' }, unit: { type: 'STRING' } } } },
    serving_size: { type: 'STRING', nullable: true },
    serving_grams: NUM,
    servings_per_day: NUM,
    proprietary_blends: { type: 'ARRAY', nullable: true, items: { type: 'STRING' } },
  },
  required: ['product_name', 'ingredients_text', 'allergens', 'traces', 'nutriments'],
};

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
function supplementFromPhoto(j: Record<string, any>): SupplementInfo {
  const facts = (Array.isArray(j.supplement_facts) ? j.supplement_facts : [])
    .map((f: any) => ({ name: typeof f?.name === 'string' ? f.name.trim() : '', amount: Number(f?.amount), unit: typeof f?.unit === 'string' ? f.unit.trim() : '' }))
    .filter((f: { name: string; amount: number; unit: string }) => f.name && f.unit && Number.isFinite(f.amount) && f.amount > 0)
    .slice(0, 80);
  const perDay = Number(j.servings_per_day);
  const grams = Number(j.serving_grams);
  return {
    serving: typeof j.serving_size === 'string' && j.serving_size.trim() ? j.serving_size.trim().slice(0, 40) : undefined,
    servingGrams: Number.isFinite(grams) && grams > 0 ? grams : undefined,
    perDay: Number.isFinite(perDay) && perDay >= 1 ? Math.min(12, Math.round(perDay)) : 1,
    facts,
    blends: (Array.isArray(j.proprietary_blends) ? j.proprietary_blends : []).filter((b: unknown): b is string => typeof b === 'string' && !!b.trim()).slice(0, 10),
  };
}

export function mapPhotoJson(j: Record<string, any>): ProductData {
  // Tolerate other spellings of the nutrition block (models have answered with "nutriments_per_100g").
  const nutriKey = Object.keys(j).find((k) => /^nutri/i.test(k) && j[k] && typeof j[k] === 'object');
  const raw = nutriKey ? j[nutriKey] : {};
  const nutriments: Nutriments = {
    sugars: num(raw.sugars),
    salt: num(raw.salt),
    saturatedFat: num(raw.saturated_fat ?? raw.saturatedFat ?? raw.saturates),
    fat: num(raw.fat),
    protein: num(raw.protein),
    fiber: num(raw.fiber),
    kcal: num(raw.kcal),
    carbs: num(raw.carbs ?? raw.carbohydrates),
  };
  const hasNutriments = Object.values(nutriments).some((v) => v !== undefined);
  const allergens = Array.isArray(j.allergens)
    ? [...new Set(j.allergens.filter((a: unknown): a is string => typeof a === 'string' && !!a.trim()).map(normalizeAllergenName))]
    : [];
  const traces: string[] = Array.isArray(j.traces)
    ? [...new Set<string>(j.traces.filter((a: unknown): a is string => typeof a === 'string' && !!a.trim()).map(normalizeAllergenName))]
    : [];
  const text = typeof j.ingredients_text === 'string' && j.ingredients_text.trim() ? j.ingredients_text.trim() : undefined;
  const name = typeof j.product_name === 'string' && j.product_name.trim() ? j.product_name.trim() : 'Label photo';

  return {
    name,
    ingredientsText: text,
    // An allergen listed both ways counts as contained.
    allergens: allergens as string[],
    traces: traces.filter((t) => !(allergens as string[]).includes(t)),
    labels: [],
    nutriments: hasNutriments ? nutriments : undefined,
    photoFlags: {
      containsPork: bool(j.contains_pork),
      containsAlcohol: bool(j.contains_alcohol),
      containsGelatin: bool(j.contains_gelatin),
      halalCertified: bool(j.halal_certified),
      kosherCertified: bool(j.kosher_certified),
    },
    kind: j.product_type === 'supplement' ? 'supplement' : j.product_type === 'cosmetic' ? 'beauty' : /^(dog|cat|pet)_food$/.test(j.product_type) ? 'petfood' : 'food',
    supplement: j.product_type === 'supplement' ? supplementFromPhoto(j) : undefined,
    categories: j.product_type === 'dog_food' ? ['dog-food'] : j.product_type === 'cat_food' ? ['cat-food'] : undefined,
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
  if (res.status === 503 || res.status === 500) {
    return new PhotoError('Google’s AI is busy right now. Wait a few seconds and try again.', 'network');
  }
  return new PhotoError(`Google’s AI service had a problem (error ${res.status}). Try again in a moment.`);
}

/** Calls Gemini with the user's key. The key goes in a header, to Google only. */
async function generate(apiKey: string, body: unknown): Promise<any> {
  const order = workingModel ? [workingModel, ...MODELS.filter((m) => m !== workingModel)] : MODELS;
  const send = (model: string) =>
    fetch(`${API}/${model}:generateContent`, {
      method: 'POST',
      referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
    });
  let last: Response | null = null;
  for (const model of order) {
    let res: Response;
    try {
      res = await send(model);
    } catch {
      throw new PhotoError('Couldn’t reach Google. Check your connection and try again.', 'network');
    }
    if (res.ok) {
      workingModel = model;
      return res.json();
    }
    last = res;
    // Google is overloaded (500/503): give this model one more go after a short pause, then move to the next model.
    if (res.status === 503 || res.status === 500) {
      await new Promise((r) => setTimeout(r, 1500));
      try {
        const again = await send(model);
        if (again.ok) {
          workingModel = model;
          return again.json();
        }
        last = again;
      } catch {
        // fall through to the next model
      }
      continue;
    }
    if (res.status !== 404) break; // "model not found" is the only other reason to try the next model
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
    generationConfig: { responseMimeType: 'application/json', responseSchema: LABEL_SCHEMA, temperature: 0 },
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

/** A plain-English explanation of a product's ingredients, written by the AI. */
export type AiExplanation = { overview: string; ingredients: { name: string; what: string; note?: string }[] };

const EXPLAIN_INSTRUCTION = `You explain packaged food to a shopper in plain, calm English.
Return ONLY JSON: {"overview": string, "ingredients": [{"name": string, "what": string, "note": string or null}]}.
- overview: 2 or 3 short sentences on what this product is mostly made of and the main things a health-conscious shopper should know.
- ingredients: at most 8, choosing the ones a shopper is least likely to understand or most likely to care about (additives, E-numbers, sweeteners, oils, sugars, flavourings). "what" says what it is and why it is used, in at most 14 words. "note" is at most 18 words and only for a well-established health or regulatory point; use null if there is none.
Rules: use only widely accepted facts; if unsure, leave the note out. Never say the product is safe or unsafe for anyone. No medical advice and no claims about treating or preventing disease. Do not mention ingredients that are not in the list. Translate ingredient names to English.`;

/**
 * Asks Gemini to explain the ingredients. Only product details are sent:
 * never the user's profile, allergies or history.
 */
export async function explainIngredients(product: ProductData, apiKey: string): Promise<AiExplanation> {
  const facts = {
    product: product.name,
    ingredients: product.ingredientsText ?? '',
    per_100g: product.nutriments ?? {},
    processing_group_nova: product.novaGroup ?? null,
  };
  const body = await generate(apiKey, {
    contents: [{ parts: [{ text: `${EXPLAIN_INSTRUCTION}\n\nProduct data:\n${JSON.stringify(facts)}` }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
  });
  const fail = () => new PhotoError('The AI didn’t give a usable answer this time. Please try again.');
  let parsed: any;
  try {
    const text: string = (body?.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('');
    parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  } catch {
    throw fail();
  }
  const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const overview = clean(parsed?.overview, 600);
  const ingredients = (Array.isArray(parsed?.ingredients) ? parsed.ingredients : [])
    .map((i: any) => ({ name: clean(i?.name, 60), what: clean(i?.what, 160), note: clean(i?.note, 200) || undefined }))
    .filter((i: { name: string; what: string }) => i.name && i.what)
    .slice(0, 8);
  if (!overview) throw fail();
  return { overview, ingredients };
}
