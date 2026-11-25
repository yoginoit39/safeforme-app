import type { ProductData, Profile, Verdict } from '../types';
import { customAvoidHits, findTerm, type TermGroup } from './verdict';

/**
 * Cosmetics check. Pure, deterministic, no network, no AI.
 * There is no official score for cosmetics, so this gives no number. It reports
 * ingredients that regulators have banned, restricted or warned about, and
 * checks the list against the user's own profile.
 */

export type BeautyFlag = { name: string; note: string; source?: string; severity: 'danger' | 'restricted' | 'info' };

type Rule = TermGroup & { name: string; note: string; source?: string };

/** Health authorities warn against these outright. Any of them makes the product "Not safe". */
const DANGER: Rule[] = [
  {
    name: 'Mercury',
    terms: ['mercury', 'mercurous chloride', 'calomel', 'mercuric', 'mercurio', 'ammoniated mercury', 'hydrargyrum'],
    note: 'Found in some skin-lightening creams. The WHO says mercury in skin products can damage the kidneys and nervous system. The Minamata Convention, a UN treaty, bans making or trading cosmetics with more than 1 part per million.',
    source: 'WHO; Minamata Convention on Mercury',
  },
  {
    name: 'Hydroquinone',
    terms: ['hydroquinone', 'hydrochinon'],
    note: 'A skin-bleaching agent. Banned in cosmetics in the EU and many African countries; prescription-only elsewhere.',
    source: 'EU Cosmetics Regulation 1223/2009, Annex II',
  },
  {
    name: 'Steroid',
    terms: ['clobetasol', 'betamethasone', 'fluocinonide', 'mometasone', 'triamcinolone'],
    note: 'A prescription medicine sometimes added to lightening creams. Thins the skin with long use. Should only be used under a doctor’s care.',
    source: 'WHO',
  },
];

/** Banned or restricted by a regulator. Shown as warnings with the source named. */
const RESTRICTED: Rule[] = [
  { name: 'Lilial (butylphenyl methylpropional)', terms: ['butylphenyl methylpropional', 'lilial'], note: 'A fragrance ingredient banned in EU cosmetics since March 2022 over fertility concerns.', source: 'EU Regulation 2021/1902' },
  { name: 'Lyral (HICC)', terms: ['hydroxyisohexyl 3-cyclohexene carboxaldehyde', 'lyral', 'hicc'], note: 'A fragrance ingredient banned in EU cosmetics because it causes skin allergies.', source: 'EU Regulation 2017/1410' },
  { name: 'Zinc pyrithione', terms: ['zinc pyrithione', 'pyrithione zinc'], note: 'An anti-dandruff agent banned in EU cosmetics since March 2022.', source: 'EU Regulation 2021/1902' },
  { name: 'Methylisothiazolinone', terms: ['methylisothiazolinone', 'methylchloroisothiazolinone'], note: 'A preservative and common cause of skin allergy. Banned in EU leave-on products; limited in rinse-off ones.', source: 'EU Cosmetics Regulation, Annex V' },
  { name: 'Banned parabens', terms: ['isopropylparaben', 'isobutylparaben', 'phenylparaben', 'benzylparaben', 'pentylparaben'], note: 'These five parabens have been banned in EU cosmetics since 2014.', source: 'EU Regulation 358/2014' },
  { name: 'Formaldehyde releaser', terms: ['dmdm hydantoin', 'imidazolidinyl urea', 'diazolidinyl urea', 'quaternium-15', 'bronopol', '2-bromo-2-nitropropane-1,3-diol', 'formaldehyde'], note: 'Slowly releases formaldehyde, a skin allergen and carcinogen. The EU requires a warning on the label.', source: 'EU Cosmetics Regulation, Annex V' },
  { name: 'Triclosan', terms: ['triclosan'], note: 'An antibacterial restricted in EU cosmetics and banned by the US FDA in consumer antiseptic washes.', source: 'EU Cosmetics Regulation; US FDA (2016)' },
  { name: 'Oxybenzone (benzophenone-3)', terms: ['benzophenone-3', 'oxybenzone'], note: 'A sunscreen filter whose allowed amount the EU lowered in 2022 over hormone concerns.', source: 'EU Regulation 2022/1176' },
];

/** The fragrance allergens the EU requires to be named on the label. */
export const FRAGRANCE_ALLERGENS: TermGroup = {
  terms: [
    'limonene', 'linalool', 'citronellol', 'geraniol', 'citral', 'eugenol', 'isoeugenol', 'coumarin', 'cinnamal', 'cinnamyl alcohol',
    'benzyl alcohol', 'benzyl salicylate', 'benzyl benzoate', 'benzyl cinnamate', 'hexyl cinnamal', 'amyl cinnamal', 'amylcinnamyl alcohol',
    'farnesol', 'anise alcohol', 'alpha-isomethyl ionone', 'hydroxycitronellal', 'methyl 2-octynoate', 'evernia prunastri', 'evernia furfuracea',
    'butylphenyl methylpropional',
  ],
};
const FRAGRANCE: TermGroup = { terms: ['parfum', 'fragrance', 'perfume', 'aroma', 'essential oil'], except: ['fragrance-free', 'fragrance free', 'sans parfum'] };

const PARABENS: TermGroup = { terms: ['methylparaben', 'ethylparaben', 'propylparaben', 'butylparaben', 'paraben', 'isobutylparaben', 'isopropylparaben'], except: ['paraben-free', 'paraben free'] };
const SULFATES: TermGroup = { terms: ['sodium lauryl sulfate', 'sodium laureth sulfate', 'ammonium lauryl sulfate', 'ammonium laureth sulfate', 'sodium lauryl sulphate', 'sodium laureth sulphate', 'sodium coco-sulfate', 'sodium myreth sulfate'] };
/** Ethanol-type alcohols only. Fatty alcohols (cetyl, cetearyl, …) are moisturising and must not match, so whole entries are compared. */
const DRYING_RX = /^(alcohol|alcohol denat\.?|denatured alcohol|sd alcohol[\w\s-]*|ethanol|ethyl alcohol|isopropyl alcohol)$/;
function dryingAlcohol(text: string): string | null {
  for (const raw of text.split(/[,;•·]/)) {
    const item = raw.replace(/\(.*?\)/g, '').replace(/[*.]+$/g, '').trim();
    if (DRYING_RX.test(item)) return item;
  }
  return null;
}
const SILICONES: TermGroup = { terms: ['dimethicone', 'cyclopentasiloxane', 'cyclohexasiloxane', 'cyclomethicone', 'amodimethicone', 'dimethiconol', 'phenyl trimethicone', 'trimethicone'] };

const RETINOIDS: TermGroup = { terms: ['retinol', 'retinal', 'retinaldehyde', 'retinyl palmitate', 'retinyl acetate', 'tretinoin', 'adapalene', 'tazarotene', 'retinoic acid', 'hydroxypinacolone retinoate'] };
const SALICYLIC: TermGroup = { terms: ['salicylic acid'] };

const ANIMAL: TermGroup = {
  terms: [
    'beeswax', 'cera alba', 'cera flava', 'lanolin', 'carmine', 'ci 75470', 'cochineal', 'shellac', 'collagen', 'keratin', 'silk', 'sericin',
    'honey', 'mel', 'propolis', 'royal jelly', 'lac', 'milk', 'snail secretion filtrate', 'guanine', 'ci 75170', 'tallow', 'sodium tallowate',
    'elastin', 'squalene', 'emu oil', 'mink oil', 'egg', 'caviar',
  ],
  except: ['lanolin-free', 'vegetable collagen', 'hydrolyzed vegetable protein', 'coconut milk', 'oat milk', 'almond milk', 'rice milk', 'soy milk'],
};

/** Food allergies, as they appear under their Latin (INCI) names on cosmetics. */
const ALLERGY_INCI: Record<string, { label: string; group: TermGroup }> = {
  peanuts: { label: 'peanut', group: { terms: ['arachis hypogaea', 'peanut', 'arachide'] } },
  'tree-nuts': { label: 'tree nut', group: { terms: ['prunus amygdalus', 'almond', 'macadamia', 'juglans regia', 'walnut', 'corylus avellana', 'hazelnut', 'bertholletia excelsa', 'brazil nut', 'pistacia vera', 'pistachio', 'anacardium occidentale', 'cashew', 'carya illinoinensis', 'pecan'] } },
  sesame: { label: 'sesame', group: { terms: ['sesamum indicum', 'sesame'] } },
  gluten: { label: 'wheat', group: { terms: ['triticum vulgare', 'triticum aestivum', 'wheat', 'hordeum vulgare', 'barley', 'secale cereale'] } },
  soy: { label: 'soy', group: { terms: ['glycine soja', 'glycine max', 'soy', 'soja', 'soybean'] } },
  milk: { label: 'milk', group: { terms: ['lac', 'milk', 'casein', 'whey', 'lactoferrin', 'lactis proteinum'], except: ['coconut milk', 'oat milk', 'almond milk', 'rice milk', 'soy milk'] } },
  egg: { label: 'egg', group: { terms: ['egg', 'ovum', 'albumen', 'ovalbumin'] } },
  fish: { label: 'fish', group: { terms: ['fish', 'piscum', 'salmon', 'cod liver'] } },
};

const titleCase = (s: string) => s.replace(/\b\p{L}/gu, (c) => c.toUpperCase());

/** Ingredients worth knowing about, most serious first. Independent of the profile. */
export function beautyFlags(product: ProductData): BeautyFlag[] {
  const text = (product.ingredientsText ?? '').toLowerCase();
  if (!text) return [];
  const out: BeautyFlag[] = [];
  for (const r of DANGER) if (findTerm(text, r)) out.push({ name: r.name, note: r.note, source: r.source, severity: 'danger' });
  for (const r of RESTRICTED) if (findTerm(text, r)) out.push({ name: r.name, note: r.note, source: r.source, severity: 'restricted' });
  const allergens = FRAGRANCE_ALLERGENS.terms.filter((t) => findTerm(text, { terms: [t] }));
  if (allergens.length) {
    out.push({
      name: `Fragrance allergens (${allergens.length})`,
      note: `${allergens.map(titleCase).join(', ')}. Scent ingredients that the EU requires to be named on the label because they can cause skin allergy.`,
      source: 'EU Cosmetics Regulation, Annex III',
      severity: 'info',
    });
  } else if (findTerm(text, FRAGRANCE)) {
    out.push({ name: 'Fragrance', note: 'Contains added scent. "Parfum" can cover many undisclosed ingredients; a common trigger for sensitive skin.', severity: 'info' });
  }
  if (findTerm(text, RETINOIDS)) out.push({ name: 'Retinoid (vitamin A)', note: 'An effective anti-ageing ingredient. The EU limits its strength, and it should be avoided in pregnancy.', source: 'EU Regulation 2024/996', severity: 'info' });
  if (findTerm(text, PARABENS) && !out.some((f) => f.name === 'Banned parabens')) out.push({ name: 'Parabens', note: 'Preservatives. Methyl- and ethylparaben are considered safe at allowed levels; the EU limits propyl- and butylparaben.', source: 'EU Scientific Committee on Consumer Safety', severity: 'info' });
  if (findTerm(text, SULFATES)) out.push({ name: 'Sulfates (SLS / SLES)', note: 'Strong foaming cleansers. Safe to use, but can dry or irritate sensitive skin and scalp.', severity: 'info' });
  if (dryingAlcohol(text)) out.push({ name: 'Alcohol', note: 'Helps products dry fast. Can be drying or stinging on sensitive skin when high on the list.', severity: 'info' });
  return out;
}

export function computeBeautyVerdict(product: ProductData, profile: Profile): Verdict {
  const text = (product.ingredientsText ?? '').toLowerCase().trim();
  if (!text) {
    return {
      level: 'unknown',
      reasons: [
        product.source === 'photo'
          ? "The ingredients couldn't be read from the photo. Retake it closer and in good light, or check the physical label."
          : "This product's ingredients aren't in the database. Check the physical label, or photograph the ingredients list.",
      ],
      warnings: [],
    };
  }

  const notSafe: string[] = [];
  const unknown: string[] = [];
  const warnings: string[] = [];
  const skin = new Set(profile.skin ?? []);
  const rules = new Set(profile.rules);

  for (const r of DANGER) {
    const hit = findTerm(text, r);
    if (hit) notSafe.push(`Contains ${r.name.toLowerCase()} (“${hit}”) — health authorities warn against it in cosmetics.`);
  }
  for (const r of RESTRICTED) {
    if (findTerm(text, r)) warnings.push(`Contains ${r.name} — ${r.note.charAt(0).toLowerCase()}${r.note.slice(1)}`);
  }

  for (const id of profile.allergies) {
    const def = ALLERGY_INCI[id];
    const hit = def && findTerm(text, def.group);
    if (hit) notSafe.push(`Contains ${def.label} (“${hit}”) — you have a ${def.label} allergy.`);
  }

  const fragranceAllergen = findTerm(text, FRAGRANCE_ALLERGENS);
  const fragrance = fragranceAllergen ?? findTerm(text, FRAGRANCE);
  if (skin.has('fragrance') && fragrance) notSafe.push(`Contains fragrance (“${fragrance}”) — you have a fragrance allergy.`);

  if (skin.has('sensitive')) {
    if (fragrance && !skin.has('fragrance')) warnings.push(`Contains fragrance (“${fragrance}”) — a common trigger for sensitive skin.`);
    const sulfate = findTerm(text, SULFATES);
    if (sulfate) warnings.push(`Contains ${sulfate} — can irritate sensitive skin.`);
    const alcohol = dryingAlcohol(text);
    if (alcohol) warnings.push(`Contains ${alcohol} — can dry out sensitive skin.`);
  }

  const avoid: [string, () => string | null, string][] = [
    ['no-parabens', () => findTerm(text, PARABENS), 'parabens'], ['no-sulfates', () => findTerm(text, SULFATES), 'sulfates'],
    ['no-alcohol', () => dryingAlcohol(text), 'alcohol'], ['no-silicones', () => findTerm(text, SILICONES), 'silicones'],
  ];
  for (const [id, find, label] of avoid) {
    const hit = skin.has(id) && find();
    if (hit) warnings.push(`Contains ${label} (${hit}) — on your avoid list.`);
  }

  if (rules.has('pregnancy')) {
    const retinoid = findTerm(text, RETINOIDS);
    if (retinoid) notSafe.push(`Contains a retinoid (“${retinoid}”) — avoid while pregnant.`);
    if (findTerm(text, SALICYLIC)) warnings.push('Contains salicylic acid — ask your doctor about using it while pregnant.');
  }

  if (rules.has('vegan')) {
    const animal = findTerm(text, ANIMAL);
    if (animal) notSafe.push(`Contains ${animal} — not vegan.`);
  }

  if (rules.has('halal')) {
    const certified = product.labels.some((l) => l.includes('halal')) || product.photoFlags?.halalCertified === true;
    if (!certified) unknown.push('No halal certification found. Cosmetics can contain alcohol or animal-derived ingredients that the list does not make clear.');
  }

  if (notSafe.length) return { level: 'not-safe', reasons: [...notSafe, ...unknown], warnings };
  if (unknown.length) return { level: 'unknown', reasons: unknown, warnings };
  const custom = customAvoidHits(product, profile);
  if (warnings.length || custom.length) return { level: 'caution', reasons: [...custom, ...warnings], warnings: [] };
  return { level: 'safe', reasons: ['No flagged ingredients found for your profile.'], warnings };
}
