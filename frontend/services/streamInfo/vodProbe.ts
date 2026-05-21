// VOD probe + moov prefetch service (URG-1 Level 2 + Level 3).
//
// Goals:
//  1. Discover whether the server supports HTTP Range requests, so the player
//     can warn the user (and disable the timeline) when seek would be a
//     forced full-file download.
//  2. For MP4 VOD with the `moov` atom at the END of the file (typical of
//     Xtream backends that skip `qt-faststart`), prefetch the tail so the
//     browser's HTTP cache already has the index when the user first seeks.
//
// The prefetched bytes don't need to be parsed by us — once they're in the
// browser cache, a subsequent `<video>.currentTime = T` will serve the moov
// from cache instead of re-downloading. Even Electron's `net` module respects
// the standard HTTP cache, so this works there too.

export type VodRangeSupport = 'unknown' | 'yes' | 'no';

export interface VodProbeResult {
  url: string;
  rangeSupport: VodRangeSupport;
  contentType?: string;
  contentLength?: number;
  /** True when we successfully fetched the tail to warm the moov cache. */
  moovWarmed: boolean;
  /** ISO timestamp of when the probe was performed. */
  probedAt: number;
}

// Module-level cache, keyed by URL. Lives for the lifetime of the renderer.
const probeCache = new Map<string, VodProbeResult>();
const inflight = new Map<string, Promise<VodProbeResult>>();

const TAIL_PREFETCH_BYTES = 2 * 1024 * 1024; // 2 MB — enough for most moov atoms
const HEAD_TIMEOUT_MS = 4000;
const TAIL_TIMEOUT_MS = 15000;

const withTimeout = <T,>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
    promise.then(v => { clearTimeout(id); resolve(v); },
                 e => { clearTimeout(id); reject(e); });
  });
};

const parseAcceptRanges = (value: string | null): VodRangeSupport => {
  if (!value) return 'unknown';
  const v = value.toLowerCase().trim();
  if (v === 'none') return 'no';
  if (v.includes('bytes')) return 'yes';
  return 'unknown';
};

/**
 * Probe a VOD URL and (optionally) prefetch the tail to warm the moov cache.
 * Safe to call multiple times — results are memoized per URL.
 *
 * The probe is best-effort: any network/CORS failure is swallowed and the
 * result is returned with `rangeSupport: 'unknown'` so the caller can fall
 * back to the legacy behavior without crashing the player.
 */
export const probeVodSource = async (
  url: string,
  options: { prefetchTail?: boolean } = {},
): Promise<VodProbeResult> => {
  const cached = probeCache.get(url);
  if (cached) return cached;
  const pending = inflight.get(url);
  if (pending) return pending;

  const promise = (async (): Promise<VodProbeResult> => {
    const result: VodProbeResult = {
      url,
      rangeSupport: 'unknown',
      moovWarmed: false,
      probedAt: Date.now(),
    };

    // Step 1 — HEAD to discover Accept-Ranges + Content-Type + length.
    try {
      const headResp = await withTimeout(
        fetch(url, { method: 'HEAD', cache: 'no-store', credentials: 'omit' }),
        HEAD_TIMEOUT_MS,
        'HEAD',
      );
      if (headResp.ok || headResp.status === 405) {
        const ar = headResp.headers.get('accept-ranges');
        result.rangeSupport = parseAcceptRanges(ar);
        const ct = headResp.headers.get('content-type');
        if (ct) result.contentType = ct;
        const cl = headResp.headers.get('content-length');
        if (cl) {
          const n = Number(cl);
          if (Number.isFinite(n) && n > 0) result.contentLength = n;
        }
      }
    } catch (e) {
      // HEAD might not be allowed by the server; try a tiny ranged GET as fallback
      try {
        const tinyResp = await withTimeout(
          fetch(url, {
            method: 'GET',
            cache: 'no-store',
            credentials: 'omit',
            headers: { Range: 'bytes=0-1023' },
          }),
          HEAD_TIMEOUT_MS,
          'tiny GET',
        );
        if (tinyResp.status === 206) {
          result.rangeSupport = 'yes';
          const cr = tinyResp.headers.get('content-range');
          if (cr) {
            const m = /\/(\d+)$/.exec(cr);
            if (m) result.contentLength = Number(m[1]);
          }
          const ct = tinyResp.headers.get('content-type');
          if (ct) result.contentType = ct;
          // Drain the body to avoid leaks.
          try { await tinyResp.body?.cancel(); } catch { /* noop */ }
        } else if (tinyResp.status === 200) {
          result.rangeSupport = 'no';
          try { await tinyResp.body?.cancel(); } catch { /* noop */ }
        }
      } catch {
        // Both HEAD and tiny GET failed — keep rangeSupport='unknown'.
        void e;
      }
    }

    // Step 2 — Warm the moov cache by fetching the file tail.
    // Skip when Range is known to be unsupported, when we have no content-length
    // (we can't address the tail without it), or when the caller opted out.
    const shouldPrefetchTail = options.prefetchTail !== false
      && result.rangeSupport === 'yes'
      && result.contentLength !== undefined
      && result.contentLength > TAIL_PREFETCH_BYTES;

    if (shouldPrefetchTail) {
      try {
        const tailStart = result.contentLength! - TAIL_PREFETCH_BYTES;
        const tailResp = await withTimeout(
          fetch(url, {
            method: 'GET',
            // IMPORTANT: keep the default cache mode so the browser stores the
            // tail in its HTTP cache. We do NOT use no-store here.
            credentials: 'omit',
            headers: { Range: `bytes=${tailStart}-` },
          }),
          TAIL_TIMEOUT_MS,
          'tail prefetch',
        );
        if (tailResp.status === 206 || tailResp.status === 200) {
          // Read the body to completion so the cache entry is committed.
          // Using arrayBuffer() because cancel() before completion may prevent
          // the browser from storing the response.
          await tailResp.arrayBuffer();
          result.moovWarmed = true;
        } else {
          try { await tailResp.body?.cancel(); } catch { /* noop */ }
        }
      } catch (e) {
        // Tail prefetch is best-effort. Log only in dev.
        if (typeof console !== 'undefined') {
          console.debug('[vodProbe] tail prefetch failed:', (e as Error).message);
        }
      }
    }

    probeCache.set(url, result);
    return result;
  })();

  inflight.set(url, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(url);
  }
};

/** Synchronously read a previously cached probe result (no network). */
export const getCachedVodProbe = (url: string): VodProbeResult | null => {
  return probeCache.get(url) ?? null;
};

/** Clear the in-memory probe cache (test helper, also exposed for diagnostics). */
export const clearVodProbeCache = (): void => {
  probeCache.clear();
  inflight.clear();
};

