import type { ProductData } from '../src/types';
import { EMPTY_PROFILE } from '../src/types';
import { computeVerdict } from '../src/engine/verdict';
import { childConcerns, withChildChecks } from '../src/engine/children';
import type { AgeBand } from '../src/engine/supplements';

const f = (name: string, ingredientsText: string, extra: Partial<ProductData> = {}): ProductData => ({
  name, ingredientsText, allergens: [], traces: [], labels: [], source: 'openfoodfacts', kind: 'food', ingredientLangs: ['en'], ...extra,
});

/** Everyday products a family actually scans. No allergies in play: this grid is about age alone. */
export const PRODUCTS: ProductData[] = [
  f('Cola', 'carbonated water, sugar, colour (caramel E150d), phosphoric acid, natural flavourings including caffeine', { nutriments: { sugars: 10.9, salt: 0 } }),
  f('Diet cola', 'carbonated water, colour (caramel E150d), sweeteners (aspartame, acesulfame K), natural flavourings including caffeine'),
  f('Energy drink', 'carbonated water, sucrose, glucose, taurine, caffeine, vitamins', { categories: ['beverages', 'energy-drinks'] }),
  f('Iced tea', 'water, sugar, black tea extract, lemon juice'),
  f('Chocolate chip cookies', 'wheat flour, sugar, chocolate chips (sugar, cocoa mass, cocoa butter), butter, eggs, salt', { nutriments: { sugars: 33, salt: 0.8 } }),
  f('Plain rusks, no added sugar', 'wheat flour, sunflower oil, yeast'),
  f('Strawberry yogurt', 'milk, sugar, strawberries, natural flavouring'),
  f('Plain whole milk yogurt', 'whole milk, live cultures'),
  f('Honey oat cereal', 'whole grain oats, honey, barley malt extract', { nutriments: { sugars: 22, salt: 0.5 } }),
  f('Clear honey', 'honey'),
  f('Apple juice', 'apple juice from concentrate', { categories: ['beverages', 'juices', 'apple-juices'] }),
  f('Whole milk', 'whole milk', { categories: ['dairies', 'milks', 'whole-milks'] }),
  f('Apple puree, nothing added', 'apples'),
  f('Salted potato crisps', 'potatoes, sunflower oil, salt', { nutriments: { salt: 1.6 } }),
  f('Roasted salted peanuts', 'peanuts, sunflower oil, salt', { nutriments: { salt: 1.2 } }),
  f('Smooth peanut butter', 'roasted peanuts, palm oil, salt', { nutriments: { salt: 0.9 } }),
  f('Raw milk Camembert', 'unpasteurised cow’s milk, salt, rennet', { nutriments: { salt: 1.4 } }),
  f('Swordfish steak', 'swordfish'),
  f('Rice drink', 'water, rice (14%), sunflower oil, sea salt'),
  f('Tiramisu', 'mascarpone, sugar, eggs, coffee, marsala wine, cocoa'),
  f('Coffee ice cream', 'milk, cream, sugar, coffee extract'),
  f('Blue raspberry slush', 'water, glycerol, flavouring, colour'),
  f('Plain pasta', 'durum wheat semolina'),
  f('Beef stock cubes', 'salt, beef fat, yeast extract, onion powder', { nutriments: { salt: 52 } }),
];

export const AGES: AgeBand[] = ['under1', '1', '2-3', '4-8', '9-18', 'adult'];

export type Cell = 'OK' | 'Not ideal' | 'Not for this age';
export function cell(p: ProductData, age: AgeBand): Cell {
  const v = withChildChecks(computeVerdict(p, EMPTY_PROFILE), p, age);
  if (v.level === 'not-safe') return 'Not for this age';
  return v.level === 'caution' ? 'Not ideal' : 'OK';
}
export const why = (p: ProductData, age: AgeBand) => {
  const c = childConcerns(p, age);
  return [...c.notForAge, ...c.caution].map((r) => r.split('.')[0]).join('; ');
};
