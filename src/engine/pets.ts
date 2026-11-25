import type { ProductData, Verdict } from '../types';
import { findTerm, type TermGroup } from './verdict';

/**
 * Pet check. Pure, deterministic, no network, no AI.
 * Looks for ingredients that animal-poison authorities list as toxic to dogs or cats.
 * It never says a human food is "safe" for a pet: only that no known toxin was found.
 */

export type Species = 'dog' | 'cat';

type Toxin = TermGroup & { name: string; why: string; species?: Species };

const SOURCE = 'ASPCA Animal Poison Control';

export const PET_TOXINS: Toxin[] = [
  {
    name: 'chocolate / cocoa',
    terms: ['chocolate', 'cocoa', 'cacao', 'chocolat', 'schokolade', 'kakao', 'cioccolato'],
    except: ['cocoa butter', 'cacao butter', 'beurre de cacao', 'kakaobutter'],
    why: 'contains theobromine, which dogs and cats cannot break down',
  },
  { name: 'xylitol', terms: ['xylitol', 'birch sugar', 'e967', 'e 967', 'xylit'], why: 'causes a dangerous drop in blood sugar and liver failure' },
  {
    name: 'grapes / raisins',
    terms: ['grape', 'raisin', 'sultana', 'currant', 'rosinen', 'uva passa'],
    except: ['grapeseed', 'grape seed', 'grapefruit', 'raisin sec'],
    why: 'can cause sudden kidney failure',
  },
  { name: 'onion', terms: ['onion', 'oignon', 'zwiebel', 'cebolla', 'cipolla', 'shallot', 'leek', 'chive'], why: 'damages red blood cells' },
  { name: 'garlic', terms: ['garlic', 'ail', 'knoblauch', 'ajo', 'aglio'], why: 'damages red blood cells' },
  { name: 'macadamia nuts', terms: ['macadamia'], why: 'causes weakness, tremors and vomiting in dogs', species: 'dog' },
  {
    name: 'alcohol',
    terms: ['alcohol', 'ethanol', 'wine', 'beer', 'rum', 'whisky', 'whiskey', 'vodka', 'brandy', 'liqueur', 'alcool', 'vin', 'bière'],
    except: ['alcohol-free', 'alcohol free', 'sans alcool', 'sugar alcohol', 'wine vinegar', 'vinaigre de vin'],
    why: 'is poisonous to pets even in small amounts',
  },
  { name: 'caffeine', terms: ['caffeine', 'coffee', 'guarana', 'café', 'kaffee', 'koffein', 'caféine'], except: ['caffeine-free', 'caffeine free', 'decaffeinated'], why: 'overstimulates the heart and nervous system' },
  { name: 'propylene glycol', terms: ['propylene glycol', 'e1520', 'e 1520'], why: 'damages red blood cells in cats; not allowed in cat food in the US', species: 'cat' },
];

const SPECIES_LABEL: Record<Species, string> = { dog: 'dogs', cat: 'cats' };

/** Which animal a pet food is made for, when the database says so. */
export function petFoodSpecies(product: ProductData): Species | null {
  // Real pet food carries the umbrella tag 'dog-and-cat-food' alongside 'dog-food' or 'cat-food'; ignore the umbrella.
  const tags = (product.categories ?? []).filter((c) => !/dogs?-and-cats?|cats?-and-dogs?/.test(c));
  const hay = [...tags, product.name.toLowerCase()].join(' ');
  const dog = /\b(dog|dogs|chien|chiens|hund|perro|puppy)\b/.test(hay);
  const cat = /\b(cat|cats|chat|chats|katze|gato|gatto|kitten)\b/.test(hay);
  if (dog === cat) return null;
  return dog ? 'dog' : 'cat';
}

export function computePetVerdict(product: ProductData, species: Species): Verdict {
  const text = (product.ingredientsText ?? '').toLowerCase().trim();
  const who = SPECIES_LABEL[species];
  const isPetFood = product.kind === 'petfood';

  if (product.kind === 'beauty') {
    return { level: 'unknown', reasons: [`Cosmetics aren't checked for ${who}. Keep them out of reach.`], warnings: [] };
  }

  const madeFor = isPetFood ? petFoodSpecies(product) : null;
  if (madeFor && madeFor !== species) {
    return {
      level: 'not-safe',
      reasons: [`This food is made for ${SPECIES_LABEL[madeFor]}, not ${who}. ${species === 'cat' ? 'Dog food lacks nutrients cats need, such as taurine.' : 'Cat food is too rich for dogs as a regular meal.'}`],
      warnings: [],
    };
  }

  if (!text) {
    return {
      level: 'unknown',
      reasons: [`The ingredients aren't in the database, so this can't be checked for ${who}. Check the physical label, or photograph it.`],
      warnings: [],
    };
  }

  const hits = PET_TOXINS.filter((t) => (!t.species || t.species === species) && findTerm(text, t));
  if (hits.length) {
    return {
      level: 'not-safe',
      reasons: hits.map((t) => `Contains ${t.name} — ${t.why}. Toxic to ${who} (${SOURCE}).`),
      warnings: [],
    };
  }

  if (isPetFood) {
    return { level: 'safe', reasons: [`No ingredients known to be toxic to ${who} were found.`], warnings: [] };
  }
  // Human food: the absence of a known toxin is not the same as "good for a pet".
  return {
    level: 'unknown',
    reasons: [`No ingredients known to be toxic to ${who} were found — but this is human food, not made for pets. Salt, fat and sugar can still harm them. Ask your vet before sharing.`],
    warnings: [],
  };
}
