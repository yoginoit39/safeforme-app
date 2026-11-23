/// <reference lib="webworker" />
import { decodeRgba } from './decode';

/**
 * Barcode decoding off the main thread, so the camera preview and the rest of
 * the screen never stutter while the decoder is busy.
 */
self.onmessage = (ev: MessageEvent<{ id: number; buffer: ArrayBuffer; width: number; height: number }>) => {
  const { id, buffer, width, height } = ev.data;
  let code: string | null = null;
  try {
    code = decodeRgba(new Uint8ClampedArray(buffer), width, height);
  } catch {
    code = null;
  }
  self.postMessage({ id, code });
};
