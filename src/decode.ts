import {
  BarcodeFormat, BinaryBitmap, DecodeHintType, HybridBinarizer, MultiFormatReader, RGBLuminanceSource,
} from '@zxing/library';

/**
 * Pure-JS barcode decoding for browsers without the built-in BarcodeDetector
 * (iPhone Safari, Firefox). Loaded on demand, runs entirely on the device.
 */

const reader = new MultiFormatReader();
reader.setHints(
  new Map<DecodeHintType, unknown>([
    [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E]],
    [DecodeHintType.TRY_HARDER, true],
  ]),
);

/** Decodes a product barcode from RGBA pixels. Returns the digits, or null if none is readable. */
export function decodeRgba(rgba: Uint8ClampedArray, width: number, height: number): string | null {
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0, j = 0; i < gray.length; i++, j += 4) {
    gray[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
  }
  try {
    const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(gray, width, height)));
    const text = reader.decodeWithState(bitmap).getText();
    return /^\d{6,14}$/.test(text) ? text : null;
  } catch {
    return null; // nothing readable in this frame
  } finally {
    reader.reset();
  }
}
