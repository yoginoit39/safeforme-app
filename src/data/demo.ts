import type { ProductData, ProductKind } from '../types';

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
  {
    name: 'Night Face Cream',
    brand: 'Demo data',
    ingredientsText:
      'Aqua, glycerin, cetearyl alcohol, dimethicone, butyrospermum parkii butter, retinol, parfum, methylparaben, limonene, linalool, phenoxyethanol.',
    allergens: [],
    traces: [],
    labels: [],
    kind: 'beauty',
    source: 'demo',
  },
  {
    name: 'Chicken Dog Food',
    brand: 'Demo data',
    ingredientsText:
      'Chicken (40%), rice, maize, animal fat, beet pulp, minerals, vitamins, antioxidants.',
    allergens: [],
    traces: [],
    labels: [],
    categories: ['en:pet-food', 'en:dog-food'],
    kind: 'petfood',
    source: 'demo',
  },
];

/** Real barcodes, looked up live in the open product databases (verified at build time). */
export const SAMPLE_BARCODES: { barcode: string; label: string; emoji: string; kind: ProductKind }[] = [
  { barcode: '3017620422003', label: 'Nutella', emoji: '🌰', kind: 'food' },
  { barcode: '5449000000996', label: 'Coca-Cola', emoji: '🥤', kind: 'food' },
  { barcode: '42164104', label: 'Nivea Creme', emoji: '🧴', kind: 'beauty' },
  { barcode: '8001090662231', label: 'Herbal Essences shampoo', emoji: '🫧', kind: 'beauty' },
  { barcode: '5010394133852', label: 'Pedigree dog biscuits', emoji: '🐶', kind: 'petfood' },
  { barcode: '5998749108536', label: 'Whiskas cat treats', emoji: '🐱', kind: 'petfood' },
];

/** One emoji per demo product, same order as DEMO_PRODUCTS. */
export const DEMO_EMOJI = ['🍪', '🥣', '🥤', '🧴', '🐶'];
