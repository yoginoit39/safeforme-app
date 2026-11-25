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

export type ScanProblem = 'slow' | 'stalled';
export type ScanSession = {
  stop(): void;
  /** Moves the live picture to a new <video> after the screen was redrawn. */
  attach(video: HTMLVideoElement): void;
  /** Phone flashlight, where the camera has one. Resolves to whether it is now on. */
  torch(on: boolean): Promise<boolean>;
  readonly hasTorch: boolean;
};

const OPEN_TIMEOUT_MS = 10_000;
const STALL_MS = 3_500;
const SLOW_MS = 9_000;

/** Opens the back camera. Never hangs: a camera that does not answer is treated as a failure. */
function openCamera(): Promise<MediaStream> {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = window.setTimeout(() => {
      done = true;
      reject(new Error('camera-timeout'));
    }, OPEN_TIMEOUT_MS);
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false })
      .then((stream) => {
        if (done) return stream.getTracks().forEach((t) => t.stop()); // answered too late: let it go
        done = true;
        window.clearTimeout(timer);
        resolve(stream);
      })
      .catch((e) => {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        reject(e);
      });
  });
}

/** Keeps focus adjusting as the pack moves. Zoom is deliberately never touched. */
function keepFocusing(stream: MediaStream): void {
  const track = stream.getVideoTracks()[0];
  const caps = (track?.getCapabilities?.() ?? {}) as { focusMode?: string[] };
  if (caps.focusMode?.includes('continuous')) {
    void track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => undefined);
  }
}

/**
 * Starts the camera in `video` and calls `onCode` once with the first barcode seen.
 * Rejects if the camera can't be opened (permission denied, no camera, or no answer).
 *
 * Built for scanning one product after another all the way round a shop:
 * - the camera is fully released after every scan, and opened fresh for the next
 * - a frozen picture is noticed and the camera is restarted once on its own
 * - if the screen is redrawn mid-scan, the picture moves to the new video box
 * - `onProblem` says when a scan is taking long or the camera can't be recovered
 */
export async function startScan(video: HTMLVideoElement, onCode: (code: string) => void, onProblem?: (p: ScanProblem) => void): Promise<ScanSession> {
  let stream = await openCamera();
  let target = video;
  let stopped = false;
  let timer = 0;
  let torchOn = false;

  const show = (v: HTMLVideoElement) => {
    target = v;
    if (v.srcObject !== stream) v.srcObject = stream;
    void v.play().catch(() => undefined);
  };
  const release = () => {
    stream.getTracks().forEach((t) => t.stop());
    if (target.srcObject === stream) target.srcObject = null;
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    window.clearTimeout(timer);
    release();
  };
  show(video);
  keepFocusing(stream);

  let read: FrameReader;
  try {
    read = (await nativeReader()) ?? (await fallbackReader());
  } catch (e) {
    stop();
    throw e;
  }

  const started = Date.now();
  let lastMove = Date.now();
  let lastTime = -1;
  let restarts = 0;
  let toldSlow = false;
  let restarting = false;

  /** The picture froze or the camera was taken away: open it again, once. */
  const restart = async () => {
    if (restarting || stopped) return;
    restarting = true;
    release();
    try {
      const fresh = await openCamera();
      if (stopped) return fresh.getTracks().forEach((t) => t.stop());
      stream = fresh;
      torchOn = false;
      show(target);
      keepFocusing(stream);
      lastMove = Date.now();
      lastTime = -1;
    } catch {
      if (!stopped) onProblem?.('stalled');
    } finally {
      restarting = false;
    }
  };

  const tick = async () => {
    if (stopped) return;
    try {
      const now = Date.now();
      if (!restarting) {
        const live = stream.getVideoTracks()[0]?.readyState === 'live';
        if (target.currentTime !== lastTime) {
          lastTime = target.currentTime;
          lastMove = now;
        }
        if (!live || now - lastMove > STALL_MS) {
          if (restarts < 1) {
            restarts++;
            await restart();
          } else if (now - lastMove > STALL_MS * 2) {
            onProblem?.('stalled');
            lastMove = now + 60_000; // say it once
          }
        } else if (target.readyState >= 2) {
          const code = await read(target);
          if (code && !stopped) {
            stop();
            onCode(code);
            return;
          }
        }
        if (!toldSlow && now - started > SLOW_MS) {
          toldSlow = true;
          onProblem?.('slow');
        }
      }
    } catch {
      // A failed frame is not fatal; try the next one.
    }
    timer = window.setTimeout(tick, 150);
  };
  void tick();

  const torchCapable = () => !!(stream.getVideoTracks()[0]?.getCapabilities?.() as { torch?: boolean } | undefined)?.torch;
  return {
    stop,
    attach: (v) => {
      if (!stopped) show(v);
    },
    torch: async (on) => {
      if (stopped || !torchCapable()) return false;
      try {
        await stream.getVideoTracks()[0].applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
        torchOn = on;
      } catch {
        // some phones report a torch they will not switch
      }
      return torchOn;
    },
    get hasTorch() {
      return torchCapable();
    },
  };
}
