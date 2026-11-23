import { expect, test } from '@playwright/test';
import { audit, FULL_PROFILE, lookup, mockNetwork, open, seed } from './helpers';

test.beforeEach(async ({ page }) => {
  await mockNetwork(page);
});

test('first run: welcome → profile → home', async ({ page }, info) => {
  await open(page, info);
  await expect(page.locator('.welcome h1')).toBeVisible();
  await audit(page, info, '01-welcome');

  await page.locator('[data-action="onboard-start"]').click();
  await expect(page.locator('.title')).toHaveText('What should we watch for?');
  await audit(page, info, '02-onboarding-profile');

  await page.locator('.opt', { hasText: 'Peanuts' }).click();
  await page.locator('.opt', { hasText: 'Halal' }).click();
  await page.locator('.opt', { hasText: 'Diabetes' }).click();
  await page.locator('form[data-form="profile"] button[type=submit]').click();

  await expect(page.locator('.pill')).toHaveText(['peanut allergy', 'halal', 'diabetes']);
  await expect(page.locator('.nav')).toBeVisible();
  await audit(page, info, '03-home-first-time');

  // The profile really was saved.
  await page.reload();
  await expect(page.locator('.pill')).toHaveCount(3);
});

test('barcode → verdict → score, for each kind of answer', async ({ page }, info) => {
  await seed(page, { allergies: ['tree-nuts'], rules: [], watch: ['diabetes'], goal: 'none' });
  await open(page, info);

  await lookup(page, '3017620422003');
  await expect(page.locator('.verdict__title')).toHaveText('Not safe');
  await expect(page.locator('.verdict__reasons')).toContainText('tree nuts');
  await expect(page.locator('#score-num')).toHaveText('0');
  await expect(page.locator('.reasons')).toContainText('High sugar for your sugar watch');
  await expect(page.locator('.legal')).toContainText('Open Food Facts');
  await expect(page.locator('.legal')).toContainText('Not medical advice');
  await audit(page, info, '04-result-not-safe');

  await lookup(page, '8076800195057');
  await expect(page.locator('.verdict__title')).toHaveText('Safe for you');
  await expect(page.locator('#score-num')).toHaveText('90');
  await audit(page, info, '05-result-safe');

  await lookup(page, '2222222222222');
  await expect(page.locator('.verdict__title')).toHaveText('Can’t confirm');
  await expect(page.locator('.score__none')).toBeVisible();
  await audit(page, info, '06-result-no-data');

  // One tap to the next scan.
  await page.locator('[data-action="scan-next"]').click();
  await expect(page.locator('#barcode-input')).toBeVisible();
});

test('worst case: every profile option on, longest product', async ({ page }, info) => {
  await seed(page, FULL_PROFILE);
  await open(page, info);
  await audit(page, info, '07-home-full-profile');

  await lookup(page, '1111111111111');
  await expect(page.locator('.verdict__title')).toHaveText('Not safe');
  expect(await page.locator('.verdict__reasons li').count()).toBeGreaterThan(8);
  await audit(page, info, '08-result-worst-case');

  await page.locator('.nav__item[data-view="profile"]').click();
  await audit(page, info, '09-profile-full');
});

test('home with history, history filters, settings, key guide', async ({ page }, info) => {
  await seed(page, { allergies: ['milk'], rules: ['halal'], watch: [], goal: 'build-muscle' });
  await open(page, info);
  for (const code of ['3017620422003', '5449000000996', '8076800195057', '1111111111111']) {
    await lookup(page, code);
    await expect(page.locator('.verdict__title')).toBeVisible();
  }
  await page.locator('.nav__item[data-view="scan"]').click();
  await expect(page.locator('.stat__num').first()).toHaveText('4');
  await expect(page.locator('.recent .hist')).toHaveCount(3);
  await audit(page, info, '10-home-with-history');

  await page.locator('.nav__item[data-view="history"]').click();
  await expect(page.locator('.hist')).toHaveCount(4);
  await audit(page, info, '11-history');
  await page.locator('[data-action="history-filter"][data-filter="safe"]').click();
  await expect(page.locator('.hist')).toHaveCount(1);
  await page.locator('.hist').first().click();
  await expect(page.locator('.verdict__title')).toHaveText('Safe for you');

  await page.locator('.nav__item[data-view="settings"]').click();
  await audit(page, info, '12-settings');

  await page.locator('[data-action="nav"][data-view="key"]').click();
  await expect(page.locator('.steps li')).toHaveCount(4);
  await audit(page, info, '13-key-guide');

  // Deleting data really clears it.
  await page.locator('.nav__item[data-view="settings"]').click();
  await page.locator('[data-action="delete-all"]').click();
  await page.locator('[data-action="delete-all"]').click();
  expect(await page.evaluate(() => [localStorage.getItem('safescan.profile.v1'), localStorage.getItem('safescan.history.v1')])).toEqual([null, null]);
});

test('messages: not found, offline, bad input, no key', async ({ page }, info) => {
  await seed(page);
  await open(page, info);

  await lookup(page, '9999999999999');
  await expect(page.locator('.notice')).toContainText('Product not in the database');
  await audit(page, info, '14-not-found');

  await lookup(page, '4040404040404');
  await expect(page.locator('.notice')).toContainText('Can’t reach Open Food Facts');
  await audit(page, info, '15-offline-error');

  await lookup(page, '12');
  await expect(page.locator('.notice')).toContainText('doesn’t look like a barcode');

  // Demo products need no network at all.
  await page.locator('details.samples summary, .samples--open').first().click();
  await page.locator('[data-action="demo"]').first().click();
  await expect(page.locator('.verdict__title')).toBeVisible();
  await expect(page.locator('.legal')).toContainText('demo data');

  // No key → guide, and nothing is sent to Google.
  let googleCalls = 0;
  await page.route('https://generativelanguage.googleapis.com/**', (route) => { googleCalls++; return route.abort(); });
  await page.locator('.nav__item[data-view="scan"]').click();
  await page.locator('[data-action="photo"]').click();
  await expect(page.locator('.title')).toContainText('label photos');
  expect(googleCalls).toBe(0);
});

test('camera scan reads a barcode (on-device decoder)', async ({ page }, info) => {
  await seed(page);
  // A fake camera: a canvas showing a real EAN-13 barcode, handed to the app as the camera feed.
  await page.addInitScript(() => {
    const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
    const G = L.map((c) => [...c].reverse().map((b) => (b === '1' ? '0' : '1')).join(''));
    const R = L.map((c) => [...c].map((b) => (b === '1' ? '0' : '1')).join(''));
    const P = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
    const code = '5449000000996';
    const d = [...code].map(Number);
    let bits = '101';
    for (let i = 1; i <= 6; i++) bits += (P[d[0]][i - 1] === 'L' ? L : G)[d[i]];
    bits += '01010';
    for (let i = 7; i <= 12; i++) bits += R[d[i]];
    bits += '101';
    const fake = async () => {
      const c = document.createElement('canvas');
      c.width = 1280; c.height = 720;
      const ctx = c.getContext('2d')!;
      const draw = () => {
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.fillStyle = '#000';
        const m = 6, x0 = (c.width - bits.length * m) / 2;
        [...bits].forEach((b, i) => { if (b === '1') ctx.fillRect(x0 + i * m, 240, m, 240); });
      };
      draw(); setInterval(draw, 100);
      return c.captureStream(10);
    };
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: fake }, configurable: true });
    // Force the path iPhones use: no built-in barcode detector.
    Object.defineProperty(window, 'BarcodeDetector', { value: undefined, configurable: true });
  });
  await open(page, info);
  await page.locator('[data-action="scan-start"]').click();
  await expect(page.locator('.scanner')).toBeVisible();
  await audit(page, info, '16-scanner');
  await expect(page.locator('.product__name')).toHaveText('Coca-Cola Original', { timeout: 20_000 });
});

test('label photo with a key → verdict; key only goes to Google', async ({ page }, info) => {
  await seed(page, { allergies: [], rules: ['halal'], watch: ['diabetes'], goal: 'none' }, 'TEST-KEY-123');
  const seen: { host: string; key: string | undefined }[] = [];
  page.on('request', (r) => { const k = r.headers()['x-goog-api-key']; if (k || r.url().includes('TEST-KEY-123')) seen.push({ host: new URL(r.url()).host, key: k }); });
  await page.route('https://generativelanguage.googleapis.com/**', (route) =>
    route.fulfill({ json: { candidates: [{ content: { parts: [{ text: JSON.stringify({
      product_name: 'Gummy Sweets', ingredients_text: 'Glucose syrup, sugar, pork gelatine, citric acid',
      allergens: [], nutriments: { sugars: 52, salt: 0.05, saturated_fat: 0, fat: 0.2, protein: 6, fiber: null, kcal: 340 },
      contains_pork: true, contains_alcohol: false, contains_gelatin: true, halal_certified: null, kosher_certified: null,
    }) }] } }] } }),
  );
  await open(page, info);
  // a real (tiny) PNG, as if taken by the camera
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC', 'base64');
  await page.locator('#photo-input').setInputFiles({ name: 'label.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('.verdict__title')).toHaveText('Not safe', { timeout: 20_000 });
  await expect(page.locator('.verdict__reasons')).toContainText('pork');
  await expect(page.locator('.tag--photo')).toHaveText('From your label photo');
  await audit(page, info, '17-result-from-photo');
  expect(seen.length).toBeGreaterThan(0);
  expect(seen.every((s) => s.host === 'generativelanguage.googleapis.com')).toBe(true);
});
