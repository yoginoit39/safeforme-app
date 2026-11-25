import type { Profile, ProductData, Verdict } from '../types';

/**
 * Safety verdict engine. Pure, deterministic, no network, no AI.
 *
 * Guiding rule: never say SAFE on missing data. False alarms are acceptable,
 * false reassurance is not.
 */

/** A set of search terms plus phrases that look like a hit but are not. */
export type TermGroup = { terms: string[]; except?: string[] };

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
  {
    id: 'celery',
    label: 'celery',
    tags: ['celery'],
    terms: ['celery', 'celeriac', 'céleri', 'sellerie', 'apio', 'sedano'],
  },
  {
    id: 'mustard',
    label: 'mustard',
    tags: ['mustard'],
    terms: ['mustard', 'moutarde', 'senf', 'mostaza', 'senape'],
  },
  {
    id: 'lupin',
    label: 'lupin',
    tags: ['lupin'],
    terms: ['lupin', 'lupine', 'lupini', 'altramuz'],
  },
  {
    id: 'sulphites',
    label: 'sulphites',
    tags: ['sulphur-dioxide-and-sulphites', 'sulphites', 'sulfites'],
    terms: ['sulphite', 'sulfite', 'sulphur dioxide', 'sulfur dioxide', 'metabisulphite', 'metabisulfite', 'bisulphite', 'bisulfite', 'e220', 'e221', 'e222', 'e223', 'e224', 'e226', 'e227', 'e228', 'anhydride sulfureux', 'schwefeldioxid'],
  },
];

const allergenById = (id: string) => ALLERGENS.find((a) => a.id === id);

export const PORK: TermGroup = {
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

export const MEAT: TermGroup = {
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

export const CAFFEINE: TermGroup = {
  terms: ['caffeine', 'coffee', 'espresso', 'guarana', 'matcha', 'black tea', 'green tea', 'yerba mate', 'kola nut', 'cola nut', 'caféine', 'café', 'koffein', 'kaffee', 'cafeína', 'caffeina', 'caffè'],
  except: ['caffeine-free', 'caffeine free', 'decaffeinated', 'sans caféine', 'koffeinfrei'],
};

/** Ingredient families people commonly choose to avoid. Shared with the score and the "why" summary. */
export const ADDED_SUGAR: TermGroup = {
  terms: [
    'sugar', 'glucose syrup', 'glucose-fructose syrup', 'fructose syrup', 'corn syrup', 'high fructose corn syrup', 'invert sugar', 'dextrose', 'fructose', 'sucrose', 'cane sugar', 'brown sugar', 'caramelised sugar', 'golden syrup', 'molasses', 'agave syrup', 'maple syrup', 'honey', 'glucose',
    'sucre', 'sirop de glucose', 'sirop de glucose-fructose', 'zucker', 'glukosesirup', 'azúcar', 'jarabe de glucosa', 'zucchero', 'sciroppo di glucosio',
  ],
  except: ['no added sugar', 'sugar-free', 'sugar free', 'sans sucre', 'sans sucres ajoutés', 'zuckerfrei', 'sin azúcar', 'senza zucchero', 'sugar alcohol'],
};
export const SWEETENERS: TermGroup = {
  terms: [
    'aspartame', 'sucralose', 'acesulfame', 'acesulfame k', 'acesulfame potassium', 'saccharin', 'cyclamate', 'steviol glycosides', 'stevia', 'sorbitol', 'maltitol', 'xylitol', 'erythritol', 'isomalt', 'neotame', 'advantame', 'sweetener', 'édulcorant', 'süßungsmittel', 'edulcorante', 'dolcificante',
    'e950', 'e951', 'e952', 'e954', 'e955', 'e960', 'e961', 'e962', 'e965', 'e967', 'e968', 'e420',
  ],
};
export const PALM_OIL: TermGroup = {
  terms: ['palm oil', 'palm fat', 'palm kernel oil', 'palm kernel fat', 'palm olein', 'palm stearin', 'palm', 'huile de palme', 'graisse de palme', 'palmöl', 'palmfett', 'aceite de palma', 'olio di palma'],
  except: ['palm oil free', 'palm-oil-free', 'sans huile de palme', 'no palm oil', 'heart of palm', 'hearts of palm', 'palm sugar'],
};
export const HYDROGENATED: TermGroup = {
  terms: ['partially hydrogenated', 'hydrogenated', 'partiellement hydrogénée', 'hydrogénée', 'gehärtet', 'hidrogenado', 'hidrogenada', 'idrogenato'],
  except: ['non-hydrogenated', 'non hydrogenated', 'non hydrogénée'],
};
/** Words that mark industrial formulation: the basis for calling something an additive or ultra-processed. */
export const ADDITIVE_WORDS: TermGroup = {
  terms: [
    'flavouring', 'flavoring', 'flavour', 'flavor', 'aroma', 'arôme', 'emulsifier', 'émulsifiant', 'emulgator', 'colour', 'color', 'colorant', 'farbstoff', 'preservative', 'conservateur', 'konservierungsstoff', 'stabiliser', 'stabilizer', 'stabilisant', 'thickener', 'épaississant', 'modified starch', 'amidon modifié', 'maltodextrin', 'maltodextrine', 'flavour enhancer', 'flavor enhancer', 'exhausteur de goût', 'monosodium glutamate', 'protein isolate', 'acidity regulator', 'antioxidant', 'glazing agent', 'anti-caking agent', 'humectant', 'gelling agent',
  ],
  except: ['natural flavouring', 'natural flavoring', 'natural flavourings', 'natural flavorings', 'arôme naturel', 'no artificial colours', 'no artificial colors', 'no preservatives', 'sans conservateur', 'sans colorant'],
};
export const OATS: TermGroup = { terms: ['oat', 'oatmeal', 'avoine', 'hafer', 'avena'] };

/** Distinct E-numbers named in an ingredient list, e.g. ["e150d", "e330"]. */
export function eNumbers(text: string): string[] {
  return [...new Set([...text.matchAll(/(?:^|[^a-z0-9])e[\s-]?(\d{3}[a-z]?)(?![a-z0-9])/gi)].map((m) => `e${m[1].toLowerCase()}`))];
}

const AVOID: { id: string; label: string; group: TermGroup }[] = [
  { id: 'no-palm-oil', label: 'palm oil', group: PALM_OIL },
  { id: 'no-sweeteners', label: 'sweeteners', group: SWEETENERS },
  { id: 'no-added-sugar', label: 'added sugar', group: ADDED_SUGAR },
  { id: 'no-caffeine', label: 'caffeine', group: CAFFEINE },
];

/** Which of the user's "prefer to avoid" items this product contains. */
export function avoidHits(product: ProductData, profile: Profile): { id: string; label: string; found: string }[] {
  const { main } = splitTraces((product.ingredientsText ?? '').toLowerCase());
  const hits: { id: string; label: string; found: string }[] = [];
  for (const a of AVOID) {
    if (!profile.watch.includes(a.id)) continue;
    const found = findTerm(main, a.group) ?? (a.id === 'no-caffeine' && (product.nutriments?.caffeine ?? 0) > 0 ? 'caffeine' : null);
    if (found) hits.push({ id: a.id, label: a.label, found });
  }
  if (profile.watch.includes('no-additives')) {
    const es = eNumbers(main);
    const word = findTerm(main, ADDITIVE_WORDS);
    if (es.length || word) hits.push({ id: 'no-additives', label: 'additives', found: es.length ? es.slice(0, 3).join(', ').toUpperCase() : word! });
  }
  return hits;
}

const RULE_LABEL: Record<string, string> = {
  celiac: 'coeliac',
  lactose: 'lactose',
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

  if (rules.has('lactose')) {
    const milk = allergenById('milk')!;
    const labelled = product.labels.some((l) => /lactose-free|no-lactose|sans-lactose|laktosefrei/.test(l));
    const hit = hasTag(product.allergens, milk) ? 'milk' : findTerm(main, milk);
    if (hit && !labelled) notSafe.push(`Contains ${hit} — a source of lactose.`);
    else if (!hit && !hasText) unverifiable.push('lactose');
  }

  if (rules.has('celiac')) {
    const gluten = allergenById('gluten')!;
    const labelled = product.labels.some((l) => /no-gluten|gluten-free|sans-gluten|glutenfrei/.test(l));
    const inMain = hasTag(product.allergens, gluten) ? 'gluten' : findTerm(main, gluten);
    if (inMain) {
      notSafe.push(`Contains ${inMain === 'gluten' ? 'gluten' : `gluten ("${inMain}")`} — not suitable for coeliac disease.`);
    } else if (hasTag(product.traces, gluten) || findTerm(traceText, gluten)) {
      notSafe.push('May contain traces of gluten — not suitable for coeliac disease.');
    } else if (!labelled) {
      const oats = findTerm(main, OATS);
      if (oats) unknown.push('Contains oats, which are often contaminated with gluten, and no gluten-free label was found in the data.');
      else if (!hasText) unverifiable.push('celiac');
    }
  }

  // "Prefer to avoid" items never make a product unsafe; they are flagged as warnings.
  for (const hit of avoidHits(product, profile)) {
    warnings.push(`Contains ${hit.label}${hit.found !== hit.label ? ` (${hit.found})` : ''} — on your avoid list.`);
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

  // 4b. Allergy guard. A wrong "safe" is the one mistake this app must not make, and the data is
  // typed in by volunteers from a pack that may since have changed. So for anyone with an allergy,
  // a clean result is only given when the list could really be checked, and it never says "safe".
  const needs = allergyNeeds(profile);
  if (needs.length && hasText && !notSafe.length && !unknown.length && product.source !== 'demo') {
    const langs = product.ingredientLangs;
    if (langs?.length && !langs.some((l) => CHECKED_LANGS.has(l))) {
      unknown.push(`The ingredient list is only available in ${langName(langs[0])}, which Greenlit can't check reliably for ${listOf(needs)}. Read the pack.`);
    } else if (product.unknownShare !== undefined && product.unknownShare > 0.6) {
      unknown.push(`The database's ingredient list for this product is garbled or incomplete, so ${listOf(needs)} can't be ruled out. Read the pack.`);
    } else if (product.dataDate && Date.now() - product.dataDate > 5 * YEAR) {
      unknown.push(`This entry was last refreshed in ${new Date(product.dataDate).getFullYear()}. Recipes change, so ${listOf(needs)} can't be ruled out. Read the pack.`);
    }
  }
  if (needs.length && hasText && !notSafe.length && !unknown.length) {
    const when = product.dataDate ? `, last refreshed ${monthYear(product.dataDate)}` : '';
    warnings.unshift(
      fromPhoto
        ? 'Read from your photo by AI, which can misread small print. Check the words on the pack yourself.'
        : `From a volunteer database${when}, not from the pack in your hand. Makers change recipes: read the pack every time.`,
    );
  }

  // 5. Result.
  if (notSafe.length) return { level: 'not-safe', reasons: [...notSafe, ...unknown], warnings };
  if (unknown.length) return { level: 'unknown', reasons: unknown, warnings };
  // Nothing unsafe. But "safe" would be the wrong word for a sugary drink and a diabetic,
  // or for a product with something the user chose to avoid.
  const concerns = [...healthConcerns(product, profile), ...customAvoidHits(product, profile)];
  const avoid = warnings.filter((w) => w.endsWith('on your avoid list.'));
  if (concerns.length || avoid.length) {
    return { level: 'caution', reasons: [...concerns, ...avoid], warnings: warnings.filter((w) => !avoid.includes(w)) };
  }
  if (needs.length && hasText) {
    return { level: 'safe', reasons: [`${capital(listOf(needs))} ${needs.length > 1 || /s$/.test(needs[0]) ? 'are' : 'is'} not in the ingredient list or the allergen tags${fromPhoto ? ' read from your photo' : ''}.`], warnings };
  }
  return { level: 'safe', reasons: ['No problems found for your profile.'], warnings };
}

const YEAR = 365 * 24 * 60 * 60 * 1000;
/** Languages the allergen word lists cover. Anything else can't be called clean. */
const CHECKED_LANGS = new Set(['en', 'fr', 'de', 'es', 'it']);
const LANG_NAMES: Record<string, string> = { pl: 'Polish', ar: 'Arabic', hi: 'Hindi', nl: 'Dutch', pt: 'Portuguese', ru: 'Russian', tr: 'Turkish', zh: 'Chinese', ja: 'Japanese', ko: 'Korean', sv: 'Swedish', da: 'Danish', fi: 'Finnish', cs: 'Czech', el: 'Greek', hu: 'Hungarian', ro: 'Romanian', th: 'Thai', id: 'Indonesian', he: 'Hebrew', uk: 'Ukrainian', bg: 'Bulgarian', nb: 'Norwegian' };
const langName = (code: string) => LANG_NAMES[code] ?? 'a language';
const monthYear = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const listOf = (items: string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The things in a profile where a wrong "safe" could cause a reaction. */
export function allergyNeeds(profile: Profile): string[] {
  const out = profile.allergies.map((id) => ALLERGENS.find((a) => a.id === id)?.label ?? id);
  if (profile.rules.includes('celiac') && !profile.allergies.includes('gluten')) out.push('gluten');
  if (profile.rules.includes('lactose') && !profile.allergies.includes('milk')) out.push('lactose');
  return out;
}

const amount = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(n < 1 ? 2 : 1).replace(/\.?0+$/, ''));

/**
 * Health needs in the profile (diabetes, low salt, cholesterol, low carb) checked against the
 * nutrition per 100g. Same thresholds as the personal score, so the two never disagree.
 */
export function healthConcerns(product: ProductData, profile: Profile): string[] {
  const n = product.nutriments ?? {};
  const watch = new Set(profile.watch);
  const out: string[] = [];
  if ((watch.has('diabetes') || watch.has('low-sugar')) && n.sugars !== undefined && n.sugars > 5) {
    const spoons = Math.round((n.sugars / 4) * 2) / 2;
    out.push(`${n.sugars > 15 ? 'Very high' : 'High'} in sugar for ${watch.has('diabetes') ? 'diabetes' : 'your low-sugar goal'} — ${amount(n.sugars)}g per 100g, about ${amount(spoons)} teaspoon${spoons === 1 ? '' : 's'}.`);
  }
  if (watch.has('low-salt') && n.salt !== undefined && n.salt > 0.6) {
    out.push(`${n.salt > 1.5 ? 'Very salty' : 'Salty'} for a low-salt diet — ${amount(n.salt)}g salt per 100g.`);
  }
  if (watch.has('cholesterol') && n.saturatedFat !== undefined && n.saturatedFat > 5) {
    out.push(`${n.saturatedFat > 10 ? 'Very high' : 'High'} in saturated fat for your cholesterol — ${amount(n.saturatedFat)}g per 100g.`);
  }
  if (watch.has('low-carb') && n.carbs !== undefined && n.carbs > 20) {
    out.push(`${n.carbs > 50 ? 'Very high' : 'High'} in carbs for a low-carb diet — ${amount(n.carbs)}g per 100g.`);
  }
  return out;
}

/** Ingredients the user typed into their own avoid list. */
export function customAvoidHits(product: ProductData, profile: Profile): string[] {
  const text = (product.ingredientsText ?? '').toLowerCase();
  if (!text) return [];
  return (profile.avoidCustom ?? [])
    .filter((term) => term.length >= 2 && findTerm(text, { terms: [term] }))
    .map((term) => `Contains ${term} — you chose to avoid it.`);
}
