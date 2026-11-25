/**
 * Product photo cut-out. Runs on the phone: no upload, no AI service, nothing to download.
 *
 * Volunteers photograph products on tables, shelves and kitchen counters. When the backdrop is
 * plain enough, this removes it so only the product shows. When it is not, or when the result
 * looks wrong, it returns null and the app shows the photo neatly framed instead.
 * A bad cut-out is worse than a framed photo, so every doubt ends in null.
 */

const SIZE = 240; // working size; the photo is shown at about 100px, so this is plenty

type Rgb = [number, number, number];

const dist = (d: Uint8ClampedArray, i: number, c: Rgb) => {
  const r = d[i] - c[0];
  const g = d[i + 1] - c[1];
  const b = d[i + 2] - c[2];
  return Math.sqrt(r * r + g * g + b * b);
};

const median = (values: number[]) => {
  const s = values.slice().sort((a, b) => a - b);
  return s[s.length >> 1] ?? 0;
};

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous'; // the open product databases allow this; needed to read pixels
    img.referrerPolicy = 'no-referrer';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image'));
    img.src = url;
  });
}

export type Cutout = { url: string; width: number; height: number };

/** Pure pixel work, separated so it can be tested without a browser image. */
export function cutBackground(data: Uint8ClampedArray, w: number, h: number): { alpha: Uint8Array; box: [number, number, number, number] } | null {
  const n = w * h;
  // 1. What colour is the backdrop? Look at a ring around the edge of the photo.
  const ring: number[] = [];
  const band = Math.max(2, Math.round(Math.min(w, h) * 0.03));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x < band || y < band || x >= w - band || y >= h - band) ring.push(y * w + x);
    }
  }
  const bg: Rgb = [median(ring.map((p) => data[p * 4])), median(ring.map((p) => data[p * 4 + 1])), median(ring.map((p) => data[p * 4 + 2]))];
  const near = ring.filter((p) => dist(data, p * 4, bg) < 46).length / ring.length;
  if (near < 0.62) return null; // busy backdrop (a shelf, a hand, a room): leave the photo alone

  // 2. Grow the backdrop inwards from the edge. A pixel joins when it is close to the backdrop
  //    colour, or only slightly different from its already-accepted neighbour (soft shadows, gradients).
  const TOL = 44;
  const STEP = 9;
  const REACH = 96;
  const isBg = new Uint8Array(n);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (const p of ring) {
    if (dist(data, p * 4, bg) < TOL) {
      isBg[p] = 1;
      queue[tail++] = p;
    }
  }
  while (head < tail) {
    const p = queue[head++];
    const x = p % w;
    const y = (p / w) | 0;
    const here: Rgb = [data[p * 4], data[p * 4 + 1], data[p * 4 + 2]];
    for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
      if (q < 0 || isBg[q]) continue;
      const d = dist(data, q * 4, bg);
      if (d < TOL || (d < REACH && dist(data, q * 4, here) < STEP)) {
        isBg[q] = 1;
        queue[tail++] = q;
      }
    }
  }

  // 3. Is what remains a believable product? Check its size and that it is one solid shape.
  let kept = 0;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let p = 0; p < n; p++) {
    if (isBg[p]) continue;
    kept++;
    const x = p % w;
    const y = (p / w) | 0;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  const share = kept / n;
  if (share < 0.06 || share > 0.8) return null; // nearly everything or nearly nothing went
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  if (bw < w * 0.18 || bh < h * 0.18) return null;
  if (kept / (bw * bh) < 0.5) return null; // scattered pieces: the product itself was eaten (white pack on white)
  // The product must not be glued to most of the photo's edge, or the "backdrop" was really the product.
  let edgeKept = 0;
  for (const p of ring) if (!isBg[p]) edgeKept++;
  if (edgeKept / ring.length > 0.3) return null;

  // 4. Largest connected piece only: drop specks, reflections and stray text.
  const label = new Int32Array(n);
  let best = 0;
  let bestSize = 0;
  let next = 0;
  for (let s = 0; s < n; s++) {
    if (isBg[s] || label[s]) continue;
    const id = ++next;
    let size = 0;
    head = 0;
    tail = 0;
    queue[tail++] = s;
    label[s] = id;
    while (head < tail) {
      const p = queue[head++];
      size++;
      const x = p % w;
      const y = (p / w) | 0;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
        if (q < 0 || isBg[q] || label[q]) continue;
        label[q] = id;
        queue[tail++] = q;
      }
    }
    if (size > bestSize) {
      bestSize = size;
      best = id;
    }
  }
  if (bestSize / kept < 0.7) return null; // several separate objects: not a clean product shot

  // 5. Soft edge: shave one pixel of halo, then blur the mask slightly.
  const hard = new Uint8Array(n);
  x0 = w;
  y0 = h;
  x1 = -1;
  y1 = -1;
  for (let p = 0; p < n; p++) {
    if (label[p] !== best) continue;
    const x = p % w;
    const y = (p / w) | 0;
    const inner = x > 0 && x < w - 1 && y > 0 && y < h - 1 && label[p - 1] === best && label[p + 1] === best && label[p - w] === best && label[p + w] === best;
    if (!inner) continue;
    hard[p] = 255;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (x1 < 0) return null;
  const alpha = new Uint8Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          sum += hard[yy * w + xx];
          count++;
        }
      }
      alpha[y * w + x] = Math.round(sum / count);
    }
  }
  return { alpha, box: [Math.max(0, x0 - 1), Math.max(0, y0 - 1), Math.min(w - 1, x1 + 1), Math.min(h - 1, y1 + 1)] };
}

const cache = new Map<string, Promise<Cutout | null>>();

/** Returns a transparent-background image of the product, or null when a clean cut isn't possible. */
export function cutoutFor(url: string): Promise<Cutout | null> {
  let job = cache.get(url);
  if (!job) {
    job = make(url).catch(() => null);
    cache.set(url, job);
  }
  return job;
}

async function make(url: string): Promise<Cutout | null> {
  const img = await loadImage(url);
  const scale = Math.min(1, SIZE / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  if (w < 40 || h < 40) return null;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);
  const image = ctx.getImageData(0, 0, w, h);
  const cut = cutBackground(image.data, w, h);
  if (!cut) return null;
  for (let p = 0; p < w * h; p++) image.data[p * 4 + 3] = cut.alpha[p];
  ctx.putImageData(image, 0, 0);
  const [x0, y0, x1, y1] = cut.box;
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext('2d')?.drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return { url: out.toDataURL('image/png'), width: out.width, height: out.height };
}
