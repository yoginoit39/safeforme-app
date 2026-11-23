import { afterEach, describe, expect, it, vi } from 'vitest';
import { LookupError, lookupBarcode } from '../src/data/off';

const ok = (product: object) => new Response(JSON.stringify({ status: 1, product }), { status: 200 });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('product lookups under load and bad networks', () => {
  it('a rate-limited reply (429) is reported as "busy", without hammering the service again', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 429 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(lookupBarcode('1000000000001')).rejects.toMatchObject({ kind: 'busy' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a network blip is retried once, quietly', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('failed')).mockResolvedValueOnce(ok({ product_name: 'Oats' }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await lookupBarcode('1000000000002');
    expect(result).toMatchObject({ status: 'found', product: { name: 'Oats' } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up with a network error after the retry also fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('failed'); }));
    await expect(lookupBarcode('1000000000003')).rejects.toBeInstanceOf(LookupError);
  });

  it('two taps on the same barcode send one request, and later lookups use the cache', async () => {
    const fetchMock = vi.fn(async () => ok({ product_name: 'Cola' }));
    vi.stubGlobal('fetch', fetchMock);
    const [a, b] = await Promise.all([lookupBarcode('1000000000004'), lookupBarcode('1000000000004')]);
    expect(a).toBe(b);
    await lookupBarcode('1000000000004');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a request that never answers is cut off instead of spinning forever', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', (_url: string, opts: { signal: AbortSignal }) =>
      new Promise((_res, rej) => opts.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))));
    const pending = lookupBarcode('1000000000005');
    const assertion = expect(pending).rejects.toMatchObject({ kind: 'network' });
    await vi.advanceTimersByTimeAsync(12_000 + 900 + 12_000 + 10);
    await assertion;
  });

  it('unknown barcodes are "not found", not an error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"status":0}', { status: 404 })));
    expect(await lookupBarcode('1000000000006')).toEqual({ status: 'not-found' });
  });
});
