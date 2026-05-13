// Cache API layer for image storage — E.5.
//
// Provides a browser-native, HTTP-style cache for image blobs. Compared to
// the legacy IndexedDB store this:
//   - Lets the browser handle eviction under storage pressure;
//   - Doesn't pollute the IDB index when the image set grows past ~10k;
//   - Can be transparently served by a Service Worker (future work).
//
// On environments where the Cache API is unavailable (Electron in some
// contexts, very old WebViews), `isSupported()` returns false and callers
// must fall back to the IndexedDB path in `cacheService.ts`.

const CACHE_NAME = 'streamai-images-v1';
const HEADER_CACHED_AT = 'x-streamai-cached-at';
const HEADER_LAST_ACCESS = 'x-streamai-last-access';

const safeCaches = (): CacheStorage | null => {
  try {
    if (typeof caches === 'undefined') return null;
    return caches;
  } catch {
    return null;
  }
};

let openPromise: Promise<Cache> | null = null;

const openCache = async (): Promise<Cache | null> => {
  const c = safeCaches();
  if (!c) return null;
  if (!openPromise) openPromise = c.open(CACHE_NAME);
  try {
    return await openPromise;
  } catch {
    openPromise = null;
    return null;
  }
};

const buildResponse = (blob: Blob): Response => {
  const now = Date.now().toString();
  return new Response(blob, {
    status: 200,
    headers: new Headers({
      'Content-Type': blob.type || 'image/*',
      'Content-Length': String(blob.size),
      [HEADER_CACHED_AT]: now,
      [HEADER_LAST_ACCESS]: now,
    }),
  });
};

export interface ImageCacheApiEntry {
  blob: Blob;
  cachedAt: number;
  lastAccess: number;
  size: number;
}

export const imageCacheApi = {
  isSupported(): boolean {
    return safeCaches() !== null;
  },

  async put(url: string, blob: Blob): Promise<boolean> {
    const cache = await openCache();
    if (!cache) return false;
    try {
      await cache.put(url, buildResponse(blob));
      return true;
    } catch (e) {
      // Quota errors are non-fatal; the caller will fall back to IDB.
      console.warn('[ImageCacheApi] put failed:', (e as Error).message);
      return false;
    }
  },

  async get(url: string): Promise<ImageCacheApiEntry | null> {
    const cache = await openCache();
    if (!cache) return null;
    try {
      const resp = await cache.match(url);
      if (!resp) return null;
      const cachedAt = Number(resp.headers.get(HEADER_CACHED_AT) ?? 0);
      const lastAccess = Number(resp.headers.get(HEADER_LAST_ACCESS) ?? cachedAt);
      const blob = await resp.blob();
      return { blob, cachedAt, lastAccess, size: blob.size };
    } catch {
      return null;
    }
  },

  async has(url: string): Promise<boolean> {
    const cache = await openCache();
    if (!cache) return false;
    try {
      const resp = await cache.match(url, { ignoreVary: true });
      return !!resp;
    } catch {
      return false;
    }
  },

  /** Re-put the entry with an updated `x-streamai-last-access` header. */
  async touch(url: string, entry: ImageCacheApiEntry): Promise<void> {
    const cache = await openCache();
    if (!cache) return;
    try {
      const headers = new Headers({
        'Content-Type': entry.blob.type || 'image/*',
        'Content-Length': String(entry.size),
        [HEADER_CACHED_AT]: String(entry.cachedAt),
        [HEADER_LAST_ACCESS]: String(Date.now()),
      });
      await cache.put(url, new Response(entry.blob, { status: 200, headers }));
    } catch {
      /* noop */
    }
  },

  async delete(url: string): Promise<boolean> {
    const cache = await openCache();
    if (!cache) return false;
    try { return await cache.delete(url); } catch { return false; }
  },

  /** Drop entries older than `ttlMs` or whose `lastAccess` is older than
   *  `ttlMs * 2`. Best-effort: enumerates `cache.keys()` once. */
  async cleanup(ttlMs: number, maxEntries: number): Promise<{ deleted: number }> {
    const cache = await openCache();
    if (!cache) return { deleted: 0 };
    let deleted = 0;
    try {
      const keys = await cache.keys();
      if (keys.length === 0) return { deleted: 0 };
      const now = Date.now();
      const stats: Array<{ url: string; lastAccess: number; cachedAt: number }> = [];
      for (const req of keys) {
        const resp = await cache.match(req);
        if (!resp) continue;
        const cachedAt = Number(resp.headers.get(HEADER_CACHED_AT) ?? 0);
        const lastAccess = Number(resp.headers.get(HEADER_LAST_ACCESS) ?? cachedAt);
        stats.push({ url: req.url, lastAccess, cachedAt });
      }
      // Expire by TTL
      const expired = stats.filter(s => now - s.cachedAt > ttlMs);
      for (const e of expired) {
        if (await cache.delete(e.url)) deleted++;
      }
      // Enforce max entries (LRU by lastAccess)
      const remaining = stats.filter(s => !expired.includes(s));
      if (remaining.length > maxEntries) {
        remaining.sort((a, b) => a.lastAccess - b.lastAccess);
        const overflow = remaining.length - maxEntries;
        for (let i = 0; i < overflow; i++) {
          if (await cache.delete(remaining[i].url)) deleted++;
        }
      }
    } catch (e) {
      console.warn('[ImageCacheApi] cleanup failed:', (e as Error).message);
    }
    return { deleted };
  },

  async count(): Promise<number> {
    const cache = await openCache();
    if (!cache) return 0;
    try { return (await cache.keys()).length; } catch { return 0; }
  },

  async clear(): Promise<void> {
    const c = safeCaches();
    if (!c) return;
    try { await c.delete(CACHE_NAME); openPromise = null; } catch { /* noop */ }
  },
};

