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
  await expect(page.locator('.verdict__title')).toHaveText('Not for you');
  await expect(page.locator('.verdict__reasons')).toContainText('tree nuts');
  await expect(page.locator('#score-num')).toHaveText('0');
  await expect(page.locator('.reasons')).toContainText('High sugar for your sugar watch');
  await expect(page.locator('.legal')).toContainText('Open Food Facts');
  await expect(page.locator('.legal')).toContainText('Not medical advice');
  await audit(page, info, '04-result-not-safe');

  await lookup(page, '8076800195057');
  // An allergy is in the profile: the app reports what it checked and never promises "safe".
  await expect(page.locator('.verdict__title')).toHaveText('No allergens found');
  await expect(page.locator('.verdict__reasons')).toContainText('Tree nuts are not in the ingredient list');
  await expect(page.locator('.verdict__warning').first()).toContainText('read the pack every time');
  await expect(page.locator('.verdict__action')).toContainText('Check against my pack');
  await expect(page.locator('#score-num')).toHaveText('90');
  await audit(page, info, '05-result-safe');

  await lookup(page, '2222222222222');
  await expect(page.locator('.verdict__title')).toHaveText('Check the label');
  await expect(page.locator('.verdict__action')).toBeVisible();
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
  await expect(page.locator('.verdict__title')).toHaveText('Not for you');
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
  await expect(page.locator('.verdict__title')).toHaveText('No allergens found');

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
  await expect(page.locator('.title')).toContainText('AI extras');
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
  const aiRequests: string[] = [];
  await page.route('https://generativelanguage.googleapis.com/**', (route) => {
    const sent = route.request().postData() ?? '';
    if (!sent.includes('inline_data')) {
      aiRequests.push(sent);
      return route.fulfill({ json: { candidates: [{ content: { parts: [{ text: JSON.stringify({
        overview: 'Mostly sugar and glucose syrup set with gelatine. Very sweet, with little else nutritionally.',
        ingredients: [
          { name: 'Glucose syrup', what: 'A liquid sugar made from starch, used for sweetness and chewiness.', note: 'Counts as added sugar.' },
          { name: 'Citric acid', what: 'A common acid that adds sharpness and helps preserve.', note: null },
        ],
      }) }] } }] } });
    }
    return route.fulfill({ json: { candidates: [{ content: { parts: [{ text: JSON.stringify({
      product_name: 'Gummy Sweets', ingredients_text: 'Glucose syrup, sugar, pork gelatine, citric acid',
      allergens: [], nutriments: { sugars: 52, salt: 0.05, saturated_fat: 0, fat: 0.2, protein: 6, fiber: null, kcal: 340 },
      contains_pork: true, contains_alcohol: false, contains_gelatin: true, halal_certified: null, kosher_certified: null,
    }) }] } }] } });
  });
  await open(page, info);
  // a real (tiny) PNG, as if taken by the camera
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC', 'base64');
  const label = { name: 'label.png', mimeType: 'image/png', buffer: png };
  // Press the real button on the home screen and answer the file chooser it opens.
  let chooser = page.waitForEvent('filechooser');
  await page.locator('.view--scan [data-action="photo"]').click();
  await (await chooser).setFiles(label);
  await expect(page.locator('.verdict__title')).toHaveText('Not for you', { timeout: 20_000 });

  // AI explanation: one tap, clearly labelled, and the user's profile is NOT sent to Google.
  await page.locator('[data-action="ai-explain"]').click();
  await expect(page.locator('.ai')).toContainText('Glucose syrup', { timeout: 20_000 });
  await expect(page.locator('.ai')).toContainText('it can be wrong');
  expect(aiRequests).toHaveLength(1);
  expect(aiRequests[0]).toContain('Glucose syrup, sugar, pork gelatine');
  expect(aiRequests[0]).not.toMatch(/halal|diabetes|allerg/i);
  await audit(page, info, '18-result-with-ai-explanation');

  // The same button on the "label photos are on" screen must work too (it once did nothing).
  await page.locator('.nav__item[data-view="settings"]').click();
  await page.locator('[data-action="nav"][data-view="key"]').click();
  chooser = page.waitForEvent('filechooser');
  await page.locator('.view--key [data-action="photo"]').click();
  await (await chooser).setFiles(label);
  await expect(page.locator('.tag--photo')).toBeVisible({ timeout: 20_000 });

  // And the "choose a photo" alternative.
  await page.locator('.nav__item[data-view="scan"]').click();
  chooser = page.waitForEvent('filechooser');
  await page.locator('.view--scan [data-action="photo-library"]').click();
  await (await chooser).setFiles(label);
  await expect(page.locator('.verdict__title')).toHaveText('Not for you', { timeout: 20_000 });
  await expect(page.locator('.verdict__reasons')).toContainText('pork');
  await expect(page.locator('.tag--photo')).toHaveText('From your label photo');
  await audit(page, info, '17-result-from-photo');
  expect(seen.length).toBeGreaterThan(0);
  expect(seen.every((s) => s.host === 'generativelanguage.googleapis.com')).toBe(true);
});

test('family, pets, cosmetics, pet food and search by name', async ({ page }, info) => {
  await seed(page, { allergies: ['peanuts'], rules: [], watch: [], goal: 'none', skin: ['fragrance'] });
  await open(page, info);

  // Add a person with their own allergy.
  await page.locator('.nav__item[data-view="profile"]').click();
  await page.locator('[data-action="member-add"][data-kind="person"]').click();
  await page.locator('#member-name').fill('Aisha');
  await page.locator('.opt', { hasText: /^\s*Milk\s*$/ }).click();
  await page.locator('form[data-form="profile"] button[type=submit]').click();
  await expect(page.locator('.notice')).toContainText('Aisha saved');
  await audit(page, info, '20-family-person');

  // Add a pet: its own group, its own short form.
  await page.locator('[data-action="member-add"][data-kind="dog"]').click();
  await page.locator('#member-name').fill('Rex');
  await page.locator('form[data-form="profile"] button[type=submit]').click();
  await expect(page.locator('.members__group').nth(1)).toContainText('Rex');
  await audit(page, info, '21-family-pet');

  // It survives a reload.
  await page.reload();
  await page.locator('.nav__item[data-view="profile"]').click();
  await expect(page.locator('.members .chip', { hasText: 'Aisha' })).toBeVisible();

  // One food scan, checked for everyone. Nutella has milk (Aisha) and cocoa (Rex), but no peanuts.
  await lookup(page, '3017620422003');
  await expect(page.locator('.fam__row', { hasText: 'Aisha' })).toContainText('Not suitable');
  await expect(page.locator('.fam__row', { hasText: 'Rex (dog)' })).toContainText('Not suitable');
  await expect(page.locator('.fam__row', { hasText: 'Rex (dog)' })).toContainText('chocolate');
  await audit(page, info, '22-result-family');

  // Cosmetics: found in the beauty database, no score, flagged ingredients with sources.
  await lookup(page, '3600000000017');
  await expect(page.locator('.verdict__title')).toHaveText('Not for you');
  await expect(page.locator('.verdict__reasons')).toContainText('fragrance allergy');
  await expect(page.locator('#score-num')).toHaveCount(0);
  await expect(page.locator('.notable')).toContainText('Lilial');
  await expect(page.locator('.notable')).toContainText('EU Regulation 2021/1902');
  // The source is a link to the rule itself, not just a name.
  await expect(page.locator('.notable a[href="https://eur-lex.europa.eu/eli/reg/2021/1902/oj"]').first()).toBeVisible();
  await expect(page.locator('.legal a[href="./how.html"]')).toBeVisible();
  await expect(page.locator('.legal')).toContainText('not a judgement of the product or its maker');
  await expect(page.locator('.legal')).toContainText('Open Beauty Facts');
  await audit(page, info, '23-result-cosmetics');

  // Pet food: judged for the pet, not the person.
  await lookup(page, '7600000000012');
  await expect(page.locator('.verdict__title')).toHaveText('No toxins found');
  await expect(page.locator('.legal')).toContainText('Not veterinary advice');
  await expect(page.locator('.legal')).toContainText('Open Pet Food Facts');
  await audit(page, info, '24-result-petfood');

  // Search by name: one list across food, cosmetics and pet food; tapping a hit runs the normal check.
  await lookup(page, 'cream');
  await expect(page.locator('.search .hist')).toHaveCount(3);
  await audit(page, info, '25-search-results');
  await page.locator('.search .hist', { hasText: 'Radiance Night Cream' }).click();
  await expect(page.locator('.product__name')).toHaveText('Radiance Night Cream');

  await lookup(page, 'zzzz');
  await expect(page.locator('.notice')).toContainText('Nothing found');

  // Removing a member works.
  await page.locator('.nav__item[data-view="profile"]').click();
  await page.locator('.members .chip', { hasText: 'Rex' }).click();
  await page.locator('[data-action="member-remove"]').click();
  await expect(page.locator('.members .chip', { hasText: 'Rex' })).toHaveCount(0);
});


/**
 * The complaint that fills other scanner apps' reviews: "scans one item, then I have to close the
 * app to scan the next". These tests scan product after product without ever reloading.
 */
const fakeCamera = () => {
  const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
  const G = L.map((c) => [...c].reverse().map((b) => (b === '1' ? '0' : '1')).join(''));
  const R = L.map((c) => [...c].map((b) => (b === '1' ? '0' : '1')).join(''));
  const P = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
  const w = window as any;
  w.__bits = '';
  w.__streams = [];
  w.__hang = false;
  w.__setCode = (code: string) => {
    if (!code) { w.__bits = ''; return; }
    const d = [...code].map(Number);
    let bits = '101';
    for (let i = 1; i <= 6; i++) bits += (P[d[0]][i - 1] === 'L' ? L : G)[d[i]];
    bits += '01010';
    for (let i = 7; i <= 12; i++) bits += R[d[i]];
    w.__bits = bits + '101';
  };
  const fake = () => {
    if (w.__hang) return new Promise(() => undefined); // a camera that never answers
    const c = document.createElement('canvas');
    c.width = 1280; c.height = 720;
    const ctx = c.getContext('2d')!;
    let n = 0;
    const draw = () => {
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, 4, 4 + (n++ % 2)); // keeps the picture changing, like a real camera
      const bits: string = w.__bits;
      const m = 6, x0 = (c.width - bits.length * m) / 2;
      [...bits].forEach((b, i) => { if (b === '1') ctx.fillRect(x0 + i * m, 240, m, 240); });
    };
    draw(); setInterval(draw, 100);
    const stream = c.captureStream(10);
    w.__streams.push(stream);
    return Promise.resolve(stream);
  };
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: fake }, configurable: true });
  Object.defineProperty(window, 'BarcodeDetector', { value: undefined, configurable: true });
};
const camerasStillOn = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as any).__streams.filter((s: MediaStream) => s.getTracks().some((t) => t.readyState === 'live')).length);

test('scanner: four products in a row, no restart needed, camera released every time', async ({ page }, info) => {
  await seed(page);
  await page.addInitScript(fakeCamera);
  await open(page, info);

  const scan = async (code: string, name: string, how: 'scan-start' | 'scan-next') => {
    await page.evaluate((c) => (window as any).__setCode(c), code);
    await page.locator(`[data-action="${how}"]`).click();
    await expect(page.locator('.product__name')).toHaveText(name, { timeout: 20_000 });
    expect(await camerasStillOn(page), 'camera must be released after a scan').toBe(0);
  };
  await scan('5449000000996', 'Coca-Cola Original', 'scan-start');
  await scan('3017620422003', 'Nutella', 'scan-next');
  await scan('8076800195057', 'Spaghetti Nº5', 'scan-next');
  await scan('5449000000996', 'Coca-Cola Original', 'scan-next'); // the same product again
  expect(await page.evaluate(() => (window as any).__streams.length)).toBe(4); // a fresh camera each time
});

test('scanner: survives the screen being redrawn mid-scan, and cancel then scan again works', async ({ page }, info) => {
  await seed(page);
  await page.addInitScript(fakeCamera);
  await open(page, info);

  // A slow answer that lands mid-scan: ask for others on the shelf, then tap "Scan next" before it arrives.
  await page.route('https://world.openfoodfacts.org/api/v2/search**', async (route) => {
    await new Promise((r) => setTimeout(r, 2500));
    await route.fulfill({ json: { products: [] } });
  });
  await lookup(page, '3017620422003');
  await page.locator('[data-action="alts-load"]').click();
  await page.locator('[data-action="scan-next"]').click();
  await expect(page.locator('.scanner')).toBeVisible();
  const firstBox = await page.locator('#scan-video').elementHandle();
  // The answer arrives and the app redraws: the video box on screen is now a different one.
  await expect.poll(() => page.evaluate((old) => document.getElementById('scan-video') !== old, firstBox), { timeout: 15_000 }).toBe(true);
  await expect(page.locator('.scanner')).toBeVisible();
  // The live picture must have moved into the NEW box, or the scan can never finish.
  // Checked straight away: a viewfinder that goes black for seconds is a broken scanner to the person holding it.
  await expect.poll(() => page.evaluate(() => !!(document.getElementById('scan-video') as HTMLVideoElement)?.srcObject), { timeout: 1500 }).toBe(true);
  await page.evaluate(() => (window as any).__setCode('5449000000996'));
  await expect(page.locator('.product__name')).toHaveText('Coca-Cola Original', { timeout: 20_000 });
  expect(await camerasStillOn(page)).toBe(0);

  // Cancel half-way, then scan again straight away.
  await page.evaluate(() => (window as any).__setCode(''));
  await page.locator('[data-action="scan-next"]').click();
  await expect(page.locator('.scanner')).toBeVisible();
  await page.locator('[data-action="scan-stop"]').click();
  await expect(page.locator('.scanner')).toHaveCount(0);
  expect(await camerasStillOn(page)).toBe(0);
  await page.evaluate(() => (window as any).__setCode('8076800195057'));
  await page.locator('[data-action="scan-start"]').click();
  await expect(page.locator('.product__name')).toHaveText('Spaghetti Nº5', { timeout: 20_000 });
});

test('scanner: a slow read offers help, and a camera that never answers does not hang the app', async ({ page }, info) => {
  await seed(page);
  await page.addInitScript(fakeCamera);
  await open(page, info);

  // Nothing readable in view: after a few seconds the app offers a way out instead of sitting there.
  await page.locator('[data-action="scan-start"]').click();
  await expect(page.locator('#scan-help')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#scan-help-text')).toContainText('Not reading it?');
  await audit(page, info, '23-scanner-help');
  await page.locator('[data-action="scan-type"]').click();
  await expect(page.locator('.scanner')).toHaveCount(0);
  await expect(page.locator('#barcode-input')).toBeFocused();
  expect(await camerasStillOn(page)).toBe(0);

  // The camera never answers at all.
  await page.evaluate(() => { (window as any).__hang = true; });
  await page.locator('[data-action="scan-start"]').click();
  await expect(page.locator('.notice')).toContainText('The camera didn’t open', { timeout: 15_000 });
  await expect(page.locator('.scanner')).toHaveCount(0);

  // And the very next scan works.
  await page.evaluate(() => { (window as any).__hang = false; (window as any).__setCode('8076800195057'); });
  await page.locator('[data-action="scan-start"]').click();
  await expect(page.locator('.product__name')).toHaveText('Spaghetti Nº5', { timeout: 20_000 });
});
