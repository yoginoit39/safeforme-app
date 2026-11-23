import type { Profile, ProductData, Verdict } from '../types';

/**
 * Safety verdict engine. Pure, deterministic, no network, no AI.
 *
 * Guiding rule: never say SAFE on missing data. False alarms are acceptable,
 * false reassurance is not.
 */

/** A set of search terms plus phrases that look like a hit but are not. */
type TermGroup = { terms: string[]; except?: string[] };

type AllergenDef = TermGroup & {
  id: string;
  label: string;
  /** Open Food Facts allergen tags (prefix stripped) that mean this allergen. */
  tags: string[];
};

export const ALLERGENS: AllergenDef[] = [
  {
    id: 'peanuts',
    label: 'peanuts',
    tags: ['peanuts', 'peanut'],
    terms: ['peanut', 'groundnut', 'arachis', 'arachide', 'cacahuète', 'cacahuete', 'erdnuss', 'erdnüsse', 'maní'],
    except: ['peanut-free', 'peanut free'],
  },
  {
    id: 'tree-nuts',
    label: 'tree nuts',
    tags: ['nuts', 'tree-nuts', 'nut'],
    terms: [
      'nut', 'almond', 'hazelnut', 'walnut', 'cashew', 'pistachio', 'pecan', 'macadamia', 'praline', 'marzipan',
      'noisette', 'amande', 'noix', 'haselnuss', 'haselnüsse', 'mandel', 'mandeln', 'walnuss', 'avellana', 'almendra', 'nuez', 'nocciola', 'nocciole', 'mandorla', 'mandorle',
    ],
    except: ['nut-free', 'nut free', 'noix de coco', 'noix de muscade', 'nuez moscada'],
  },
  {
    id: 'milk',
    label: 'milk',
    tags: ['milk'],
    terms: [
      'milk', 'milkfat', 'buttermilk', 'whey', 'casein', 'caseinate', 'lactose', 'butter', 'butterfat', 'cheese', 'cream', 'yogurt', 'yoghurt', 'ghee',
      'lait', 'lactosérum', 'lactoserum', 'beurre', 'crème', 'fromage', 'milch', 'molke', 'sahne', 'käse', 'leche', 'mantequilla', 'queso', 'nata', 'latte', 'burro', 'formaggio', 'panna',
    ],
    except: [
      'cocoa butter', 'cacao butter', 'shea butter', 'peanut butter', 'almond butter', 'cashew butter', 'hazelnut butter', 'nut butter',
      'coconut milk', 'almond milk', 'oat milk', 'soy milk', 'soya milk', 'rice milk', 'coconut cream', 'cream of tartar',
      'lactose-free', 'lactose free', 'milk-free', 'milk free', 'dairy-free', 'dairy free', 'sans lactose', 'sans lait',
      'beurre de cacao', 'lait de coco', 'burro di cacao', 'latte di cocco', 'manteca de cacao', 'leche de coco', 'kakaobutter',
    ],
  },
  {
    id: 'egg',
    label: 'egg',
    tags: ['eggs', 'egg'],
    terms: ['egg', 'albumen', 'albumin', 'ovalbumin', 'oeuf', 'œuf', 'huevo', 'uovo', 'uova', 'eier', 'eigelb', 'eiweiß', 'vollei'],
    except: ['egg-free', 'egg free'],
  },
  {
    id: 'soy',
    label: 'soy',
    tags: ['soybeans', 'soy', 'soya', 'soybean'],
    terms: ['soy', 'soya', 'soybean', 'soja', 'soia', 'tofu', 'edamame', 'tempeh', 'miso'],
    except: ['soy-free', 'soy free', 'soya-free', 'soya free', 'sans soja'],
  },
  {
    id: 'gluten',
    label: 'wheat/gluten',
    tags: ['gluten', 'wheat'],
    terms: [
      'wheat', 'barley', 'rye', 'malt', 'gluten', 'spelt', 'semolina', 'durum', 'farro', 'kamut', 'couscous', 'seitan', 'triticale',
      'blé', 'froment', 'orge', 'seigle', 'épeautre', 'weizen', 'gerste', 'roggen', 'dinkel', 'trigo', 'cebada', 'centeno', 'frumento', 'grano', 'orzo', 'segale',
    ],
    except: ['gluten-free', 'gluten free', 'sans gluten', 'glutenfrei', 'sin gluten', 'senza glutine', 'no gluten'],
  },
  {
    id: 'fish',
    label: 'fish',
    tags: ['fish'],
    terms: [
      'fish', 'anchovy', 'anchovies', 'tuna', 'salmon', 'cod', 'haddock', 'sardine', 'mackerel', 'trout', 'herring', 'tilapia', 'pollock',
      'poisson', 'thon', 'saumon', 'anchois', 'fisch', 'lachs', 'thunfisch', 'pescado', 'atún', 'pesce', 'tonno', 'acciughe',
    ],
    except: ['fish-free', 'fish free'],
  },
  {
    id: 'shellfish',
    label: 'shellfish',
    tags: ['crustaceans', 'molluscs', 'shellfish', 'crustacean', 'mollusc'],
    terms: [
      'shellfish', 'shrimp', 'prawn', 'crab', 'lobster', 'crayfish', 'langoustine', 'crustacean', 'mollusc', 'mollusk', 'oyster', 'mussel', 'clam', 'scallop', 'squid', 'octopus',
      'crevette', 'crustacé', 'mollusque', 'krebstier', 'garnele', 'gamba', 'marisco', 'crostacei', 'gamberi',
    ],
  },
  {
    id: 'sesame',
    label: 'sesame',
    tags: ['sesame-seeds', 'sesame', 'sesame-seed'],
    terms: ['sesame', 'tahini', 'sésame', 'sesam', 'sésamo', 'sesamo'],
    except: ['sesame-free', 'sesame free'],
  },
];

const allergenById = (id: string) => ALLERGENS.find((a) => a.id === id);

const PORK: TermGroup = {
  terms: ['pork', 'bacon', 'ham', 'lard', 'pig', 'swine', 'porcine', 'prosciutto', 'pancetta', 'porc', 'jambon', 'saindoux', 'schwein', 'schweinefleisch', 'speck', 'cerdo', 'jamón', 'maiale'],
};

const ALCOHOL: TermGroup = {
  terms: [
    'alcohol', 'ethanol', 'wine', 'beer', 'rum', 'brandy', 'whisky', 'whiskey', 'vodka', 'liqueur', 'liquor', 'sake', 'mirin', 'kirsch', 'bourbon', 'cognac', 'sherry', 'champagne', 'gin', 'tequila', 'marsala',
    'alcool', 'vin', 'bière', 'rhum', 'wein', 'bier', 'alkohol', 'vino', 'cerveza', 'birra',
  ],
  except: [
    'alcohol-free', 'alcohol free', 'non-alcoholic', 'non alcoholic', 'sans alcool', 'alkoholfrei', 'sugar alcohol',
    'wine vinegar', 'vinaigre de vin', 'root beer', 'ginger beer',
  ],
};

const GELATIN: TermGroup = { terms: ['gelatin', 'gelatine', 'gélatine', 'gelatina'] };
/** Fish gelatin is acceptable for halal/kosher purposes, so it is not "unknown source". */
const GELATIN_UNKNOWN_SOURCE: TermGroup = {
  ...GELATIN,
  except: ['fish gelatine', 'fish gelatin', 'gélatine de poisson'],
};

const MEAT: TermGroup = {
  terms: [
    'meat', 'beef', 'chicken', 'turkey', 'lamb', 'mutton', 'veal', 'duck', 'goose', 'poultry', 'venison', 'sausage', 'salami', 'tallow', 'suet', 'liver',
    'viande', 'boeuf', 'bœuf', 'poulet', 'dinde', 'agneau', 'fleisch', 'rindfleisch', 'hähnchen', 'huhn', 'carne', 'pollo', 'manzo',
  ],
  except: ['meat-free', 'meat free'],
};

const OTHER_ANIMAL: TermGroup = {
  terms: ['honey', 'beeswax', 'bees wax', 'e901', 'carmine', 'cochineal', 'e120', 'shellac', 'e904', 'isinglass', 'collagen', 'rennet', 'lanolin', 'miel', 'honig', 'miele', "cire d'abeille", "cera d'api", 'bienenwachs'],
};

const INSECT_OR_FINING: TermGroup = { terms: ['carmine', 'cochineal', 'e120', 'isinglass', 'collagen'] };

const CAFFEINE: TermGroup = {
  terms: ['caffeine', 'coffee', 'espresso', 'guarana', 'matcha', 'black tea', 'green tea', 'yerba mate', 'kola nut', 'cola nut', 'caféine', 'café', 'koffein', 'kaffee', 'cafeína', 'caffeina', 'caffè'],
  except: ['caffeine-free', 'caffeine free', 'decaffeinated', 'sans caféine', 'koffeinfrei'],
};

const RULE_LABEL: Record<string, string> = {
  halal: 'halal',
  kosher: 'kosher',
  vegan: 'vegan',
  vegetarian: 'vegetarian',
  pregnancy: 'pregnancy',
};

// ---------- text matching ----------

const rxCache = new Map<string, RegExp>();
const escapeRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whole-word match (letters/digits on either side block a match), simple plurals allowed. */
function termRegex(terms: string[]): RegExp {
  const key = terms.join('|');
  let rx = rxCache.get(key);
  if (!rx) {
    const alt = [...terms].sort((a, b) => b.length - a.length).map(escapeRx).join('|');
    rx = new RegExp(`(?:^|[^\\p{L}\\p{N}])(${alt})(?:e?s)?(?=$|[^\\p{L}\\p{N}])`, 'iu');
    rxCache.set(key, rx);
  }
  return rx;
}

/** Returns the matched term, or null. `text` must already be lowercased. */
export function findTerm(text: string, group: TermGroup): string | null {
  if (!text) return null;
  let t = text;
  for (const phrase of group.except ?? []) {
    if (t.includes(phrase)) t = t.split(phrase).join(' ');
  }
  const m = termRegex(group.terms).exec(t);
  return m ? m[1] : null;
}

const TRACE_RX =
  /(may contain|traces? of|peut contenir|traces? éventuelles?|traces? possibles?|kann spuren|puede contener|può contenere|produced in a (?:facility|factory)|made in a (?:facility|factory))[^.]*/giu;

/** Splits "may contain…" sentences away from the real ingredient list. */
export function splitTraces(text: string): { main: string; traces: string } {
  const traces = (text.match(TRACE_RX) ?? []).join(' ; ');
  const main = text.replace(TRACE_RX, ' ');
  return { main, traces };
}

/** Maps a free-form allergen name (e.g. from a label photo) to an Open Food Facts style tag. */
export function normalizeAllergenName(raw: string): string {
  const s = raw.toLowerCase().trim().replace(/^[a-z]{2}:/, '');
  for (const def of ALLERGENS) {
    if (def.tags.includes(s) || findTerm(s, def)) return def.tags[0];
  }
  return s.replace(/\s+/g, '-');
}

const hasTag = (tags: string[], def: AllergenDef) => tags.some((t) => def.tags.includes(t));

// ---------- the engine ----------

export function computeVerdict(product: ProductData, profile: Profile): Verdict {
  const notSafe: string[] = [];
  const unknown: string[] = [];
  const warnings: string[] = [];

  let fullText = (product.ingredientsText ?? '').toLowerCase().trim();
  const flags = product.photoFlags ?? {};
  // Photo flags are folded into the searchable text so one code path handles both sources.
  if (flags.containsPork) fullText += ' , pork';
  if (flags.containsAlcohol) fullText += ' , alcohol';
  if (flags.containsGelatin) fullText += ' , gelatin';

  const hasText = fullText.length > 0;
  const { main, traces: traceText } = splitTraces(fullText);
  const fromPhoto = product.source === 'photo';

  // 1 + 2. Allergens: tags first, then the ingredient text.
  for (const id of profile.allergies) {
    const def = allergenById(id);
    if (!def) continue;
    if (hasTag(product.allergens, def)) {
      notSafe.push(`Contains ${def.label}.`);
      continue;
    }
    const inMain = findTerm(main, def);
    if (inMain) {
      notSafe.push(`Contains ${def.label} — "${inMain}" is in the ingredients.`);
      continue;
    }
    if (hasTag(product.traces, def) || findTerm(traceText, def)) {
      notSafe.push(`May contain traces of ${def.label}.`);
    }
  }

  // 3. Rules.
  const rules = new Set(profile.rules);
  const unverifiable: string[] = []; // rules we cannot check because there is no ingredient list

  const animalHits = (groups: TermGroup[], tagIds: string[]): string[] => {
    const found = new Set<string>();
    for (const id of tagIds) {
      const def = allergenById(id)!;
      if (hasTag(product.allergens, def)) found.add(def.label);
    }
    for (const g of groups) {
      const hit = findTerm(main, g);
      if (hit) found.add(hit);
    }
    return [...found];
  };

  if (rules.has('vegan')) {
    const hits = animalHits(
      [allergenById('milk')!, allergenById('egg')!, MEAT, PORK, allergenById('fish')!, allergenById('shellfish')!, GELATIN, OTHER_ANIMAL],
      ['milk', 'egg', 'fish', 'shellfish'],
    );
    if (hits.length) notSafe.push(`Contains ${hits.join(', ')} — not vegan.`);
    else if (!hasText) unverifiable.push('vegan');
  }

  if (rules.has('vegetarian')) {
    const hits = animalHits(
      [MEAT, PORK, allergenById('fish')!, allergenById('shellfish')!, GELATIN, INSECT_OR_FINING],
      ['fish', 'shellfish'],
    );
    if (hits.length) notSafe.push(`Contains ${hits.join(', ')} — not vegetarian.`);
    else if (!hasText) unverifiable.push('vegetarian');
  }

  for (const rule of ['halal', 'kosher'] as const) {
    if (!rules.has(rule)) continue;
    const certified =
      product.labels.some((l) => l.includes(rule)) ||
      (rule === 'halal' ? flags.halalCertified === true : flags.kosherCertified === true);

    const forbidden: string[] = [];
    const pork = findTerm(main, PORK);
    if (pork) forbidden.push(pork === 'pork' ? 'pork' : `pork (“${pork}”)`); // say it in plain English even when the label isn't
    if (rule === 'halal') {
      const alcohol = findTerm(main, ALCOHOL);
      if (alcohol) forbidden.push(alcohol);
    } else {
      const shellfishDef = allergenById('shellfish')!;
      const shellfish = hasTag(product.allergens, shellfishDef) ? 'shellfish' : findTerm(main, shellfishDef);
      if (shellfish) forbidden.push(shellfish);
    }

    if (forbidden.length) {
      notSafe.push(`Contains ${forbidden.join(', ')} — not ${rule}.`);
    } else if (certified) {
      // Certified and nothing forbidden found: this rule raises no doubt.
    } else if (!hasText) {
      unverifiable.push(rule);
    } else {
      const doubtful = findTerm(main, GELATIN_UNKNOWN_SOURCE) ?? findTerm(main, MEAT);
      if (doubtful) {
        unknown.push(`Contains ${doubtful} of unknown source, and no ${rule} certification was found in the data.`);
      } else {
        const checked = rule === 'halal' ? 'pork or alcohol' : 'pork or shellfish';
        unknown.push(
          `No ${rule} certification found in the data. No ${checked} was found in the ingredients, but that is not proof.`,
        );
      }
    }
  }

  if (rules.has('pregnancy')) {
    const alcohol = findTerm(main, ALCOHOL);
    if (alcohol) notSafe.push(`Contains alcohol (${alcohol}) — avoid while pregnant.`);
    else if (!hasText) unverifiable.push('pregnancy');
    const caffeine = (product.nutriments?.caffeine ?? 0) > 0 || findTerm(main, CAFFEINE);
    if (caffeine) warnings.push('Contains caffeine — limit while pregnant.');
  }

  // 4. Missing data — never SAFE.
  const noData = !hasText && product.allergens.length === 0;
  if (noData) {
    unknown.push(
      fromPhoto
        ? "The ingredients couldn't be read from the photo. Retake it closer and in good light, or check the physical label."
        : "This product's ingredients aren't in the database. Check the physical label, or scan the label photo.",
    );
  } else if (!hasText) {
    if (unverifiable.length) {
      const names = unverifiable.map((r) => RULE_LABEL[r]).join(', ');
      unknown.push(`The ingredient list is missing, so your ${names} rule${unverifiable.length > 1 ? 's' : ''} can't be checked.`);
    }
    if (profile.allergies.length) {
      warnings.push("The ingredient list is missing — only the database's allergen tags were checked.");
    }
  }

  // 5. Result.
  if (notSafe.length) return { level: 'not-safe', reasons: [...notSafe, ...unknown], warnings };
  if (unknown.length) return { level: 'unknown', reasons: unknown, warnings };
  return { level: 'safe', reasons: ['No problems found for your profile.'], warnings };
}
