export type Profile = {
  allergies: string[]; // 'peanuts' | 'tree-nuts' | 'milk' | 'egg' | 'soy' | 'gluten' | 'fish' | 'shellfish' | 'sesame'
  rules: string[]; // 'halal' | 'kosher' | 'vegan' | 'vegetarian' | 'pregnancy' | 'celiac' | 'lactose'
  watch: string[]; // 'diabetes' | 'low-salt' | 'low-sugar' | 'cholesterol' | 'low-carb' | avoid list: 'no-palm-oil' | 'no-sweeteners' | 'no-added-sugar' | 'no-additives' | 'no-caffeine'
  goal: 'none' | 'lose-weight' | 'build-muscle' | 'eat-cleaner';
  /** Ingredients the user typed in to avoid, e.g. 'sucralose'. Lower-case. */
  avoidCustom?: string[];
  /** Cosmetics preferences: 'fragrance' | 'sensitive' | 'no-parabens' | 'no-sulfates' | 'no-alcohol' | 'no-silicones' */
  skin?: string[];
};

/** What kind of product this is. Decides which checks run. Missing means food. */
export type ProductKind = 'food' | 'beauty' | 'petfood' | 'supplement';

/** One row of a Supplement Facts panel, per serving. */
export type SupplementFact = { name: string; amount: number; unit: string };

export type SupplementInfo = {
  /** e.g. "2 capsules" */
  serving?: string;
  /** Weight of one serving in grams, when the label gives it (protein powders). */
  servingGrams?: number;
  /** Most servings a day the label directs. */
  perDay?: number;
  facts: SupplementFact[];
  /** Blends whose individual amounts the label does not disclose. */
  blends: string[];
};

/** Someone else the user shops for. Pets get their own checks; people get a full profile. */
export type Member = { id: string; name: string; kind: 'person' | 'dog' | 'cat'; profile: Profile; /** For dose limits. Missing means adult. */ age?: 'under1' | '1' | '2-3' | '4-8' | '9-18' | 'adult' };

/** A supplement the user takes daily, kept so doses can be added up across bottles. */
export type StackItem = { id: string; name: string; perDay: number; facts: SupplementFact[] };

export type Nutriments = {
  sugars?: number;
  salt?: number;
  saturatedFat?: number;
  fat?: number;
  protein?: number;
  fiber?: number;
  kcal?: number;
  carbs?: number;
  caffeine?: number;
};

export type ProductData = {
  barcode?: string;
  name: string;
  brand?: string;
  imageUrl?: string;
  /** Larger front photo for the result screen; imageUrl is the small one for lists. */
  imageFullUrl?: string;
  ingredientsText?: string;
  allergens: string[];
  traces: string[];
  labels: string[];
  nutriscoreGrade?: string;
  novaGroup?: number;
  nutriments?: Nutriments;
  photoFlags?: {
    containsPork?: boolean;
    containsAlcohol?: boolean;
    containsGelatin?: boolean;
    halalCertified?: boolean;
    kosherCertified?: boolean;
  };
  /** Database category tags, e.g. 'dog-food'. Used to tell which animal a pet food is for. */
  categories?: string[];
  kind?: ProductKind;
  supplement?: SupplementInfo;
  /** When the database's label information was last refreshed (ms since 1970). Recipes change. */
  dataDate?: number;
  /** Languages the ingredient text is available in, e.g. ['pl'] or ['fr', 'en']. */
  ingredientLangs?: string[];
  /** Share of the listed ingredients the database could not recognise (0–1): high means a garbled list. */
  unknownShare?: number;
  /** How many people have scanned this entry: obscure entries are more often wrong. */
  popularity?: number;
  /** Where the scanned product is sold, for suggesting alternatives that can be found locally. */
  countries?: string[];
  /** What to show the user: the list in their language when the database has one, else the original. */
  ingredientsShown?: string;
  /** Language code of ingredientsShown. */
  ingredientsLang?: string;
  /** Word-for-word translation into the user's language, built from the database's ingredient names. */
  ingredientsTranslated?: string;
  /** The list cleaned up for display: packaging small print removed, one entry per ingredient. */
  ingredientItems?: string[];
  /** Statements found next to the list, such as "May contain nuts". */
  ingredientNotes?: string[];
  /** Pet food: added vitamins and preservatives, listed separately on the pack. */
  ingredientAdditives?: string[];
  /** Ingredients in a foreign-language list that had no English name and so are not shown. */
  ingredientsUntranslated?: number;
  /** The language this result was fetched for, so a language change refetches it. */
  userLang?: string;
  /** The database's ingredients box held something that is not an ingredient list. */
  badIngredients?: boolean;
  source: 'openfoodfacts' | 'openbeautyfacts' | 'openpetfoodfacts' | 'usda' | 'dsld' | 'photo' | 'demo';
};

export type Verdict = {
  /** caution: nothing unsafe, but it works against a health need or an avoid choice in the profile. */
  level: 'safe' | 'caution' | 'not-safe' | 'unknown';
  reasons: string[];
  warnings: string[];
};

export type Score = { value: number; band: string; reasons: string[] };

export type HistoryEntry = { time: number; product: ProductData };

export const EMPTY_PROFILE: Profile = { allergies: [], rules: [], watch: [], goal: 'none' };
