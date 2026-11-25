// Store screenshots, made from the running app with invented products (no real brands).
// Usage: npm run dev (port 5174), then: node store/make-screenshots.mjs
import { chromium } from '@playwright/test';

const BASE = process.env.APP_URL ?? 'http://localhost:5174/';
const TARGETS = [
  { dir: 'store/app-store-screenshots', width: 430, height: 932, scale: 3 }, // 1290 x 2796
  { dir: 'store/screenshots', width: 400, height: 800, scale: 3 }, // 1200 x 2400
];

const art = (body, bg = '#f4efe6') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect width="400" height="400" fill="${bg}"/>${body}</svg>`;
const IMAGES = {
  'spread.svg': art('<rect x="120" y="60" width="160" height="46" rx="10" fill="#f2f2f2" stroke="#c9c9c9" stroke-width="4"/><path d="M110 110h180v200a30 30 0 0 1-30 30H140a30 30 0 0 1-30-30z" fill="#5b3418"/><rect x="110" y="170" width="180" height="96" fill="#e8432b"/><text x="200" y="232" text-anchor="middle" font-family="Georgia" font-weight="700" font-size="40" fill="#fff">Choco</text>'),
  'cola.svg': art('<rect x="150" y="40" width="100" height="320" rx="28" fill="#c8202a"/><rect x="150" y="150" width="100" height="90" fill="#fff"/><text x="200" y="208" text-anchor="middle" font-family="Georgia" font-weight="700" font-size="34" fill="#c8202a">Cola</text><rect x="165" y="40" width="70" height="16" rx="6" fill="#d9d9d9"/>'),
  'cream.svg': art('<rect x="100" y="150" width="200" height="170" rx="26" fill="#fff" stroke="#d6cfc2" stroke-width="5"/><rect x="92" y="110" width="216" height="56" rx="14" fill="#c9a86a"/><text x="200" y="250" text-anchor="middle" font-family="Georgia" font-size="30" fill="#7a6a4a">Night</text>'),
  'vitamins.svg': art('<rect x="130" y="120" width="140" height="210" rx="22" fill="#fff" stroke="#d6cfc2" stroke-width="5"/><rect x="140" y="70" width="120" height="60" rx="12" fill="#0f8a43"/><rect x="130" y="190" width="140" height="80" fill="#ffd23f"/><text x="200" y="244" text-anchor="middle" font-family="Georgia" font-weight="700" font-size="34" fill="#1d1a14">D+</text>'),
  'oats.svg': art('<path d="M120 70h160l14 260a20 20 0 0 1-20 20H126a20 20 0 0 1-20-20z" fill="#e9d7ae"/><rect x="118" y="160" width="164" height="90" fill="#0f8a43"/><text x="200" y="220" text-anchor="middle" font-family="Georgia" font-weight="700" font-size="40" fill="#fff">Oats</text>'),
};
const img = (name) => `https://images.openfoodfacts.org/demo/${name}`;

const FOOD = {
  1000000000016: {
    product_name: 'Hazelnut Cocoa Spread', brands: 'Sunny Farm', image_small_url: img('spread.svg'), image_front_url: img('spread.svg'), lc: 'en',
    ingredients_text: 'Sugar, palm oil, hazelnuts (13%), skimmed milk powder (8.7%), fat-reduced cocoa (7.4%), emulsifier (soya lecithin), vanillin',
    allergens_tags: ['en:milk', 'en:nuts', 'en:soybeans'], traces_tags: [], labels_tags: [], nutriscore_grade: 'e', nova_group: 4,
    categories_tags: ['en:spreads', 'en:sweet-spreads', 'en:hazelnut-spreads'], countries_tags: ['en:united-kingdom'], unique_scans_n: 900, last_image_t: 1790000000, ingredients_n: 7, unknown_ingredients_n: 0,
    nutriments: { sugars_100g: 56.3, salt_100g: 0.11, 'saturated-fat_100g': 10.6, fat_100g: 30.9, proteins_100g: 6.3, carbohydrates_100g: 57.5, fiber_100g: 3.4, 'energy-kcal_100g': 539 },
  },
  1000000000023: {
    product_name: 'Orchard Cola', brands: 'Fizz & Co', image_small_url: img('cola.svg'), image_front_url: img('cola.svg'), lc: 'en',
    ingredients_text: 'Carbonated water, sugar, colour (caramel E150d), phosphoric acid, natural flavourings including caffeine',
    allergens_tags: [], traces_tags: [], labels_tags: [], nutriscore_grade: 'e', nova_group: 4,
    categories_tags: ['en:beverages', 'en:carbonated-drinks', 'en:sodas', 'en:colas'], countries_tags: ['en:united-kingdom'], unique_scans_n: 1200, last_image_t: 1790000000, ingredients_n: 6, unknown_ingredients_n: 0,
    nutriments: { sugars_100g: 10.6, salt_100g: 0, fat_100g: 0, 'saturated-fat_100g': 0, proteins_100g: 0, carbohydrates_100g: 10.6, 'energy-kcal_100g': 42 },
  },
  1000000000030: {
    product_name: 'Whole Rolled Oats', brands: 'Mill Lane', image_small_url: img('oats.svg'), image_front_url: img('oats.svg'), lc: 'en',
    ingredients_text: '100% whole grain rolled oats', allergens_tags: [], traces_tags: [], labels_tags: [], nutriscore_grade: 'a', nova_group: 1,
    categories_tags: ['en:cereals-and-their-products', 'en:breakfast-cereals', 'en:rolled-oats'], countries_tags: ['en:united-kingdom'], unique_scans_n: 700, last_image_t: 1790000000, ingredients_n: 1, unknown_ingredients_n: 0,
    nutriments: { sugars_100g: 1, salt_100g: 0.01, 'saturated-fat_100g': 1.3, fat_100g: 7, proteins_100g: 13, fiber_100g: 10, carbohydrates_100g: 60, 'energy-kcal_100g': 375 },
  },
};
const BEAUTY = {
  2000000000015: {
    product_name: 'Radiance Night Cream', brands: 'Lumen', image_small_url: img('cream.svg'), image_front_url: img('cream.svg'), lc: 'en',
    ingredients_text: 'Aqua, Glycerin, Cetearyl Alcohol, Dimethicone, Butyrospermum Parkii Butter, Niacinamide, Parfum, Butylphenyl Methylpropional, Limonene, Linalool, Methylparaben, Phenoxyethanol, Tocopherol',
    allergens_tags: [], traces_tags: [], labels_tags: [], categories_tags: ['en:face-creams'], last_image_t: 1790000000, ingredients_n: 13, unknown_ingredients_n: 0,
  },
};
const DSLD_LABEL = {
  fullName: 'Daily Multi with Vitamin D', brandName: 'Wellspring', upcSku: '0 12345 67890 5', thumbnail: null,
  servingSizes: [{ minQuantity: 2, unit: 'Capsule(s)', maxDailyServings: 1 }],
  ingredientRows: [
    { name: 'Vitamin D3 (as cholecalciferol)', quantity: [{ servingSizeOrder: 1, quantity: 125, unit: 'mcg' }] },
    { name: 'Zinc (as zinc citrate)', quantity: [{ servingSizeOrder: 1, quantity: 25, unit: 'mg' }] },
    { name: 'Vitamin C (as ascorbic acid)', quantity: [{ servingSizeOrder: 1, quantity: 500, unit: 'mg' }] },
    { name: 'Vitamin B6 (as pyridoxine HCl)', quantity: [{ servingSizeOrder: 1, quantity: 10, unit: 'mg' }] },
    { name: 'Magnesium (as magnesium citrate)', quantity: [{ servingSizeOrder: 1, quantity: 100, unit: 'mg' }] },
    { name: 'Selenium', quantity: [{ servingSizeOrder: 1, quantity: 55, unit: 'mcg' }] },
  ],
  otheringredients: { ingredients: [{ name: 'Vegetable Cellulose (capsule)' }, { name: 'Rice Flour' }, { name: 'Magnesium Stearate' }] },
  statements: [],
};
const SUPP_CODE = '012345678905';

const none = { allergies: [], rules: [], watch: [], goal: 'none', skin: [] };
const STATE = {
  'safescan.flags.v1': { onboarded: true, installDismissed: true, aiTipDismissed: true },
  'safescan.profile.v1': { ...none, allergies: ['milk'], watch: ['diabetes'], skin: ['fragrance'] },
  'safescan.family.v1': [
    { id: 'm1', name: 'Aisha', kind: 'person', age: '4-8', profile: { ...none, allergies: ['peanuts'] } },
    { id: 'm2', name: 'Baby Leo', kind: 'person', age: 'under1', profile: none },
    { id: 'm3', name: 'Rex', kind: 'dog', profile: none },
  ],
  'safescan.stats.v1': { scans: 42, caught: 7 },
};

async function mock(page) {
  const product = (table) => (route) => {
    const code = /product\/(\d+)\.json/.exec(route.request().url())?.[1];
    const p = code && table[Number(code)];
    return p ? route.fulfill({ json: { status: 1, product: { code, ...p } } }) : route.fulfill({ status: 404, json: { status: 0 } });
  };
  await page.route('https://world.openfoodfacts.org/**', product(FOOD));
  await page.route('https://world.openbeautyfacts.org/**', product(BEAUTY));
  await page.route('https://world.openpetfoodfacts.org/**', product({}));
  await page.route('https://search.openfoodfacts.org/**', (r) => r.fulfill({ json: { hits: [] } }));
  await page.route('https://api.nal.usda.gov/**', (r) => r.fulfill({ json: { foods: [] } }));
  await page.route('https://api.fda.gov/**', (r) => r.fulfill({ status: 404, json: {} }));
  await page.route('https://api.ods.od.nih.gov/dsld/v9/search-filter**', (r) => r.fulfill({ json: { hits: [{ _id: '1', _source: { offMarket: '0', entryDate: '2026-01-01' } }] } }));
  await page.route('https://api.ods.od.nih.gov/dsld/v9/label/**', (r) => r.fulfill({ json: DSLD_LABEL }));
  await page.route('https://images.openfoodfacts.org/**', (r) => {
    const name = r.request().url().split('/').pop();
    return r.fulfill({ status: IMAGES[name] ? 200 : 404, contentType: 'image/svg+xml', headers: { 'access-control-allow-origin': '*' }, body: IMAGES[name] ?? '' });
  });
}

const browser = await chromium.launch();
for (const t of TARGETS) {
  const ctx = await browser.newContext({ viewport: { width: t.width, height: t.height }, deviceScaleFactor: t.scale, locale: 'en-GB', reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await mock(page);
  await page.addInitScript((state) => {
    if (localStorage.getItem('safescan.flags.v1')) return;
    for (const [k, v] of Object.entries(state)) localStorage.setItem(k, JSON.stringify(v));
  }, STATE);

  const scan = async (code) => {
    await page.goto(BASE);
    await page.fill('#barcode-input', String(code));
    await page.click('form.manual button[type=submit]');
    await page.locator('.verdict__title').waitFor({ timeout: 20000 });
    await page.waitForTimeout(1200); // photo cut-out and score meter settle
  };
  const shot = async (name, scrollTo) => {
    if (scrollTo) await page.locator(scrollTo).first().evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 86));
    else await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${t.dir}/${name}.png` });
  };

  // History first, so the home screen shows real recent scans.
  await scan(1000000000030);
  await scan(1000000000023);
  await scan(2000000000015);
  await scan(1000000000016);
  await shot('2-family'); // one scan, an answer for everyone at home
  await scan(1000000000023);
  await shot('3-not-ideal');
  await shot('3b-score', '.card:has(#score-num)');
  await scan(2000000000015);
  await shot('4-cosmetics', '.card:has(.notable)');
  await scan(SUPP_CODE);
  await shot('5-supplement', '.card:has(.doses)');
  await page.goto(BASE);
  await page.waitForTimeout(600);
  await shot('1-home');
  await page.locator('.nav__item[data-view="profile"]').click();
  await page.waitForTimeout(500);
  await shot('6-profile');
  console.log(`${t.dir}: done`);
  await ctx.close();
}
await browser.close();
