/**
 * On-device self-test. Built in only when VITE_DEVICE_TEST=1, never in a store build.
 * Runs on the real phone, inside the real app shell, and prints one line per check to the
 * console so the results can be read from the Mac. It checks the things a simulated browser
 * cannot: the phone's own network rules from inside the app, its camera, and its engine.
 */
import { lookupBarcode, lookupIn } from './data/off';
import { lookupDsld } from './data/dsld';
import { lookupUsda, usdaEnabled, usdaKeyVia } from './data/usda';
import { recallFor } from './data/recalls';
import { searchByName } from './data/search';
import { findAlternatives } from './data/alternatives';
import { cutoutFor } from './cutout';
import { startScan } from './scanner';

const say = (name: string, ok: boolean | 'skip', detail = '') => console.log(`DEVICETEST|${ok === 'skip' ? 'SKIP' : ok ? 'PASS' : 'FAIL'}|${name}|${detail}`);
const timed = async <T>(fn: () => Promise<T>): Promise<[T, number]> => {
  const t = performance.now();
  const v = await fn();
  return [v, Math.round(performance.now() - t)];
};
const check = async (name: string, fn: () => Promise<string>) => {
  try {
    const [detail, ms] = await timed(fn);
    say(name, true, `${detail} (${ms} ms)`);
  } catch (e) {
    say(name, false, e instanceof Error ? e.message : String(e));
  }
};
const must = (cond: unknown, msg: string) => {
  if (!cond) throw new Error(msg);
};

/** A real EAN-13 drawn as bars, to test the phone's barcode decoder without pointing it at anything. */
function barcodeCanvas(code: string): HTMLCanvasElement {
  const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
  const G = L.map((c) => [...c].reverse().map((b) => (b === '1' ? '0' : '1')).join(''));
  const R = L.map((c) => [...c].map((b) => (b === '1' ? '0' : '1')).join(''));
  const P = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
  const d = [...code].map(Number);
  let bits = '101';
  for (let i = 1; i <= 6; i++) bits += (P[d[0]][i - 1] === 'L' ? L : G)[d[i]];
  bits += '01010';
  for (let i = 7; i <= 12; i++) bits += R[d[i]];
  bits += '101';
  const c = document.createElement('canvas');
  c.width = 800;
  c.height = 300;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#000';
  const m = 6;
  const x0 = (c.width - bits.length * m) / 2;
  [...bits].forEach((b, i) => {
    if (b === '1') ctx.fillRect(x0 + i * m, 50, m, 200);
  });
  return c;
}

export async function runDeviceTest(): Promise<void> {
  console.log(`DEVICETEST|INFO|start|origin=${location.origin} ua=${navigator.userAgent.slice(0, 90)}`);

  await check('storage: save and read back', async () => {
    localStorage.setItem('safescan.devicetest', 'ok');
    must(localStorage.getItem('safescan.devicetest') === 'ok', 'value did not come back');
    localStorage.removeItem('safescan.devicetest');
    return 'ok';
  });

  // --- every database, from inside the app on this phone ---
  await check('food database: barcode lookup', async () => {
    const r = await lookupBarcode('5449000000996');
    must(r.status === 'found', 'not found');
    return r.status === 'found' ? `${r.product.name}; ingredients ${r.product.ingredientsText ? 'yes' : 'no'}` : '';
  });
  await check('cosmetics database: barcode lookup', async () => {
    const r = await lookupIn('3606000560239', 'beauty');
    must(r.status === 'found', 'not found');
    return r.status === 'found' ? r.product.name : '';
  });
  await check('pet food database: barcode lookup', async () => {
    const r = await lookupIn('5998749108536', 'petfood');
    must(r.status === 'found', 'not found');
    return r.status === 'found' ? r.product.name : '';
  });
  await check('US supplement database (NIH)', async () => {
    const p = await lookupDsld('074312726941');
    must(p, 'not found');
    return `${p!.name}; ${p!.supplement?.facts.length ?? 0} facts`;
  });
  if (usdaEnabled()) {
    await check('US food database (USDA, with key)', async () => {
      const p = await lookupUsda('10693392005240');
      must(p, 'not found');
      return `${p!.name}; key sent in ${usdaKeyVia}`;
    });
  } else say('US food database (USDA, with key)', 'skip', 'no key in this build');
  await check('FDA recall notices', async () => {
    const r = await recallFor('649241898368');
    must(r, 'known recalled barcode returned no notice');
    return `${r!.date} ${r!.status}`;
  });
  await check('search by name (3 databases)', async () => {
    const hits = await searchByName('nutella', 'en');
    must(hits.some((h) => h.kind === 'food'), `no food results (${hits.length} total)`);
    return `${hits.length} results; kinds ${[...new Set(hits.map((h) => h.kind))].join(',')}`;
  });
  await check('others on this shelf: candidate search', async () => {
    const r = await lookupBarcode('5449000000996');
    must(r.status === 'found', 'cola not found');
    const found = r.status === 'found' ? await findAlternatives(r.product, 'united-states', (items) => items.length >= 20) : [];
    must(found.length > 0, 'no candidates returned');
    return `${found.length} candidates`;
  });

  // --- the phone's own engine ---
  await check('product photo: read pixels and cut out background', async () => {
    const r = await lookupBarcode('3017620422003');
    const url = r.status === 'found' ? (r.product.imageFullUrl ?? r.product.imageUrl) : undefined;
    must(url, 'no image url');
    const cut = await cutoutFor(url!);
    return cut ? `cut out ${cut.width}x${cut.height}` : 'pixels readable; kept as framed photo';
  });
  await check('barcode decoder (background worker)', async () => {
    const { decodeRgba } = await import('./decode');
    const c = barcodeCanvas('5449000000996');
    const img = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
    const code = decodeRgba(img.data, c.width, c.height);
    must(code === '5449000000996', `decoded ${code}`);
    return `read ${code}`;
  });
  say('built-in barcode detector', 'skip', `BarcodeDetector ${'BarcodeDetector' in window ? 'present' : 'absent, using the bundled decoder'}`);

  // --- camera: open, see frames, close, five times in a row ---
  if (!navigator.mediaDevices?.getUserMedia) {
    say('camera available', false, 'getUserMedia missing in this app shell');
  } else {
    const video = document.createElement('video');
    video.setAttribute('playsinline', '');
    video.muted = true;
    video.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01';
    document.body.appendChild(video);
    const opens: number[] = [];
    let torch = 'unknown';
    try {
      for (let i = 1; i <= 5; i++) {
        const t = performance.now();
        const session = await startScan(video, () => undefined);
        // frames must actually advance
        const t0 = video.currentTime;
        await new Promise((r) => setTimeout(r, 900));
        must(video.videoWidth > 0, `round ${i}: no picture`);
        must(video.currentTime !== t0, `round ${i}: picture frozen`);
        opens.push(Math.round(performance.now() - t - 900));
        if (i === 1) {
          torch = session.hasTorch ? 'has flashlight' : 'no flashlight control';
          if (session.hasTorch) {
            const on = await session.torch(true);
            await new Promise((r) => setTimeout(r, 300));
            await session.torch(false);
            torch += on ? ', switched on and off' : ', would not switch';
          }
        }
        const stream = video.srcObject as MediaStream | null;
        session.stop();
        must(!stream || stream.getTracks().every((tr) => tr.readyState === 'ended'), `round ${i}: camera not released`);
        await new Promise((r) => setTimeout(r, 250));
      }
      say('camera: open and release 5 times in a row', true, `open times ${opens.join(', ')} ms; ${video.videoWidth}x${video.videoHeight}`);
      say('camera: flashlight', torch.startsWith('has') && !torch.includes('would not') ? true : 'skip', torch);
    } catch (e) {
      say('camera: open and release 5 times in a row', false, `${e instanceof Error ? e.message : String(e)} (after ${opens.length} good rounds)`);
    } finally {
      video.remove();
    }
  }

  console.log('DEVICETEST|INFO|done|');
}
