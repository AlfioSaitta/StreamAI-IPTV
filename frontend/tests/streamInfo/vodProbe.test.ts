// Tests for services/streamInfo/vodProbe — URG-1 L2/L3.
// Verifies HEAD-based Range detection, tail prefetch behavior, and caching.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearVodProbeCache,
  getCachedVodProbe,
  probeVodSource,
} from '../../services/streamInfo/vodProbe';

const URL = 'http://example.test/movie/u/p/12345.mp4';
const LARGE_CL = 4 * 1024 * 1024 * 1024; // 4 GB

const makeHeadResponse = (headers: Record<string, string>, status = 200): Response => {
  return new Response(null, { status, headers });
};

const makeRangeResponse = (length: number, ct = 'video/mp4'): Response => {
  const tailBytes = 2 * 1024 * 1024;
  const start = length - tailBytes;
  const end = length - 1;
  return new Response(new ArrayBuffer(8), {
    status: 206,
    headers: {
      'content-type': ct,
      'content-range': `bytes ${start}-${end}/${length}`,
      'content-length': String(tailBytes),
    },
  });
};

describe('vodProbe.probeVodSource', () => {
  beforeEach(() => {
    clearVodProbeCache();
    vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('detects Accept-Ranges: bytes and prefetches the tail', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(makeHeadResponse({
        'accept-ranges': 'bytes',
        'content-type': 'video/mp4',
        'content-length': String(LARGE_CL),
      }))
      .mockResolvedValueOnce(makeRangeResponse(LARGE_CL));

    const result = await probeVodSource(URL, { prefetchTail: true });

    expect(result.rangeSupport).toBe('yes');
    expect(result.contentType).toBe('video/mp4');
    expect(result.contentLength).toBe(LARGE_CL);
    expect(result.moovWarmed).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1]?.headers).toMatchObject({
      Range: expect.stringMatching(/^bytes=\d+-$/),
    });
  });

  it('detects Accept-Ranges: none and does NOT prefetch the tail', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(makeHeadResponse({
      'accept-ranges': 'none',
      'content-type': 'video/mp4',
      'content-length': String(LARGE_CL),
    }));

    const result = await probeVodSource(URL, { prefetchTail: true });

    expect(result.rangeSupport).toBe('no');
    expect(result.moovWarmed).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('memoizes the probe result and coalesces concurrent calls', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(makeHeadResponse({
        'accept-ranges': 'bytes',
        'content-length': String(LARGE_CL),
      }))
      .mockResolvedValueOnce(makeRangeResponse(LARGE_CL));

    const [a, b] = await Promise.all([
      probeVodSource(URL, { prefetchTail: true }),
      probeVodSource(URL, { prefetchTail: true }),
    ]);
    const c = await probeVodSource(URL, { prefetchTail: true });

    expect(a).toBe(b);
    expect(a).toBe(c);
    // HEAD + tail fetched once total, not three times.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getCachedVodProbe(URL)).toBe(a);
  });

  it('skips tail prefetch when contentLength is missing', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(makeHeadResponse({
      'accept-ranges': 'bytes',
      'content-type': 'video/mp4',
    }));

    const result = await probeVodSource(URL, { prefetchTail: true });

    expect(result.rangeSupport).toBe('yes');
    expect(result.contentLength).toBeUndefined();
    expect(result.moovWarmed).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to a tiny ranged GET when HEAD fails', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockRejectedValueOnce(new Error('HEAD not allowed'))
      .mockResolvedValueOnce(new Response(new ArrayBuffer(8), {
        status: 206,
        headers: {
          'content-type': 'video/mp4',
          'content-range': `bytes 0-1023/${LARGE_CL}`,
        },
      }))
      .mockResolvedValueOnce(makeRangeResponse(LARGE_CL));

    const result = await probeVodSource(URL, { prefetchTail: true });

    expect(result.rangeSupport).toBe('yes');
    expect(result.contentLength).toBe(LARGE_CL);
    expect(result.moovWarmed).toBe(true);
  });

  it('returns rangeSupport=unknown when both HEAD and tiny GET fail', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockRejectedValueOnce(new Error('network'))
      .mockRejectedValueOnce(new Error('network'));

    const result = await probeVodSource(URL, { prefetchTail: true });

    expect(result.rangeSupport).toBe('unknown');
    expect(result.moovWarmed).toBe(false);
  });
});

