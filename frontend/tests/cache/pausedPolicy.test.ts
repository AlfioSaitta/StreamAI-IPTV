// @vitest-environment jsdom
/**
 * Politica dei download mentre si guarda un canale live.
 *
 * Durante un live la banda è dello stream, e scaricare immagini è una causa
 * diretta di rebuffering. La regola non è però "niente immagini": è
 *
 *  - **ciò che è già in cache si mostra sempre** (non costa banda);
 *  - **ciò che è sotto gli occhi dell'utente si scarica**, con poche
 *    connessioni e finendo nella cache su disco condivisa, quindi pagandolo una
 *    volta sola;
 *  - **il prefetch resta fermo**: nessuno sta guardando quelle immagini.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  started: [] as string[],
  pending: new Map<string, () => void>(),
  /** Voce già presente prima della richiesta (per il caso "è in cache"). */
  cached: null as string | null,
  /** URL salvati durante il test: il round-trip save→get deve funzionare. */
  saved: new Set<string>(),
}));

vi.mock('../../services/cacheService.ts', () => ({
  CacheService: {
    getImage: vi.fn(async (url: string) =>
      h.cached ?? (h.saved.has(url) ? `blob:${url}` : null),
    ),
    saveImage: vi.fn(async (url: string) => {
      h.saved.add(url);
    }),
  },
}));

vi.mock('../../services/proxyFetch.ts', () => ({
  resolveProxyURL: (url: string) => url,
  proxyFetch: vi.fn(async (url: string) => {
    h.started.push(url);
    await new Promise<void>((resolve) => h.pending.set(url, resolve));
    return { ok: true, blob: async () => ({ type: 'image/jpeg', size: 1024 }) };
  }),
}));

import { DownloadManager } from '../../services/downloadManager.ts';

const IMG = (n: number) => `https://image.tmdb.org/t/p/w300/cover-${n}.jpg`;

const flush = async (times = 8) => {
  for (let i = 0; i < times; i++) await Promise.resolve();
};

describe('DownloadManager — immagini durante un live', () => {
  beforeEach(() => {
    h.started.length = 0;
    h.pending.clear();
    h.cached = null;
    h.saved.clear();
    DownloadManager.reset();
    DownloadManager.cachedUrls.clear();
    DownloadManager.paused = false;
  });

  afterEach(() => {
    DownloadManager.resume();
    DownloadManager.reset();
  });

  it('in pausa il prefetch non scarica nulla', async () => {
    DownloadManager.pause();

    await DownloadManager.requestImage(IMG(1), 0);
    await flush();

    expect(h.started).toEqual([]);
  });

  it('in pausa un’immagine visibile viene scaricata lo stesso', async () => {
    DownloadManager.pause();

    const pronta = DownloadManager.requestImage(IMG(2), 1);
    await flush();

    expect(h.started).toEqual([IMG(2)]);
    h.pending.get(IMG(2))?.();
    await expect(pronta).resolves.toBeTruthy();
  });

  it('in pausa si mostrano le immagini già in cache senza scaricare', async () => {
    DownloadManager.pause();
    h.cached = 'blob:gia-in-cache';

    await expect(DownloadManager.requestImage(IMG(3), 2)).resolves.toBe('blob:gia-in-cache');
    await flush();

    expect(h.started).toEqual([]);
    expect(DownloadManager.stats.fromCache).toBeGreaterThan(0);
  });

  // La banda dello stream va protetta: durante un live le connessioni sono
  // poche, non dieci.
  it('in pausa il numero di download paralleli è ridotto', async () => {
    DownloadManager.pause();

    for (let i = 0; i < 8; i++) void DownloadManager.requestImage(IMG(10 + i), 1);
    await flush();

    expect(h.started).toHaveLength(4);
  });
});
