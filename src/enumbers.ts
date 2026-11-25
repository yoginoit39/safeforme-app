/**
 * Everyday names for food additive E numbers. Read from the Open Food Facts additives taxonomy
 * (November 2026), not typed from memory. A code missing here is shown as the code.
 */
export const E_NAMES: Record<string, string> = {
  e100: "curcumin", e101: "riboflavins", e102: "tartrazine", e104: "quinoline yellow",
  e110: "sunset yellow fcf", e120: "cochineal", e122: "azorubine", e124: "ponceau 4r",
  e129: "allura red", e131: "patent blue v", e132: "indigotine", e133: "brilliant blue fcf",
  e140: "chlorophylls and chlorophyllins", e141: "copper complexes of chlorophylls and chlorophyllins", e150a: "plain caramel", e150b: "caustic sulphite caramel",
  e150c: "ammonia caramel", e150d: "sulphite ammonia caramel", e153: "vegetable carbon", e160a: "carotene",
  e160b: "annatto", e160c: "paprika extract", e161b: "lutein", e162: "beetroot red",
  e163: "anthocyanins", e170: "calcium carbonates", e171: "titanium dioxide", e172: "iron oxides and iron hydroxides",
  e200: "sorbic acid", e202: "potassium sorbate", e210: "benzoic acid", e211: "sodium benzoate",
  e212: "potassium benzoate", e220: "sulphur dioxide", e221: "sodium sulphite", e222: "sodium bisulphite",
  e223: "sodium metabisulphite", e224: "potassium metabisulphite", e228: "potassium bisulphite", e234: "nisin",
  e235: "natamycin", e250: "sodium nitrite", e251: "sodium nitrate", e252: "potassium nitrate",
  e260: "acetic acid", e261: "potassium acetate", e262: "sodium acetates", e270: "lactic acid",
  e280: "propionic acid", e281: "sodium propionate", e282: "calcium propionate", e290: "carbon dioxide",
  e296: "malic acid", e297: "fumaric acid", e300: "ascorbic acid", e301: "sodium ascorbate",
  e302: "calcium ascorbate", e304: "fatty acid esters of ascorbic acid", e306: "tocopherol-rich extract", e307: "alpha-tocopherol",
  e310: "propyl gallate", e319: "tertiary-butylhydroquinone (tbhq)", e320: "butylated hydroxyanisole (bha)", e321: "butylated hydroxytoluene",
  e322: "lecithins", e325: "sodium lactate", e326: "potassium lactate", e327: "calcium lactate",
  e330: "citric acid", e331: "sodium citrates", e332: "potassium citrates", e333: "calcium citrates",
  e334: "l(+)-tartaric acid", e335: "sodium tartrates", e336: "potassium tartrates", e338: "phosphoric acid",
  e339: "sodium phosphates", e340: "potassium phosphates", e341: "calcium phosphates", e385: "calcium disodium ethylenediaminetetraacetate",
  e400: "alginic acid", e401: "sodium alginate", e402: "potassium alginate", e405: "propane-1‚2-diol alginate",
  e406: "agar", e407: "carrageenan", e410: "locust bean gum", e412: "guar gum",
  e413: "tragacanth", e414: "acacia gum", e415: "xanthan gum", e416: "karaya-gum",
  e417: "tara gum", e418: "gellan gum", e420: "sorbitol", e421: "mannitol",
  e422: "glycerol", e440: "pectins", e450: "diphosphates", e451: "triphosphates",
  e452: "polyphosphates", e460: "cellulose", e461: "methyl cellulose", e464: "hydroxypropyl methyl cellulose",
  e466: "sodium carboxy methyl cellulose", e470a: "sodium/potassium and calcium salts of fatty acids", e470b: "magnesium salts of fatty acids", e471: "mono- and diglycerides of fatty acids",
  e472a: "acetic acid esters of mono- and diglycerides of fatty acids", e472b: "lactic acid esters of mono- and diglycerides of fatty acids", e472c: "citric acid esters of mono- and diglycerides of fatty acids", e472e: "mono- and diacetyltartaric acid esters of mono- and diglycerides of fatty acids",
  e473: "sucrose esters of fatty acids", e475: "polyglycerol esters of fatty acids", e476: "polyglycerol polyricinoleate", e481: "sodium stearoyl-2-lactylate",
  e491: "sorbitan monostearate", e492: "sorbitan tristearate", e500: "sodium carbonates", e501: "potassium carbonates",
  e503: "ammonium carbonates", e504: "magnesium carbonates", e508: "potassium chloride", e509: "calcium chloride",
  e511: "magnesium chloride", e516: "calcium sulphate", e524: "sodium hydroxide", e551: "silicon dioxide",
  e552: "calcium silicate", e553: "magnesium silicates", e570: "fatty acids", e575: "glucono-delta-lactone",
  e620: "glutamic acid", e621: "monosodium glutamate", e627: "disodium guanylate", e631: "disodium inosinate",
  e635: "disodium 5'-ribonucleotide", e900: "dimethylpolysiloxane and methylphenylpolysiloxane", e901: "white and yellow beeswax", e903: "carnauba wax",
  e904: "shellac", e950: "acesulfame k", e951: "aspartame", e952: "cyclamic acid and its na and ca salts",
  e953: "isomalt", e954: "saccharin and its salts", e955: "sucralose", e957: "thaumatin",
  e960: "steviol glycosides", e961: "neotame", e962: "salt of aspartame-acesulfame", e965: "maltitol",
  e966: "lactitol", e967: "xylitol", e968: "erythritol", e1200: "polydextrose",
  e1400: "dextrin", e1404: "oxidised starch", e1410: "monostarch phosphate", e1412: "distarch phosphate",
  e1414: "acetylated distarch phosphate", e1420: "acetylated starch", e1422: "acetylated distarch adipate", e1440: "hydroxypropyl starch",
  e1442: "hydroxypropyl distarch phosphate", e1450: "starch sodium octenyl succinate", e1451: "acetylated oxidised starch", e1505: "triethyl citrate",
  e1518: "glyceryl triacetate", e1520: "propylene glycol",
};

/** 'en:e150d' or 'E-150d' → 'sulphite ammonia caramel (E150d)'. Returns undefined for anything that is not a known E number. */
export function eNumberName(code: string): string | undefined {
  const key = code.toLowerCase().replace(/^en:/, '').replace(/[\s-]/g, '');
  const name = E_NAMES[key] ?? E_NAMES[key.replace(/[ivx]+$/, '')];
  return name ? `${name} (${key.toUpperCase().replace(/^E(\d+)([A-Z]*)$/, (_, n, s) => `E${n}${s.toLowerCase()}`)})` : undefined;
}
