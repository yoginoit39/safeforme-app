import { describe, expect, it } from 'vitest';
import { buildTranslation, idToEnglish, looksLikeIngredients } from '../src/lang';
import { mapOffProduct } from '../src/data/off';
import { computePetVerdict } from '../src/engine/pets';

const ADVERT =
  ". En utilisant des assimilation optimale des nutriments. Information importante: le paquet de croquettes en format 9,75 kg vous est proposé dans un design différent de votre produit habituel. Nous vous garantissons cependant qu'il s'agit bien des mêmes croquettes et que leur qualité reste inchangée. Caractéristiques des croquettes PURINA ONE pour chat: • Bifensis Dual Defence: formule double défense qui contribue à améliorer le bien-être du chat, à l'intérieur comme à l'extérieur. Action cliniquement prouvée, augmente la formation d'anticorps dans l'intestin et favorise la santé de la peau et du pelage grâce à des acides gras oméga 6";
const FRENCH_LIST =
  "céréales (dont blé 4%), viandes et sous produits animaux, sous-produits d'origine végétale (dont pulpe de betterave déshydratée 2%), huiles et graisses, poissons et sous-produits de poissons (dont saumon 4% dans les croquettes brunes), substances minérales, levures";

describe('junk in the ingredients box', () => {
  it('accepts real ingredient lists, including long bracketed notes', () => {
    expect(looksLikeIngredients('sugar, palm oil, hazelnuts 13%, skimmed milk powder 8.7%, cocoa')).toBe(true);
    expect(looksLikeIngredients('100% whole grain rolled oats.')).toBe(true);
    expect(looksLikeIngredients(FRENCH_LIST)).toBe(true);
    expect(looksLikeIngredients('Aqua, Paraffinum Liquidum, Cera Microcristallina, Glycerin, Lanolin Alcohol')).toBe(true);
  });

  it('rejects advertising copy', () => {
    expect(looksLikeIngredients(ADVERT)).toBe(false);
  });

  it('a pet food whose only "ingredients" are an advert is never SAFE', () => {
    const p = mapOffProduct('7613033136351', { product_name: 'Purina One', lc: 'fr', ingredients_text: ADVERT, categories_tags: ['en:cat-food'] }, 'petfood');
    expect(p.ingredientsText).toBeUndefined();
    expect(p.badIngredients).toBe(true);
    expect(computePetVerdict(p, 'cat').level).toBe('unknown');
  });
});

describe('product language', () => {
  const raw = {
    product_name: 'Pâte à tartiner', product_name_es: 'Crema de avellanas', lc: 'fr',
    ingredients_text: 'sucre, huile de palme, noisettes', ingredients_text_es: 'azúcar, aceite de palma, avellanas',
    ingredients: [{ id: 'en:sugar', text: 'sucre' }, { id: 'en:palm-oil', text: 'huile de palme' }, { id: 'en:hazelnut', text: 'noisettes' }],
  };

  it("uses the user's language when the database has it", () => {
    const p = mapOffProduct('1', raw, 'food', 'es');
    expect(p.name).toBe('Crema de avellanas');
    expect(p.ingredientsShown).toBe('azúcar, aceite de palma, avellanas');
    expect(p.ingredientsLang).toBe('es');
    expect(p.ingredientsTranslated).toBeUndefined();
  });

  it('falls back to the original, labelled with its language, and translates to English from ingredient ids', () => {
    const p = mapOffProduct('1', raw, 'food', 'en');
    expect(p.name).toBe('Pâte à tartiner');
    expect(p.ingredientsShown).toBe('sucre, huile de palme, noisettes');
    expect(p.ingredientsLang).toBe('fr');
    expect(p.ingredientsTranslated).toBe('sugar, palm oil, hazelnut');
  });

  it('every language version stays searchable for allergy checks', () => {
    const p = mapOffProduct('1', raw, 'food', 'es');
    expect(p.ingredientsText).toContain('noisettes');
    expect(p.ingredientsText).toContain('avellanas');
  });

  it('does not offer a mostly untranslated list', () => {
    const list = [{ id: 'en:sugar', text: 'sucre' }, { id: 'fr:truc', text: 'truc' }, { id: 'fr:machin', text: 'machin' }];
    expect(buildTranslation(list, idToEnglish)).toBeUndefined();
  });
});
