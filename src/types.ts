export type Profile = {
  allergies: string[]; // 'peanuts' | 'tree-nuts' | 'milk' | 'egg' | 'soy' | 'gluten' | 'fish' | 'shellfish' | 'sesame'
  rules: string[]; // 'halal' | 'kosher' | 'vegan' | 'vegetarian' | 'pregnancy'
  watch: string[]; // 'diabetes' | 'low-salt' | 'low-sugar'
  goal: 'none' | 'lose-weight' | 'build-muscle' | 'eat-cleaner';
};

export type Nutriments = {
  sugars?: number;
  salt?: number;
  saturatedFat?: number;
  fat?: number;
  protein?: number;
  fiber?: number;
  kcal?: number;
  caffeine?: number;
};

export type ProductData = {
  barcode?: string;
  name: string;
  brand?: string;
  imageUrl?: string;
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
  source: 'openfoodfacts' | 'photo' | 'demo';
};

export type Verdict = {
  level: 'safe' | 'not-safe' | 'unknown';
  reasons: string[];
  warnings: string[];
};

export type Score = { value: number; band: string; reasons: string[] };

export type HistoryEntry = { time: number; product: ProductData };

export const EMPTY_PROFILE: Profile = { allergies: [], rules: [], watch: [], goal: 'none' };
