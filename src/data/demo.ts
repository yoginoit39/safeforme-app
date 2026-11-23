import type { ProductData } from '../types';

/** Hard-coded demo products so the app can be tried fully offline. Not real products. */
export const DEMO_PRODUCTS: ProductData[] = [
  {
    name: 'Peanut Cookies',
    brand: 'Demo data',
    ingredientsText:
      'Wheat flour, sugar, peanuts (18%), butter (milk), palm oil, egg, salt, raising agent (sodium bicarbonate).',
    allergens: ['peanuts', 'gluten', 'milk', 'eggs'],
    traces: ['nuts'],
    labels: [],
    nutriscoreGrade: 'e',
    novaGroup: 4,
    nutriments: { sugars: 28, salt: 0.6, saturatedFat: 9, fat: 24, protein: 9, fiber: 2, kcal: 490 },
    source: 'demo',
  },
  {
    name: 'Plain Rolled Oats',
    brand: 'Demo data',
    ingredientsText: '100% whole grain rolled oats.',
    allergens: [],
    traces: [],
    labels: [],
    nutriscoreGrade: 'a',
    novaGroup: 1,
    nutriments: { sugars: 1, salt: 0.01, saturatedFat: 1.3, fat: 7, protein: 13, fiber: 10, kcal: 375 },
    source: 'demo',
  },
  {
    name: 'Cola',
    brand: 'Demo data',
    ingredientsText:
      'Carbonated water, sugar, colour (caramel E150d), acid (phosphoric acid), natural flavourings including caffeine.',
    allergens: [],
    traces: [],
    labels: [],
    nutriscoreGrade: 'e',
    novaGroup: 4,
    nutriments: { sugars: 10.6, salt: 0, saturatedFat: 0, fat: 0, protein: 0, fiber: 0, kcal: 42 },
    source: 'demo',
  },
];

/** Real barcodes, looked up live in Open Food Facts (verified at build time). */
export const SAMPLE_BARCODES: { barcode: string; label: string; emoji: string }[] = [
  { barcode: '3017620422003', label: 'Nutella', emoji: '🌰' },
  { barcode: '5449000000996', label: 'Coca-Cola', emoji: '🥤' },
  { barcode: '5000159407236', label: 'Mars bar', emoji: '🍫' },
  { barcode: '8076800195057', label: 'Barilla spaghetti', emoji: '🍝' },
  { barcode: '4001686301265', label: 'Haribo gummy bears', emoji: '🐻' },
];

/** One emoji per demo product, same order as DEMO_PRODUCTS. */
export const DEMO_EMOJI = ['🍪', '🥣', '🥤'];
