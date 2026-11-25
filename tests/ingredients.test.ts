import { describe, expect, it } from 'vitest';
import { knownFromParse, parseIngredients } from '../src/ingredients';

const items = (text: string, known?: Set<string>) => parseIngredients(text, known).items;

describe('ingredient list for display', () => {
  it('splits a plain list and capitalises each item', () => {
    expect(items('sugar, palm oil, hazelnuts 13%, skimmed milk powder 8,7%, fat-reduced cocoa 7,4%')).toEqual([
      'Sugar', 'Palm oil', 'Hazelnuts 13%', 'Skimmed milk powder 8,7%', 'Fat-reduced cocoa 7,4%',
    ]);
  });

  it('keeps bracketed sub-ingredients with their parent', () => {
    expect(items('Wheat flour (wheat, calcium, iron), sugar, chocolate [sugar, cocoa butter, milk]')).toEqual([
      'Wheat flour (wheat, calcium, iron)', 'Sugar', 'Chocolate [sugar, cocoa butter, milk]',
    ]);
  });

  it('removes packaging small print and shouting from the real CeraVe entry', () => {
    const text =
      'AQUA/WATER/EAU, GLYCERIN, CAPRYLIC/CAPRIC TRIGLYCERIDE, CETEARYL ALCOHOL, CERAMIDE NP, CERAMIDE EOP, CETEARETH-20. BEHENTRIMONIUM METHOSULFATE, DISODIUM EDTA, POLYSORBATE 20, POLYGLYCERYL-3 DIISOSTEARATE (CODE F.I.L. D215763/21 CeraVe® LLC, New York, NY 10001 MVE is a registered trademark of OFB Technology, Ltd. Made in France www.cerave.com Questions or comments? 1-888-768-2915 XRUD9E 3 606000 5377 3612623081075';
    expect(items(text)).toEqual([
      'Aqua/Water/Eau', 'Glycerin', 'Caprylic/Capric Triglyceride', 'Cetearyl Alcohol', 'Ceramide NP', 'Ceramide EOP', 'Ceteareth-20',
      'Behentrimonium Methosulfate', 'Disodium EDTA', 'Polysorbate 20', 'Polyglyceryl-3 Diisostearate',
    ]);
  });

  it('keeps the ingredient when a batch code is glued to it', () => {
    expect(items('AQUA/WATER, GLYCERIN, TOCOPHEROL, PARFUM/FRAGRANCE (F.LL. Z70044907/1).')).toEqual(['Aqua/Water', 'Glycerin', 'Tocopherol', 'Parfum/Fragrance']);
    expect(items('AQUA, PANTHENOL, SODIUM HYDROXIDE, TETRASODIUM GLUTAMATE DIACETATE [PI02017] Lote: ver sellado / extremidade do tubo.')).toEqual([
      'Aqua', 'Panthenol', 'Sodium Hydroxide', 'Tetrasodium Glutamate Diacetate',
    ]);
    expect(items('880018 2 - aqua / water, cetyl alcohol, glycerin, parfum / fragrance, (F.I.L. B47147/3)')).toEqual([
      'Aqua / water', 'Cetyl alcohol', 'Glycerin', 'Parfum / fragrance',
    ]);
  });

  it('colour index, E and INS numbers are ingredients, not codes', () => {
    expect(items('Aqua, Glycerin, Mica, CI 77891, CI 77491')).toEqual(['Aqua', 'Glycerin', 'Mica', 'CI 77891', 'CI 77491']);
    expect(items('water, sugar, carbonic acid, e150d, e338, natural flavors')).toEqual(['Water', 'Sugar', 'Carbonic acid', 'E150d', 'E338', 'Natural flavors']);
    expect(items('Wheat flour, sugar, raising agents [INS 503(ii), 500(ii)], flour treatment agent (1101(i)), salt')).toEqual([
      'Wheat flour', 'Sugar', 'Raising agents [INS 503(ii), 500(ii)]', 'Flour treatment agent (1101(i))', 'Salt',
    ]);
  });

  it('a trademark sign inside the list does not end it', () => {
    expect(items('Milk, cream, Lactobacillus LGG®, sugar, vanilla extract')).toEqual(['Milk', 'Cream', 'Lactobacillus LGG®', 'Sugar', 'Vanilla extract']);
  });

  it('"may contain" lines become notes, whole', () => {
    const r = parseIngredients('Rye flour, yeast, salt. May contain traces of lupin, milk, mustard and soy.');
    expect(r.items).toEqual(['Rye flour', 'Yeast', 'Salt']);
    expect(r.notes).toEqual(['May contain traces of lupin, milk, mustard and soy']);
  });

  it('"made in a facility" is a note, not the start of small print', () => {
    const r = parseIngredients('Oats, sugar, honey. Made in a facility that handles nuts.');
    expect(r.items).toEqual(['Oats', 'Sugar', 'Honey']);
    expect(r.notes).toEqual(['Made in a facility that handles nuts']);
  });

  it('"contains 2% or less of" is a heading, what follows is an ingredient', () => {
    expect(items('Enriched flour, water, contains 2% or less of: salt, yeast, soybean oil')).toEqual(['Enriched flour', 'Water', 'Salt', 'Yeast', 'Soybean oil']);
  });

  it('starts after an "Ingredients:" label, but keeps the first list of a two-language entry', () => {
    expect(items('Delicious crunchy biscuits. Ingredients: wheat flour, sugar, butter, salt')).toEqual(['Wheat flour', 'Sugar', 'Butter', 'Salt']);
    expect(items('INGREDIENTS AQUA, GLYCERIN, PARFUM')).toEqual(['Aqua', 'Glycerin', 'Parfum']);
    expect(items('Chicken, rice, maize, beet pulp, minerals. Composition: poulet, riz, maïs, pulpe de betterave, minéraux')).toEqual([
      'Chicken', 'Rice', 'Maize', 'Beet pulp', 'Minerals', 'Poulet', 'Riz', 'Maïs', 'Pulpe de betterave', 'Minéraux',
    ]);
  });

  it('pet food: additives become their own group without amounts, the analysis table is dropped', () => {
    const r = parseIngredients(
      'Chicken 54%, Chicken Broth, Minerals, Vegetable Oil. NUTRITIONAL ADDITIVES (per kg): Taurine 2000 mg, Vitamin A 20200 IU, Vitamin D3 596 IU, Zinc (Zinc chelate of amino acids, hydrate) 120 mg. Analytical constituents: Crude protein 11%, Crude fat 6%, Moisture 80%.',
    );
    expect(r.items).toEqual(['Chicken 54%', 'Chicken Broth', 'Minerals', 'Vegetable Oil']);
    expect(r.additives).toEqual(['Taurine', 'Vitamin A', 'Vitamin D3', 'Zinc']);
  });

  it('uses the names the database recognised to drop a company address, and to rescue an ingredient typed after it', () => {
    const parsed = [
      { id: 'en:aqua', text: 'Aqua', is_in_taxonomy: 1 }, { id: 'en:glycerin', text: 'Glycerin', is_in_taxonomy: 1 },
      { id: 'en:geraniol', text: 'Geraniol', is_in_taxonomy: 1 }, { id: 'en:isoeugenol', text: 'Isoeugenol', is_in_taxonomy: 1 },
      { id: 'en:acme-labs', text: 'Acme Labs', is_in_taxonomy: 0 },
    ];
    const known = knownFromParse(parsed);
    expect(items('Aqua, Glycerin, Geraniol, Acme Labs, 12 Rue de Lille 20300, Made in Germany, Isoeugenol, 4 000196 901163', known)).toEqual([
      'Aqua', 'Glycerin', 'Geraniol', 'Isoeugenol',
    ]);
  });

  it('small joining words stay lower-case when un-shouting French lists', () => {
    expect(items("EAU, HUILE DE TOURNESOL, EXTRAIT D'AVOINE, SEL DE MER")).toEqual(['Eau', 'Huile de Tournesol', 'Extrait d’Avoine', 'Sel de Mer']);
  });

  it('survives a bracket that is never closed', () => {
    expect(items('Wheat flour (maida, sugar, palm oil, salt, yeast, milk solids, cocoa solids, starch, emulsifier, raising agent, flavour, colour, vitamins, minerals, iron, niacin, thiamin, riboflavin, folic acid, zinc, iodine, calcium carbonate, soy lecithin, glucose syrup').length).toBeGreaterThan(10);
  });

  it('empty or meaningless text gives an empty list', () => {
    expect(parseIngredients('').items).toEqual([]);
    expect(parseIngredients('12345 67890').items).toEqual([]);
  });
});
