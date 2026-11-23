import { expect, type Page, type TestInfo } from '@playwright/test';

/** Canned Open Food Facts answers, so tests are repeatable and don't hammer the real service. */
const PRODUCTS: Record<string, object> = {
  '3017620422003': {
    product_name: 'Nutella', brands: 'Ferrero', image_small_url: 'https://images.openfoodfacts.org/tall.svg',
    ingredients_text: 'Sucre, huile de palme, NOISETTES 13%, cacao maigre, LAIT écrémé en poudre, lactosérum, lécithines (SOJA), vanilline. Sans gluten.',
    ingredients_text_en: 'sugar, palm oil', allergens_tags: ['en:milk', 'en:nuts', 'en:soybeans'], traces_tags: [], labels_tags: ['en:vegetarian'],
    nutriscore_grade: 'e', nova_group: 4,
    nutriments: { sugars_100g: 56.3, salt_100g: 0.107, 'saturated-fat_100g': 10.6, fat_100g: 30.9, proteins_100g: 6.3, 'energy-kcal_100g': 539 },
  },
  '5449000000996': {
    product_name: 'Coca-Cola Original', brands: 'Coca-Cola', image_small_url: 'https://images.openfoodfacts.org/tall.svg',
    ingredients_text: 'Carbonated water, sugar, colour (caramel E150d), phosphoric acid, natural flavourings including caffeine',
    allergens_tags: [], traces_tags: [], labels_tags: [], nutriscore_grade: 'e', nova_group: 4,
    nutriments: { sugars_100g: 10.9, salt_100g: 0, fat_100g: 0, proteins_100g: 0, 'energy-kcal_100g': 44 },
  },
  '8076800195057': {
    product_name: 'Spaghetti Nº5', brands: 'Barilla', image_small_url: 'https://images.openfoodfacts.org/wide.svg',
    ingredients_text: 'Durum wheat semolina, water', allergens_tags: ['en:gluten'], traces_tags: ['en:eggs'], labels_tags: ['en:halal', 'en:vegetarian'],
    nutriscore_grade: 'a', nova_group: 1,
    nutriments: { sugars_100g: 3.5, salt_100g: 0.01, fat_100g: 2, proteins_100g: 13, fiber_100g: 3, 'energy-kcal_100g': 359 },
  },
  // Worst case for layout: very long names, every allergen, lots of reasons, big numbers.
  '1111111111111': {
    product_name: 'Extraordinarily Long Product Name Organic Wholegrain Crunchy Peanut-Butter & Hazelnut Chocolate Cookies Family Sharing Pack',
    brands: 'Supercalifragilistic Wholesome Family Bakery International', image_small_url: 'https://images.openfoodfacts.org/tall.svg',
    ingredients_text: 'Wheat flour, sugar, peanuts, hazelnuts, butter (milk), egg, soy lecithin, sesame, pork gelatine, rum, anchovy extract, shrimp powder, salt. May contain traces of fish.',
    allergens_tags: ['en:peanuts', 'en:nuts', 'en:milk', 'en:eggs', 'en:soybeans', 'en:gluten', 'en:sesame-seeds'], traces_tags: ['en:fish'], labels_tags: [],
    nutriscore_grade: 'e', nova_group: 4,
    nutriments: { sugars_100g: 38.25, salt_100g: 2.75, 'saturated-fat_100g': 14.5, fat_100g: 128.75, proteins_100g: 108.25, 'energy-kcal_100g': 1540 },
  },
  // Product exists but has no data at all.
  '2222222222222': { product_name: 'Mystery Snack' },
};

const svg = (w: number, h: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#e8432b"/></svg>`;

export async function mockNetwork(page: Page) {
  await page.route('https://world.openfoodfacts.org/**', (route) => {
    const code = /product\/(\d+)\.json/.exec(route.request().url())?.[1] ?? '';
    if (code === '4040404040404') return route.abort('internetdisconnected');
    const product = PRODUCTS[code];
    return product
      ? route.fulfill({ json: { code, status: 1, product } })
      : route.fulfill({ status: 404, json: { code, status: 0 } });
  });
  await page.route('https://images.openfoodfacts.org/**', (route) =>
    route.fulfill({ contentType: 'image/svg+xml', body: route.request().url().includes('tall') ? svg(75, 200) : svg(200, 60) }),
  );
}

export const FULL_PROFILE = {
  allergies: ['peanuts', 'tree-nuts', 'milk', 'egg', 'soy', 'gluten', 'fish', 'shellfish', 'sesame', 'celery', 'mustard', 'lupin', 'sulphites'],
  rules: ['halal', 'kosher', 'vegan', 'vegetarian', 'pregnancy', 'celiac', 'lactose'],
  watch: ['diabetes', 'low-sugar', 'low-salt', 'cholesterol', 'low-carb', 'no-palm-oil', 'no-added-sugar', 'no-sweeteners', 'no-additives', 'no-caffeine'],
  goal: 'lose-weight',
};

/** Start as a returning user (skips the welcome screen). */
export async function seed(page: Page, profile: object = { allergies: [], rules: [], watch: [], goal: 'none' }, geminiKey = '') {
  await page.addInitScript(
    ([p, k]) => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('safescan.profile.v1', p);
      localStorage.setItem('safescan.flags.v1', JSON.stringify({ onboarded: true, installDismissed: true }));
      if (k) localStorage.setItem('safescan.geminiKey', k);
    },
    [JSON.stringify(profile), geminiKey] as const,
  );
}

export async function open(page: Page, testInfo: TestInfo) {
  await page.goto('./');
  if (testInfo.project.metadata.largeText) {
    // Simulates a user who has turned text size up in their phone settings.
    await page.evaluate(() => (document.documentElement.style.fontSize = '130%'));
  }
  await page.evaluate(() => document.fonts.ready);
}

export async function lookup(page: Page, barcode: string) {
  await page.locator('.nav__item[data-view="scan"]').click();
  await page.locator('#barcode-input').fill(barcode);
  await page.locator('form[data-form="barcode"] button[type=submit]').click();
}

/**
 * The layout audit. Runs on whatever screen is showing and returns a list of
 * problems in plain words. An empty list means the screen fits this device.
 */
export async function audit(page: Page, testInfo: TestInfo, screen: string) {
  await page.waitForTimeout(700); // let entrance animations finish
  const issues = await page.evaluate(() => {
    const out: string[] = [];
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const name = (el: Element) => {
      const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 32);
      return `<${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''}> "${text}"`;
    };
    const visible = (el: Element) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
    };
    const decorative = '.hero__art, .verdict__art, .welcome__mark, .scanner';

    if (document.documentElement.scrollWidth > vw + 1) out.push(`page scrolls sideways (${document.documentElement.scrollWidth}px wide on a ${vw}px screen)`);

    for (const el of document.querySelectorAll('#app *')) {
      if (!visible(el) || el.closest(decorative)) continue;
      const r = el.getBoundingClientRect();
      if (r.right > vw + 1 || r.left < -1) out.push(`sticks out of the screen: ${name(el)}`);
      const cs = getComputedStyle(el);
      const clipsX = cs.overflowX !== 'visible';
      if (clipsX && cs.textOverflow !== 'ellipsis' && el.scrollWidth > el.clientWidth + 1 && !el.matches('.view, #app, input, .btn--scan, .verdict, .welcome__mark'))
        out.push(`content cut off sideways: ${name(el)}`);
      // a child poking out of its parent box (how the overflowing photo bug looked)
      if (el.matches('img')) {
        const pr = el.parentElement!.getBoundingClientRect();
        if (r.bottom > pr.bottom + 6 || r.top < pr.top - 6 || r.right > pr.right + 6 || r.left < pr.left - 6) out.push(`image spills out of its box: ${name(el.parentElement!)}`);
      }
    }

    // Tap targets: 44px is Apple's minimum, 48dp Android's. Text links get the looser 24px rule.
    for (const el of document.querySelectorAll('.btn, .chip, .tile, .nav__item, .hist, .opt, input[type=text], input[type=password], input:not([type])')) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.height < 40 || r.width < 40) out.push(`tap target too small (${Math.round(r.width)}×${Math.round(r.height)}): ${name(el)}`);
    }
    for (const el of document.querySelectorAll('.link')) {
      if (!visible(el)) continue;
      if (el.getBoundingClientRect().height < 24) out.push(`link too small to tap: ${name(el)}`);
    }

    // Decorative shapes must not sit on top of words.
    const hits = (a: DOMRect, b: DOMRect) => a.left < b.right - 2 && a.right > b.left + 2 && a.top < b.bottom - 2 && a.bottom > b.top + 2;
    const textRect = (el: Element) => { const range = document.createRange(); range.selectNodeContents(el); return range.getBoundingClientRect(); };
    const hero = document.querySelector('.btn--scan');
    if (hero) for (const t of hero.querySelectorAll('.hero__title, small, .hero__cta')) for (const s of hero.querySelectorAll('.hero__art > *')) {
      if (hits(textRect(t), s.getBoundingClientRect())) out.push(`shape overlaps text in the scan block: ${name(t)}`);
    }
    const img = document.querySelector('.verdict__img');
    const title = document.querySelector('.verdict__title');
    if (img && title && hits(textRect(title), img.getBoundingClientRect())) out.push('product photo overlaps the verdict title');
    const icon = document.querySelector('.verdict__icon');
    if (img && icon && hits(icon.getBoundingClientRect(), img.getBoundingClientRect())) out.push('product photo overlaps the verdict icon');

    // The tab bar and the pinned button must stay on screen and not cover each other.
    const nav = document.querySelector('.nav');
    const bar = [...document.querySelectorAll('.actionbar .btn')].find(visible);
    if (nav && visible(nav)) {
      const n = nav.getBoundingClientRect();
      if (n.bottom > vh + 1 || n.top < 0) out.push('tab bar is partly off screen');
      if (bar && hits(bar.getBoundingClientRect(), n)) out.push('pinned button and tab bar overlap');
    }
    if (bar) { const b = bar.getBoundingClientRect(); if (b.bottom > vh + 1) out.push('pinned button is off the bottom of the screen'); }

    // Light theme only.
    const bg = getComputedStyle(document.getElementById('app')!).backgroundColor;
    if (bg !== 'rgb(255, 247, 232)') out.push(`background is not the light theme colour (${bg})`);
    return out;
  });

  // Everything must be reachable: scroll to the end and check the last item clears the pinned bars.
  const covered = await page.evaluate(async () => {
    const view = document.querySelector('.view') as HTMLElement;
    const scroller = view.scrollHeight > view.clientHeight + 2 && getComputedStyle(view).overflowY !== 'visible' ? view : document.scrollingElement!;
    scroller.scrollTop = scroller.scrollHeight;
    await new Promise((r) => setTimeout(r, 150));
    const kids = [...view.children].filter((c) => !c.matches('.actionbar, input[hidden]') && (c as HTMLElement).offsetHeight > 0);
    const form = view.querySelector('form[data-form="profile"]');
    const last = (form ? [...form.children].filter((c) => !c.matches('.actionbar')).pop() : kids.pop()) as HTMLElement | undefined;
    const pinned = [...document.querySelectorAll('.actionbar .btn, .nav')].filter((e) => (e as HTMLElement).offsetHeight > 0);
    const top = Math.min(...pinned.map((e) => e.getBoundingClientRect().top), window.innerHeight);
    const result = last && last.getBoundingClientRect().bottom > top + 1 ? `last item on the screen is hidden behind the pinned bar (${Math.round(last.getBoundingClientRect().bottom - top)}px covered)` : null;
    scroller.scrollTop = 0;
    return result;
  });
  if (covered) issues.push(covered);

  await page.screenshot({ path: `e2e-results/screens/${testInfo.project.name}/${screen}.png`, fullPage: true });
  expect.soft(issues, `${screen} on ${testInfo.project.name}`).toEqual([]);
}
