// BUG-1 §2.3 Step 5 — Tests for services/xtream.ts loginXtream cache hardening.
// Copre: parsing alternativo, retry, no-cache su risultati parziali,
// preservazione "best-of" della cache, fallback su cache su errore di rete.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock CacheService: in-memory store
const cacheStore = new Map<string, unknown>();
vi.mock('../../services/cacheService.ts', () => ({
  CacheService: {
    getApiData: vi.fn(async (key: string) => cacheStore.get(key) ?? null),
    saveApiData: vi.fn(async (key: string, data: unknown) => {
      cacheStore.set(key, data);
    }),
  },
}));

// Mock MetadataService: passthrough title cleaner.
vi.mock('../../services/metadata.ts', () => ({
  MetadataService: {
    cleanTitle: (s: string) => s,
  },
}));

import { loginXtream, __testing } from '../../services/xtream';
import type { XtreamContent } from '../../types';

const CREDS = {
  url: 'http://provider.test:8080',
  username: 'user1',
  password: 'pwd1',
};

const AUTH_OK = { user_info: { auth: 1 } };

const mkStream = (id: number, name = `Movie ${id}`) => ({
  stream_id: id,
  name,
  category_id: 'cat-1',
  container_extension: 'mp4',
});

const mkCat = (id: string, name: string) => ({
  category_id: id,
  category_name: name,
});

interface MockRoute {
  match: RegExp;
  response: unknown;
  status?: number;
  delay?: number;
  /** Errori da lanciare una volta sola (per testare retry). */
  failOnce?: boolean;
}

const buildFetchMock = (routes: MockRoute[]) => {
  const counters = new Map<RegExp, number>();
  return vi.fn(async (url: string) => {
    // Più specifico prima: gli `action=…` matchano per primi, l'auth (catch-all
    // su `player_api.php?...$`) viene tentato per ultimo. Evita che la route
    // auth (regex `[^/]*$`) catturi anche le chiamate al catalogo.
    const sorted = [...routes].sort((a, b) => {
      const aIsActionSpecific = /action=get_/.test(a.match.source);
      const bIsActionSpecific = /action=get_/.test(b.match.source);
      if (aIsActionSpecific && !bIsActionSpecific) return -1;
      if (!aIsActionSpecific && bIsActionSpecific) return 1;
      return 0;
    });
    for (const r of sorted) {
      if (r.match.test(url)) {
        counters.set(r.match, (counters.get(r.match) ?? 0) + 1);
        if (r.failOnce && counters.get(r.match) === 1) {
          throw new Error('network failure (transient)');
        }
        const body = JSON.stringify(r.response);
        return new Response(body, {
          status: r.status ?? 200,
          headers: { 'content-type': 'application/json' },
        });
      }
    }
    throw new Error(`Unmocked fetch: ${url}`);
  });
};

const stripFetchedAt = (h: XtreamContent['health']) => ({
  live: h.live,
  vod: h.vod,
  series: h.series,
});

describe('xtream.fetchCatalog (BUG-1 §2.3 Step 2)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns ok=true for pure-array responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify([1, 2, 3]))),
    );
    const r = await __testing.fetchCatalog('http://x/y');
    expect(r).toEqual({ ok: true, data: [1, 2, 3] });
  });

  it('unwraps { data: [...] } wrappers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ data: ['a', 'b'] }))),
    );
    const r = await __testing.fetchCatalog<string>('http://x/y');
    expect(r.ok && r.data).toEqual(['a', 'b']);
  });

  it('unwraps { streams: [...] } and { result: [...] }', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ streams: [1] })))
        .mockResolvedValueOnce(new Response(JSON.stringify({ result: [2] }))),
    );
    const r1 = await __testing.fetchCatalog<number>('http://x/y1');
    const r2 = await __testing.fetchCatalog<number>('http://x/y2');
    expect(r1.ok && r1.data).toEqual([1]);
    expect(r2.ok && r2.data).toEqual([2]);
  });

  it('returns ok=false with reason for { error: "..." } payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'VOD disabled' }))),
    );
    const r = await __testing.fetchCatalog('http://x/y');
    expect(r.ok).toBe(false);
    expect((r as { ok: false; reason: string }).reason).toMatch(/VOD disabled/);
  });

  it('returns ok=false with reason for non-JSON / HTML responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>maintenance</html>', {
        headers: { 'content-type': 'text/html' },
      })),
    );
    const r = await __testing.fetchCatalog('http://x/y');
    expect(r.ok).toBe(false);
    // Parsing error (non valid JSON) — message comes from fetch's res.json() rejection.
    expect((r as { ok: false; reason: string }).reason).toBeTruthy();
  });

  it('returns ok=false with reason for HTTP 500', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 500 })),
    );
    const r = await __testing.fetchCatalog('http://x/y');
    expect(r.ok).toBe(false);
    expect((r as { ok: false; reason: string }).reason).toMatch(/HTTP 500/);
  });
});

describe('xtream.fetchCatalogWithRetry (BUG-1 §2.3 Step 3)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries once on failure and succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce(new Response(JSON.stringify([1, 2])));
    vi.stubGlobal('fetch', fetchMock);

    const promise = __testing.fetchCatalogWithRetry<number>('http://x/y', 'test');
    // advance backoff timer (RETRY_BACKOFF_MS = 1500)
    await vi.advanceTimersByTimeAsync(1600);
    const r = await promise;
    expect(r.ok).toBe(true);
    expect(r.ok && r.data).toEqual([1, 2]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns last failure reason after retry fails too', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockRejectedValueOnce(new Error('still failing'));
    vi.stubGlobal('fetch', fetchMock);

    const promise = __testing.fetchCatalogWithRetry('http://x/y', 'test');
    await vi.advanceTimersByTimeAsync(1600);
    const r = await promise;
    expect(r.ok).toBe(false);
    expect((r as { ok: false; reason: string }).reason).toMatch(/still failing|transient/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('xtream.loginXtream — cache poisoning prevention (BUG-1 §2.3 Step 1)', () => {
  beforeEach(() => {
    cacheStore.clear();
    vi.restoreAllMocks();
  });

  it('writes cache when all 3 blocks healthy', async () => {
    vi.stubGlobal(
      'fetch',
      buildFetchMock([
        { match: /player_api.php(?:\?[^/]*)?$|action=$/, response: AUTH_OK },
        { match: /action=get_live_categories/, response: [mkCat('cat-1', 'News')] },
        { match: /action=get_live_streams/,    response: [mkStream(101)] },
        { match: /action=get_vod_categories/,  response: [mkCat('cat-1', 'Action')] },
        { match: /action=get_vod_streams/,     response: [mkStream(201)] },
        { match: /action=get_series_categories/, response: [mkCat('cat-1', 'Drama')] },
        { match: /action=get_series/,          response: [{ series_id: 301, name: 'S1', category_id: 'cat-1' }] },
      ]),
    );

    const result = await loginXtream(CREDS, true);
    expect(result.health.live.status).toBe('ok');
    expect(result.health.vod.status).toBe('ok');
    expect(result.health.series.status).toBe('ok');
    // Cache must contain the result.
    const cacheKey = `content_${CREDS.url}_${CREDS.username}`;
    expect(cacheStore.has(cacheKey)).toBe(true);
  });

  it('does NOT write cache when only 1/3 blocks healthy (poisoning prevention)', async () => {
    vi.stubGlobal(
      'fetch',
      buildFetchMock([
        { match: /player_api.php(?:\?[^/]*)?$|action=$/, response: AUTH_OK },
        { match: /action=get_live_categories/, response: [mkCat('cat-1', 'News')] },
        { match: /action=get_live_streams/,    response: [mkStream(101)] },
        // VOD fails
        { match: /action=get_vod_categories/, response: { error: 'Disabled for account' } },
        { match: /action=get_vod_streams/,    response: { error: 'Disabled for account' } },
        // Series fails
        { match: /action=get_series_categories/, response: '<html>error</html>', status: 500 },
        { match: /action=get_series/,            response: '<html>error</html>', status: 500 },
      ]),
    );

    const result = await loginXtream(CREDS, true);
    expect(result.health.live.status).toBe('ok');
    expect(result.health.vod.status).toBe('error');
    expect(result.health.series.status).toBe('error');
    // Cache must NOT be written (only 1/3 healthy).
    const cacheKey = `content_${CREDS.url}_${CREDS.username}`;
    expect(cacheStore.has(cacheKey)).toBe(false);
  });

  it('preserves cached VOD when fresh fetch returns 0 items (regression guard)', async () => {
    const cacheKey = `content_${CREDS.url}_${CREDS.username}`;
    // Seed cache with 200 VOD items.
    const cached: XtreamContent = {
      live: [{ name: 'News', channels: Array.from({ length: 50 }, (_, i) => ({ id: String(i), name: `L${i}`, url: '' })) }],
      vod: [{ name: 'Action', channels: Array.from({ length: 200 }, (_, i) => ({ id: String(i + 1000), name: `M${i}`, url: '' })) }],
      series: [{ name: 'Drama', channels: Array.from({ length: 80 }, (_, i) => ({ id: `series-${i}`, name: `S${i}`, url: '' })) }],
      health: {
        live:   { status: 'ok', itemCount: 50 },
        vod:    { status: 'ok', itemCount: 200 },
        series: { status: 'ok', itemCount: 80 },
        fetchedAt: Date.now() - 60_000,
      },
    };
    cacheStore.set(cacheKey, cached);

    vi.stubGlobal(
      'fetch',
      buildFetchMock([
        { match: /player_api.php(?:\?[^/]*)?$|action=$/, response: AUTH_OK },
        { match: /action=get_live_categories/, response: [mkCat('cat-1', 'News')] },
        { match: /action=get_live_streams/,    response: [mkStream(101)] },
        // VOD returns empty array (regression)
        { match: /action=get_vod_categories/, response: [] },
        { match: /action=get_vod_streams/,    response: [] },
        { match: /action=get_series_categories/, response: [mkCat('cat-1', 'Drama')] },
        { match: /action=get_series/,            response: [{ series_id: 301, name: 'S1', category_id: 'cat-1' }] },
      ]),
    );

    const result = await loginXtream(CREDS, true);
    expect(result.health.vod.status).toBe('stale');
    // VOD categories must come from the cached snapshot.
    expect(result.vod[0].channels.length).toBe(200);
    expect(result.health.vod.reason).toMatch(/cache/i);
  });

  it('preserves cached VOD when fresh fetch errors out (regression guard #2)', async () => {
    const cacheKey = `content_${CREDS.url}_${CREDS.username}`;
    const cached: XtreamContent = {
      live: [{ name: 'News', channels: [{ id: '1', name: 'L1', url: '' }] }],
      vod: [{ name: 'Action', channels: [{ id: '2', name: 'M1', url: '' }, { id: '3', name: 'M2', url: '' }] }],
      series: [{ name: 'Drama', channels: [{ id: 'series-1', name: 'S1', url: '' }] }],
      health: {
        live:   { status: 'ok', itemCount: 1 },
        vod:    { status: 'ok', itemCount: 2 },
        series: { status: 'ok', itemCount: 1 },
        fetchedAt: Date.now() - 60_000,
      },
    };
    cacheStore.set(cacheKey, cached);

    vi.stubGlobal(
      'fetch',
      buildFetchMock([
        { match: /player_api.php(?:\?[^/]*)?$|action=$/, response: AUTH_OK },
        { match: /action=get_live_categories/, response: [mkCat('cat-1', 'News')] },
        { match: /action=get_live_streams/,    response: [mkStream(101)] },
        // VOD returns provider error
        { match: /action=get_vod_categories/, response: { error: 'Temporary unavailable' } },
        { match: /action=get_vod_streams/,    response: { error: 'Temporary unavailable' } },
        { match: /action=get_series_categories/, response: [mkCat('cat-1', 'Drama')] },
        { match: /action=get_series/,            response: [{ series_id: 301, name: 'S1', category_id: 'cat-1' }] },
      ]),
    );

    const result = await loginXtream(CREDS, true);
    expect(result.health.vod.status).toBe('stale');
    expect(result.vod[0].channels.length).toBe(2);
  });

  it('uses cached data verbatim on legacy entries (no health shape) with synthesized stale health', async () => {
    const cacheKey = `content_${CREDS.url}_${CREDS.username}`;
    // Legacy cache (pre BUG-1 fix) — no `health` field.
    const legacy = {
      live: [{ name: 'News', channels: [{ id: '1', name: 'L1', url: '' }] }],
      vod: [{ name: 'Action', channels: [{ id: '2', name: 'M1', url: '' }] }],
      series: [],
    } as unknown as XtreamContent;
    cacheStore.set(cacheKey, legacy);

    // Fetch must NOT be called — instant-start dalla cache. Il refresh in
    // background lo schedula App.tsx (fuori da loginXtream).
    const fetchMock = vi.fn(async () => {
      throw new Error('fetch should not be called on legacy cache instant-start');
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await loginXtream(CREDS, false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.health).toBeDefined();
    expect(result.health.fetchedAt).toBe(0); // marcatore "legacy → refresh me"
    expect(result.live[0].channels.length).toBe(1);
    expect(result.vod[0].channels.length).toBe(1);
    expect(stripFetchedAt(result.health)).toMatchObject({
      live:   { status: 'stale' },
      vod:    { status: 'stale' },
      series: { status: 'empty' },
    });
  });
});

describe('xtream.loginXtream — health UI exposure (BUG-1 §2.3 Step 4)', () => {
  beforeEach(() => {
    cacheStore.clear();
    vi.restoreAllMocks();
  });

  it('exposes "empty" status with explanatory reason when VOD legitimately empty', async () => {
    vi.stubGlobal(
      'fetch',
      buildFetchMock([
        { match: /player_api.php(?:\?[^/]*)?$|action=$/, response: AUTH_OK },
        { match: /action=get_live_categories/, response: [mkCat('cat-1', 'News')] },
        { match: /action=get_live_streams/,    response: [mkStream(101)] },
        { match: /action=get_vod_categories/,  response: [] },
        { match: /action=get_vod_streams/,     response: [] }, // truly empty
        { match: /action=get_series_categories/, response: [mkCat('cat-1', 'Drama')] },
        { match: /action=get_series/,          response: [{ series_id: 301, name: 'S1', category_id: 'cat-1' }] },
      ]),
    );

    const result = await loginXtream(CREDS, true);
    expect(result.health.vod.status).toBe('empty');
    expect(result.health.vod.reason).toMatch(/disabilitata|disabled|abbonamento|contenuto/i);
  });

  it('exposes "error" with provider message for { error: "..." } responses', async () => {
    vi.stubGlobal(
      'fetch',
      buildFetchMock([
        { match: /player_api.php(?:\?[^/]*)?$|action=$/, response: AUTH_OK },
        { match: /action=get_live_categories/, response: [mkCat('cat-1', 'News')] },
        { match: /action=get_live_streams/,    response: [mkStream(101)] },
        { match: /action=get_vod_categories/,  response: [] },
        { match: /action=get_vod_streams/,     response: { error: 'Access denied for this user' } },
        { match: /action=get_series_categories/, response: [mkCat('cat-1', 'Drama')] },
        { match: /action=get_series/,          response: [{ series_id: 301, name: 'S1', category_id: 'cat-1' }] },
      ]),
    );

    const result = await loginXtream(CREDS, true);
    expect(result.health.vod.status).toBe('error');
    expect(result.health.vod.reason).toMatch(/Access denied/);
  });

  // Bug fix (2026-05-15): le cover dei film non comparivano per i provider
  // che mettono il poster in `cover_big`/`movie_image` invece di
  // `stream_icon`. Il mapping di `processContent` ora applica un fallback
  // a catena. Le serie usano `cover` (gestito storicamente).
  it('maps VOD logo from cover_big / movie_image when stream_icon is missing', async () => {
    vi.stubGlobal(
      'fetch',
      buildFetchMock([
        { match: /player_api.php(?:\?[^/]*)?$|action=$/, response: AUTH_OK },
        { match: /action=get_live_categories/, response: [mkCat('cat-1', 'News')] },
        { match: /action=get_live_streams/,    response: [mkStream(101)] },
        { match: /action=get_vod_categories/,  response: [mkCat('cat-1', 'Movies')] },
        {
          match: /action=get_vod_streams/,
          response: [
            // provider A: solo cover_big (stream_icon vuoto)
            { stream_id: 201, name: 'M1', category_id: 'cat-1', container_extension: 'mp4', stream_icon: '', cover_big: 'http://cdn/poster-a.jpg' },
            // provider B: solo movie_image
            { stream_id: 202, name: 'M2', category_id: 'cat-1', container_extension: 'mkv', movie_image: 'http://cdn/poster-b.jpg' },
            // provider C: standard stream_icon
            { stream_id: 203, name: 'M3', category_id: 'cat-1', container_extension: 'mp4', stream_icon: 'http://cdn/poster-c.jpg' },
            // provider D: nessuna immagine → logo undefined (accettabile)
            { stream_id: 204, name: 'M4', category_id: 'cat-1', container_extension: 'mp4' },
          ],
        },
        { match: /action=get_series_categories/, response: [mkCat('cat-1', 'Drama')] },
        { match: /action=get_series/,            response: [{ series_id: 301, name: 'S1', category_id: 'cat-1', cover: 'http://cdn/series.jpg' }] },
      ]),
    );

    const result = await loginXtream(CREDS, true);
    const movies = result.vod[0].channels;
    expect(movies.find(c => c.name === 'M1')?.logo).toBe('http://cdn/poster-a.jpg');
    expect(movies.find(c => c.name === 'M2')?.logo).toBe('http://cdn/poster-b.jpg');
    expect(movies.find(c => c.name === 'M3')?.logo).toBe('http://cdn/poster-c.jpg');
    expect(movies.find(c => c.name === 'M4')?.logo).toBeUndefined();
    // Sanity check: le serie continuano a popolare logo da `cover`.
    expect(result.series[0].channels[0].logo).toBe('http://cdn/series.jpg');
  });
});

