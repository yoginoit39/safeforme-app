import { describe, expect, it } from 'vitest';
import { decodeRgba } from '../src/decode';

// Minimal EAN-13 renderer, so the decoder is tested against a real barcode image.
const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = L.map((c) => [...c].reverse().map((b) => (b === '1' ? '0' : '1')).join(''));
const R = L.map((c) => [...c].map((b) => (b === '1' ? '0' : '1')).join(''));
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

function ean13Image(code: string, module = 3, height = 120) {
  const d = [...code].map(Number);
  let bits = '101';
  for (let i = 1; i <= 6; i++) bits += (PARITY[d[0]][i - 1] === 'L' ? L : G)[d[i]];
  bits += '01010';
  for (let i = 7; i <= 12; i++) bits += R[d[i]];
  bits += '101';
  const quiet = 12;
  const width = (bits.length + quiet * 2) * module;
  const rgba = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 10; y < height - 10; y++) {
    for (let b = 0; b < bits.length; b++) {
      if (bits[b] !== '1') continue;
      for (let m = 0; m < module; m++) {
        const i = (y * width + (quiet + b) * module + m) * 4;
        rgba[i] = rgba[i + 1] = rgba[i + 2] = 0;
      }
    }
  }
  return { rgba, width, height };
}

describe('fallback barcode decoder (used on iPhone Safari / Firefox)', () => {
  it.each(['3017620422003', '5449000000996', '8076800195057'])('reads EAN-13 %s', (code) => {
    const { rgba, width, height } = ean13Image(code);
    expect(decodeRgba(rgba, width, height)).toBe(code);
  });

  it('returns null for a blank frame', () => {
    expect(decodeRgba(new Uint8ClampedArray(200 * 100 * 4).fill(255), 200, 100)).toBeNull();
  });
});
