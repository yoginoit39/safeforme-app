/**
 * Camera barcode scanning. Uses the browser's built-in BarcodeDetector where it
 * exists, otherwise an on-device JavaScript decoder (so iPhones can scan too).
 */

type DetectedBarcode = { rawValue: string };
type BarcodeDetectorLike = { detect(source: CanvasImageSource): Promise<DetectedBarcode[]> };
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike;

const getDetector = (): BarcodeDetectorCtor | undefined =>
  (globalThis as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;

export const scannerSupported = (): boolean => !!navigator.mediaDevices?.getUserMedia;

export type ScanSession = { stop(): void };

type FrameReader = (video: HTMLVideoElement) => Promise<string | null>;

async function nativeReader(): Promise<FrameReader | null> {
  const Detector = getDetector();
  if (!Detector) return null;
  try {
    const detector = new Detector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
    return async (video) => {
      const codes = await detector.detect(video);
      return codes.find((c) => /^\d{6,14}$/.test(c.rawValue))?.rawValue ?? null;
    };
  } catch {
    return null; // detector exists but doesn't support these formats
  }
}

type Decode = (rgba: Uint8ClampedArray, width: number, height: number) => Promise<string | null>;

let decoder: Promise<Decode> | null = null;

/** Decoder running in a background thread; falls back to this thread if workers are unavailable. */
function getDecoder(): Promise<Decode> {
  decoder ??= (async (): Promise<Decode> => {
    try {
      const worker = new Worker(new URL('./decode.worker.ts', import.meta.url), { type: 'module' });
      const waiting = new Map<number, (code: string | null) => void>();
      let nextId = 1;
      let broken = false;
      worker.onmessage = (ev: MessageEvent<{ id: number; code: string | null }>) => {
        waiting.get(ev.data.id)?.(ev.data.code);
        waiting.delete(ev.data.id);
      };
      worker.onerror = () => {
        broken = true;
        waiting.forEach((resolve) => resolve(null));
        waiting.clear();
        decoder = null; // next scan builds a fresh decoder (or the same-thread fallback)
      };
      return (rgba, width, height) =>
        new Promise((resolve) => {
          if (broken) return resolve(null);
          const id = nextId++;
          waiting.set(id, resolve);
          worker.postMessage({ id, buffer: rgba.buffer, width, height }, [rgba.buffer]);
        });
    } catch {
      const { decodeRgba } = await import('./decode');
      return async (rgba, width, height) => decodeRgba(rgba, width, height);
    }
  })();
  return decoder;
}

/** Loads the decoder ahead of the first scan on phones that need it, so the camera starts reading at once. */
export function prewarmScanner(): void {
  if (!getDetector() && scannerSupported()) void getDecoder();
}

async function fallbackReader(): Promise<FrameReader> {
  const decode = await getDecoder();
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  return async (video) => {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;
    // Read the middle band of the frame, where the on-screen guide box is.
    const sw = Math.round(vw * 0.9);
    const sh = Math.round(vh * 0.5);
    const scale = Math.min(1, 800 / sw);
    canvas.width = Math.round(sw * scale);
    canvas.height = Math.round(sh * scale);
    ctx.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, canvas.width, canvas.height);
    // Waits for the answer before the next frame is sent, so frames never pile up.
    return decode(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
  };
}

/**
 * Starts the camera in `video` and calls `onCode` once with the first barcode seen.
 * Rejects if the camera can't be opened (e.g. permission denied).
 */
export async function startScan(video: HTMLVideoElement, onCode: (code: string) => void): Promise<ScanSession> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
    audio: false,
  });
  video.srcObject = stream;
  await video.play().catch(() => undefined);

  let stopped = false;
  let timer = 0;
  const stop = () => {
    stopped = true;
    window.clearTimeout(timer);
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  };

  let read: FrameReader;
  try {
    read = (await nativeReader()) ?? (await fallbackReader());
  } catch (e) {
    stop();
    throw e;
  }

  const tick = async () => {
    if (stopped) return;
    try {
      if (video.readyState >= 2) {
        const code = await read(video);
        if (code && !stopped) {
          stop();
          onCode(code);
          return;
        }
      }
    } catch {
      // A failed frame is not fatal; try the next one.
    }
    timer = window.setTimeout(tick, 150);
  };
  void tick();

  return { stop };
}
