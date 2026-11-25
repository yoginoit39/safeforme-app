/**
 * Turns the free text volunteers type into a clean list for display.
 *
 * Display only. The safety checks always read the untouched text, so a "may contain" line
 * or an ingredient this parser misjudges is never lost to them.
 *
 * The databases store whatever was typed from the pack, which often includes the maker's
 * address, phone number, website, trademark notices and batch codes. Three signals decide
 * what is an ingredient:
 *   1. the database's own parse: names it recognised are ingredients, wherever they appear
 *   2. markers that start packaging small print ("Made in", "www.", "F.I.L.", "LLC" ...)
 *   3. the shape of each item (addresses, phone numbers and sentences are not ingredients)
 */

export type IngredientList = { items: string[]; notes: string[]; additives: string[] };

/** Where packaging small print starts. */
const MARKERS = [
  String.raw`\(?\s*\bcode\s+f\.?\s?i\.?\s?l\b`, String.raw`\(?\s*\bf\.\s?i\.\s?l\.?\s*[a-z]?\s?\d`, String.raw`\bwww\.`, String.raw`https?:`, String.raw`\S+@\S+\.\w`,
  String.raw`\b[\w-]{3,}\.(com|net|org|co\.[a-z]{2})\b`,
  String.raw`(^|[\s,])(llc|inc\.?|ltd\.?|gmbh|s\.a\.s?\.?|sarl|s\.r\.l\.?|pvt\.?|co\.,?\s?ltd\.?|corp\.?)(?=[\s,.)]|$)`,
  String.raw`\bis a (registered )?trade\s?mark`, String.raw`\bregistered trade\s?mark`, String.raw`\bmarque déposée`, String.raw`©`,
  String.raw`\bmade in\b(?! an? )`, String.raw`\bproduct of\b`, String.raw`\bproduce of\b`, String.raw`\bquestions or comments`, String.raw`\bquestions\s*\?`,
  String.raw`\b(distributed|manufactured|imported|packed|marketed|produced|bottled|exported) (by|for|in)\b`, String.raw`\b(mfd|mkd|dist|pkd)\.? by\b`,
  String.raw`\b(distribué|fabriqué|importé|produit|conditionné|élaboré) (par|en|au|aux|pour)\b`, String.raw`\b(hecho|fabricado|elaborado|distribuido|importado) (en|por|para)\b`,
  String.raw`\b(hergestellt|vertrieb|vertrieben) (in|von|durch)\b`, String.raw`\b(prodotto|distribuito) (in|da)\b`, String.raw`\bصنع في`,
  String.raw`\b1[-\s]8\d\d[-\s]\d{3}`, String.raw`\btoll[\s-]?free\b`, String.raw`\bcustomer (care|service)`, String.raw`\bconsumer (care|service|helpline)`, String.raw`\bservice consommateurs?\b`,
  String.raw`\bbatch (no|number|code)`, String.raw`\blot (no|number)`, String.raw`\bnet (wt|weight|vol|content)`, String.raw`\bpoids net\b`, String.raw`\bfor sale in\b`, String.raw`\bnot for sale\b`,
  // Sections that follow the ingredient list on the pack.
  String.raw`\b(constituants|composants) analytiques\b`, String.raw`\banalytical (constituents|components)\b`, String.raw`\banalytische (bestandteile|bestanddelen)\b`,
  String.raw`\b(componentes|constituyentes) anal[ií]ticos\b`, String.raw`\b(componenti|tenori) analitic[io]\b`, String.raw`\bguaranteed analysis\b`,
  String.raw`\b(usage|feeding) (information|guide|instructions)\b`, String.raw`\bmode d'emploi\b`, String.raw`\bconseils? d'utilisation\b`, String.raw`\bdirections?( for use)?\s*:`, String.raw`\bhow to use\b`,
  String.raw`\bnutrition(al)? (facts|information|values?)\b`, String.raw`\bvaleurs? nutritionnelles?\b`, String.raw`\b(crude|brute)s? (protein|fat|fibre|fiber|ash)`, String.raw`\b(protéines?|matières grasses|cellulose|cendres) brutes?\b`,
  String.raw`\b(lote|lot|batch)\s*:`, String.raw`\bcontenido neto\b`, String.raw`\bnumbers in brackets\b`,
  String.raw`(^|\s)(co|cie|corp)\.?$`, String.raw`\b(à l'abri|tenir hors|garder hors|keep out of|keep away|store in|à conserver|conserver (au|à|dans)|mantener|aufbewahren)\b`,
  String.raw`\bfssai\b`, String.raw`\blic(ense|ence)?\.? no\b`, String.raw`\bm\.?r\.?p\b`, String.raw`\bp\.?\s?o\.? box\b`,
];
const MARKER = new RegExp(MARKERS.join('|'), 'i');

/** Pet food lists added vitamins and preservatives in their own section, with amounts per kg. */
const ADDITIVES = /_?\b((nutritional|technological|sensory|zootechnical)\s+)?(additi(ve|f|v)s?|zusatzstoffe|aditivos|additivi|toevoegingsmiddelen)(\s+(nutritionnels|technologiques|nutricionales|nutrizionali|tecnológicos|tecnologici))?_?\s*((\((per|par|au|por|pro)?\s*\/?\s*kg\)|(per|par|au|por|pro|\/)\s*kg)\s*_?\s*[:：]?|_?\s*[:：])/i;
const ADDITIVE_HEADING = /^_?\s*(additi(ve|f|v)s?|zusatzstoffe|aditivos|additivi|nutritional|nutritionnels|technological|technologiques|antioxidants?|antioxygènes|preservatives?|conservateurs|colou?rants?|colorants|trace elements|oligo-?éléments|vitamins?|vitamines)\b[^:]{0,30}[:：]\s*/i;
/** "Vitamine D3: 330 UI" → "Vitamine D3". */
const AMOUNT = /(\s+|\s*[:：]\s*)\d[\d.,]*(\s\d{3})*\s*(mg|g|kg|µg|mcg|ui|iu|u\.i\.|ie|%|ppm)\b.*$/i;

/** Statements that belong next to the list, not in it. */
const NOTE = /^(may contain|traces? éventuelles?|possible traces?|en g pour|ingrédients? issus?|issus? de l[’']agriculture|from organic|organic farming|contains?\b|contient|peut contenir|traces? (of|de|possibles)|kann .*enthalten|enthält|puede contener|contiene|può contenere|allergen|allergy advice|for allergens|free from|produced in a (facility|factory)|made in a (facility|factory)|manufactured in a (facility|factory)|packed in a|not suitable|suitable for|store |keep |refrigerate|best before|use by|shake well|warning|caution|avoid contact|for external use|à conserver|conserver|conservar|aufbewahren|kühl|\*)/i;

/** A label such as "Ingredients:" that says where the real list begins. */
const LABEL = /([il1]ngred[il1]ents?|ingrédients?|ingredientes|ingredienti|ingrediënten|zutaten|composition|composición|inci|المكونات|सामग्री)\s*(\([^)]{0,20}\))?\s*[:：]/gi;

const LABEL_AT_START = /^\s*_?(ingredients?|ingrédients?|ingredientes|ingredienti|ingrediënten|zutaten|composition|composición|composizione|samenstelling|zusammensetzung|inci)_?\s*[:：]\s*/i;

const ADDRESS = /\b(rue|avenue|ave\.?|boulevard|blvd\.?|street|st\.|road|rd\.|lane|plaza|platz|strasse|straße|via|calle|c\/|zone industrielle|industrial (area|estate|zone)|p\.?\s?o\.?\s?box|b\.?p\.?\s?\d|tel\.?|tél\.?|fax|phone|helpline|laboratoires?|laboratories|cedex|floor|suite|bldg|building)\b/i;

const KEEP_UPPER = new Set([
  'EDTA', 'PEG', 'PPG', 'MEA', 'DEA', 'TEA', 'BHT', 'BHA', 'CI', 'PVP', 'SD', 'NP', 'AP', 'EOP', 'EOS', 'NS', 'PCA', 'VP', 'MIPA', 'HCL', 'DNA', 'UV',
  'DMDM', 'TBHQ', 'MSG', 'INS', 'RBD', 'UHT', 'HDI', 'IPDI', 'SMDI', 'PG', 'AMP', 'II', 'III', 'IV', 'VI',
]);

const SEPARATORS = new Set([',', ';', '•', '·', '،', '、', '\n', '|']);
const OPEN: Record<string, string> = { '(': ')', '[': ']', '{': '}' };

const decode = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ');

/** For comparing a list item with the names the database recognised. */
export const normIngredient = (s: string): string =>
  s
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/\d+([.,]\d+)?\s*%/g, ' ')
    .replace(/[*_.:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

type Seg = { text: string; end: string };

function closesSoon(text: string, at: number): boolean {
  const close = OPEN[text[at]];
  let depth = 0;
  const limit = Math.min(text.length, at + 220);
  for (let i = at; i < limit; i++) {
    if (text[i] === text[at]) depth++;
    else if (text[i] === close && --depth === 0) return true;
  }
  return false;
}

/** Splits on commas and similar, but never inside brackets or between digits ("8,7%"). */
function split(text: string): Seg[] {
  const out: Seg[] = [];
  const stack: string[] = [];
  let buf = '';
  const commas = text.match(/[,;،、]/g)?.length ?? 0;
  // " - " and line breaks are separators only when the text clearly uses them as such.
  const dashList = (text.match(/\s[-–]\s/g)?.length ?? 0) >= 4 && commas < 3;
  const lineList = !dashList && commas < 3 && (text.match(/\n/g)?.length ?? 0) >= 3;
  const push = (end: string) => {
    if (buf.trim()) out.push({ text: buf.trim(), end });
    else if (out.length && (end === '.' || end === '\n')) out[out.length - 1].end = end;
    buf = '';
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    // A bracket only groups text when it is closed again soon; OCR often drops the closing one.
    if (OPEN[c] && closesSoon(text, i)) stack.push(OPEN[c]);
    else if (stack.length && c === stack[stack.length - 1]) stack.pop();
    if (stack.length === 0) {
      const prev = text[i - 1] ?? '';
      const next = text[i + 1] ?? '';
      if (c === '\n') {
        if (lineList) push('\n');
        else buf += ' ';
        continue;
      }
      if (SEPARATORS.has(c) && !(c === ',' && /\d/.test(prev) && /\d/.test(next))) {
        push(c);
        continue;
      }
      // "Ceteareth-20. Behentrimonium" — a full stop standing in for a comma.
      if (c === '.' && (/\s/.test(next) || !next) && !/\b(e\.g|i\.e|vit|no|approx|min|max|st|dr|incl|ext|var|sp)$/i.test(buf)) {
        const after = text.slice(i + 1).trimStart()[0] ?? '';
        if (!after || after === after.toUpperCase()) {
          push('.');
          continue;
        }
      }
      if (dashList && (c === '-' || c === '–') && /\s/.test(prev) && /\s/.test(next)) {
        push(c);
        continue;
      }
    }
    buf += c;
  }
  push('.');
  return out;
}

const hasLetters = (s: string) => s.length >= 2 && /\p{L}/u.test(s);
const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** Colour index ("CI 77891"), E and INS numbers are ingredients, not codes. */
const withoutAdditiveNumbers = (s: string) =>
  s
    .replace(/\bc\.?i\.?\s?\d{5}\b/gi, (m) => ' '.repeat(m.length))
    .replace(/\b(e|ins)\s?-?\d{3,4}[a-z]?\b/gi, (m) => ' '.repeat(m.length))
    .replace(/\b1[0-5]\d\d\b/g, (m) => ' '.repeat(m.length)) // bare INS numbers 1000–1599, common on Indian labels
    .replace(/\d+[.,]\d+|\d+\s?%/g, (m) => ' '.repeat(m.length)); // amounts such as 0.0001% are not codes

/** Batch codes, postcodes, phone numbers and barcodes: a letter glued to 4+ digits, 5+ digits, or digit groups. */
const CODE = /\b\p{L}{0,3}\d{5,}|\b\p{Lu}{1,3}\d{4,}|\b\d{4}\b|\d[\d\s-]{7,}\d/u;

function codeAt(s: string): number {
  return withoutAdditiveNumbers(s).search(CODE);
}
const hasCodeNumber = (s: string) => codeAt(s) >= 0;

/** Drops a batch code and whatever follows it, keeping the ingredient in front: "Parfum (F.I.L. Z123456/1)" → "Parfum". */
function stripCode(s: string): string {
  const at = codeAt(s);
  if (at < 0) return s;
  // A code in front of the first ingredient ("880018 2 - aqua"): drop the code, keep the ingredient.
  if (!/\p{L}{3,}/u.test(s.slice(0, at))) {
    const rest = s.slice(at).replace(/^[^\s]*[\s\d\-–.:)\]]*/u, '');
    return /\p{L}{3,}/u.test(rest) && codeAt(rest) < 0 ? rest : '';
  }
  let head = s.slice(0, at);
  const open = Math.max(head.lastIndexOf('('), head.lastIndexOf('['));
  if (open >= 0 && !/[)\]]/.test(head.slice(open))) head = head.slice(0, open); // the code sat inside a bracket
  return head.replace(/[\s:;,.(\[–-]+$/u, '').replace(/\s+\S{1,6}[.:]?$/u, (m) => (/^\s+(lote?|lot|batch|code|ref|no|n°|fil|f\.i\.l|f\.ll)[.:]?$/i.test(m) ? '' : m));
}

/** Not an ingredient by its shape alone. */
function junkShape(s: string): boolean {
  return !hasLetters(s) || MARKER.test(s) || ADDRESS.test(s) || hasCodeNumber(s) || wordCount(s.replace(/\([^)]*\)/g, '')) > 9;
}

function recase(items: string[]): string[] {
  const letters = items.join(' ').match(/\p{L}/gu) ?? [];
  if (letters.length < 12) return items;
  const upper = letters.filter((c) => c !== c.toLowerCase()).length / letters.length;
  if (upper > 0.7) {
    return items.map((s) =>
      s
        .replace(/[\p{L}\p{N}]+/gu, (w) => (KEEP_UPPER.has(w) || /\d/.test(w) || w.length === 1 ? w : w[0] + w.slice(1).toLowerCase()))
        // Small joining words stay lower-case: "Huile de Tournesol", "Extrait d'Avoine".
        .replace(/(?<=\S\s)(De|Du|Des|La|Le|Les|Et|Of|And|En|Au|Aux|Del|Di|Da|Do|Dos|Das|Von|Und|Mit|With|From|In|Or|Ou|Con|Y|E|À|A)(?=\s)/g, (w) => w.toLowerCase())
        .replace(/\b([DL])['’](?=\p{L})/gu, (_, c: string) => c.toLowerCase() + '’'),
    );
  }
  // Lower-case or mixed lists: just start each item with a capital.
  return items.map((s) => s.replace(/^(\P{L}*)(\p{Ll})/u, (_, pre: string, ch: string) => pre + ch.toUpperCase()));
}

const clean = (s: string) =>
  s
    .replace(/\s+/g, ' ')
    .replace(/^[\s*"'“”‘’.:;,–-]+/, '')
    .replace(/[\s"'“”‘’.:;,–-]+$/, '')
    .replace(/\*+/g, '')
    .replace(/\(\s*\)/g, '')
    .replace(/^(and|et|und|y|e)\s+/i, '')
    .trim();

/**
 * @param text  the ingredient text as stored
 * @param known normalised names the database recognised in this same text (see normIngredient)
 */
export function parseIngredients(text: string, known: ReadonlySet<string> = new Set()): IngredientList {
  let body = decode(text).replace(/\r/g, '').trim();
  if (!body) return { items: [], notes: [], additives: [] };

  // Start after an "Ingredients:" label when one is followed by a real list — unless a list already
  // came before it (two-language entries repeat the label; the first list is the one to show).
  for (const m of body.matchAll(LABEL)) {
    const at = m.index ?? 0;
    const before = body.slice(0, at);
    const after = body.slice(at + m[0].length);
    if ((before.match(/[,;،、]/g)?.length ?? 0) >= 3) break;
    if ((after.match(/[,;،、]/g)?.length ?? 0) >= 2) {
      body = after;
      break;
    }
  }
  // The same label typed without a colon at the very start: "INGREDIENTS AQUA, GLYCERIN".
  body = body.replace(/^\s*(ingredients?|ingrédients?|ingredientes|zutaten|inci)\b[\s\-–]+(?=\p{L})/iu, '');

  const isKnown = (s: string) => known.size > 0 && known.has(normIngredient(s));
  const items: string[] = [];
  const notes: string[] = [];
  const additives: string[] = [];
  let inAdditives = false;
  let smallPrint = false;
  const rescued: string[] = [];
  let note: string[] | null = null;
  const endNote = () => {
    if (note?.length) notes.push(note.join(', '));
    note = null;
  };

  for (const { text: raw, end } of split(body)) {
    // "Contains 2% or less of: salt" — the heading is not an ingredient, what follows is.
    let seg = raw.replace(/^\s*(contains?\s+)?(less than\s+)?\d+([.,]\d+)?\s?%\s+or less\s*(of)?\s*(each of)?\s*(the following)?\s*:?\s*/i, '');
    const sentenceEnds = end === '.' || end === '\n' || end === ';' || end === '•';

    // "May contain nuts, milk and soya." is one statement, not three ingredients.
    if (note) {
      const part = clean(seg);
      if (part && !MARKER.test(part)) note.push(part);
      if (sentenceEnds || MARKER.test(part)) endNote();
      continue;
    }
    if (!smallPrint && NOTE.test(clean(seg))) {
      const first = clean(seg);
      note = first.length > 3 ? [first] : [];
      if (sentenceEnds) endNote();
      continue;
    }
    // A statement run on to the last ingredient with no punctuation: "... emulsifier (472e) CONTAINS ADDED FLAVOURS".
    let runOn = '';
    const run = /\s+(contains? (added|permitted|wheat|milk|nuts?|soy|egg|gluten)|may contain|allergen|allergy advice|store in|peut contenir|traces éventuelles)\b/i.exec(seg);
    if (!smallPrint && run && run.index > 2) {
      const before = seg.slice(0, run.index);
      if ((before.match(/[([]/g)?.length ?? 0) === (before.match(/[)\]]/g)?.length ?? 0)) {
        runOn = clean(seg.slice(run.index));
        seg = before;
      }
    }

    // A label repeated inside the list ("... minerals. Composition: poulet") is not part of the name.
    seg = seg.replace(LABEL_AT_START, '');
    if (!smallPrint) {
      let at = seg.search(MARKER);
      // A street address with a postcode starts the small print as surely as "Made in" does.
      if (at < 0 && ADDRESS.test(seg) && hasCodeNumber(seg)) at = 0;
      if (at >= 0 && !isKnown(seg)) {
        smallPrint = true;
        seg = stripCode(seg.slice(0, at)); // keep what came before the marker in this item
        if (junkShape(clean(seg)) && !isKnown(seg)) continue;
      }
    } else {
      // Inside small print, only names the database recognised survive.
      if (isKnown(seg) && !NOTE.test(clean(seg))) rescued.push(clean(seg));
      continue;
    }

    // The additives section starts here: what stands before the heading is still an ingredient.
    const add = !inAdditives ? ADDITIVES.exec(seg) : null;
    if (add && !isKnown(seg)) {
      const head = clean(seg.slice(0, add.index));
      if (head && hasLetters(head) && !junkShape(head)) items.push(head);
      inAdditives = true;
      seg = seg.slice(add.index + add[0].length);
    }
    if (inAdditives) {
      let name = seg;
      for (let i = 0; i < 3 && ADDITIVE_HEADING.test(name); i++) name = name.replace(ADDITIVE_HEADING, '');
      name = clean(name.replace(/\([^()]*(\([^()]*\)[^()]*)*\)/g, ' ').replace(AMOUNT, '').replace(/\([^)]*$/, ''));
      if (name && hasLetters(name) && wordCount(name) <= 6 && !hasCodeNumber(name) && !/^(per|par|au|por|pro)?\s*\/?\s*kg$/i.test(name)) additives.push(name);
      continue;
    }

    const stripped = stripCode(seg);
    if (clean(stripped) || !isKnown(seg)) seg = stripped;
    const item = clean(seg);
    if (item && hasLetters(item) && !NOTE.test(item)) items.push(item);
    if (runOn) {
      note = [runOn];
      if (sentenceEnds) endNote();
    }
  }
  endNote();

  // What is left at the end that the database did not recognise, in a list it otherwise knows well,
  // is the start of the small print: a company name, a town, storage advice.
  const knownShare = known.size > 0 && items.length ? items.filter(isKnown).length / items.length : 0;
  const last = () => items[items.length - 1];
  while (items.length > 3 && !isKnown(last())) {
    const tail = last();
    const shaped = !hasLetters(tail) || MARKER.test(tail) || ADDRESS.test(tail) || hasCodeNumber(tail) || (smallPrint && junkShape(tail));
    // Only once small print was seen: food lists legitimately end in long names the database does not know.
    const stray = smallPrint && knownShare >= 0.6 && !looksChemical(tail);
    if (!shaped && !stray) break;
    items.pop();
  }
  items.push(...rescued);

  return { items: recase(items), notes: recase(notes), additives: recase([...new Set(additives)]) };
}

/** Shaped like an ingredient name even though the database did not recognise it (a typo, a rare extract). */
function looksChemical(s: string): boolean {
  if (wordCount(s) > 6) return false;
  return /\b(ci\s?\d{5}|e\s?\d{3,4}[a-z]?)\b/i.test(s) || /(ate|ite|ide|ol|one|ene|ane|ine|in|ium|yl|ose|ase|oil|acid|acide|extract|extrait|butter|wax|gum|water|aqua|eau|parfum|fragrance|flavou?r|ar[oô]mes?|powder|poudre|starch|amidon|syrup|sirop|juice|jus|salt|sel|sugar|sucre|flour|farine|oxide|oxyde|glycol|ether|ester|amide|amine|acetate|polymer|siloxane|icone|paraben|sulfate|sulphate|chloride|chlorure|hydroxide|vitamin\w*|protein\w*)\b/i.test(s);
}

type ParsedItem = { id?: unknown; text?: unknown; ingredients?: unknown; is_in_taxonomy?: unknown };

/** The database marks names it found in its ingredient dictionary. Older entries lack the mark, so fall back to the id. */
export function recognised(i: ParsedItem | null | undefined): boolean {
  if (!i || typeof i.id !== 'string') return false;
  if (i.is_in_taxonomy !== undefined) return Number(i.is_in_taxonomy) === 1;
  return i.id.startsWith('en:');
}

/** Collects every name the database recognised in its own parse of the list. */
export function knownFromParse(ingredients: unknown): Set<string> {
  const out = new Set<string>();
  const walk = (list: unknown) => {
    if (!Array.isArray(list)) return;
    for (const i of list as ParsedItem[]) {
      if (recognised(i) && typeof i.text === 'string') out.add(normIngredient(i.text));
      walk(i?.ingredients);
    }
  };
  walk(ingredients);
  return out;
}
