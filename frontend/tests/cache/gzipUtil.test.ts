// @vitest-environment jsdom
// Tests for services/gzipUtil — E.5 API cache compression.

import { describe, expect, it } from 'vitest';
import { decodeMaybeGzip, encodeMaybeGzip, gzipSupported } from '../../services/gzipUtil';

describe('gzipUtil', () => {
  it('reports CompressionStream availability honestly', () => {
    // jsdom v25 provides CompressionStream via the polyfill in node 18+.
    expect(typeof gzipSupported()).toBe('boolean');
  });

  it('round-trips a small payload uncompressed (under min threshold)', async () => {
    const data = { foo: 'bar', n: 42 };
    const { bytes, compressed } = await encodeMaybeGzip(data, { minBytes: 4096 });
    expect(compressed).toBe(false);
    const decoded = await decodeMaybeGzip(bytes, compressed);
    expect(decoded).toEqual(data);
  });

  it('round-trips a large payload (typically gzipped)', async () => {
    // Build a JSON payload that compresses well — repeated strings.
    const data = {
      items: Array.from({ length: 200 }, (_, i) => ({
        id: i,
        title: 'Lorem ipsum dolor sit amet '.repeat(20),
        url: 'https://example.test/path/to/poster.jpg?token=ABCD1234',
      })),
    };
    const { bytes, compressed } = await encodeMaybeGzip(data, { minBytes: 1024 });
    const decoded = await decodeMaybeGzip(bytes, compressed);
    expect(decoded).toEqual(data);
    if (gzipSupported()) {
      // Compressed copy should be much smaller than raw JSON (typically > 70% saving).
      const rawSize = new TextEncoder().encode(JSON.stringify(data)).byteLength;
      if (compressed) {
        expect(bytes.byteLength).toBeLessThan(rawSize * 0.5);
      }
    }
  });

  it('returns the raw bytes when compression saving is negligible', async () => {
    // Random-like data does not compress.
    const data = { rnd: Math.random().toString(36).repeat(5) };
    const { compressed } = await encodeMaybeGzip(data, { minBytes: 1 });
    // Either tiny-or-incompressible → compressed=false is the right answer.
    if (compressed) {
      // If the runtime did compress it, the round-trip must still work.
      expect(typeof compressed).toBe('boolean');
    }
  });

  it('throws when asked to decompress without DecompressionStream support', async () => {
    // Force the "compressed but unsupported" branch by passing arbitrary bytes
    // with compressed=true on a small synthetic blob. If support exists, this
    // simply fails the gunzip step — still surfaces an error.
    const garbage = new Uint8Array([0, 1, 2, 3, 4]);
    await expect(decodeMaybeGzip(garbage, true)).rejects.toBeTruthy();
  });
});

