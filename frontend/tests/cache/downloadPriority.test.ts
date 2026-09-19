// @vitest-environment jsdom
/**
 * Priorità nella coda dei download delle copertine.
 *
 * Il difetto: `download()` riceveva la priorità e la ignorava (il parametro si
 * chiamava `_priority`), e l'attesa per uno slot era FIFO. Risultato: i prefetch
 * delle righe già oltre lo schermo occupavano gli slot e restavano **davanti**
 * alle copertine visibili, che comparivano con secondi di ritardo mentre si
 * scorreva il catalogo.
 *
 * Qui si verifica la proprietà che conta: quando uno slot si libera, deve
 * entrare la richiesta visibile, non il prefetch che era in coda da più tempo.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  /** URL passati a proxyFetch, in ordine di avvio effettivo. */
  started: [] as string[],
  /** Risolutori dei download in volo, per controllarli dall'esterno. */
  pending: new Map<string, () => void>(),
}));

vi.mock('../../services/cacheService.ts', () => ({
  CacheService: {
    // Round-trip fedele: dopo `saveImage` la lettura ritorna un object URL. Con
    // un `getImage` sempre nullo il test non distinguerebbe "scaricata e messa
    // in cache" da "fallita".
    getImage: vi.fn(async (url: string) => (saved.has(url) ? `blob:${url}` : null)),
    saveImage: vi.fn(async (url: string) => {
      saved.add(url);
    }),
  },
}));

const saved = vi.hoisted(() => new Set<string>());

vi.mock('../../services/proxyFetch.ts', () => ({
  proxyFetch: vi.fn(async (url: string) => {
    h.started.push(url);
    await new Promise<void>((resolve) => h.pending.set(url, resolve));
    return {
      ok: true,
      blob: async () => ({ type: 'image/jpeg', size: 1024 }),
    };
  }),
}));

import { DownloadManager } from '../../services/downloadManager.ts';

/** Lascia girare i microtask: le richieste passano da CacheService prima di proxyFetch. */
const flush = async (times = 6) => {
  for (let i = 0; i < times; i++) await Promise.resolve();
};

/** Completa il download di `url` (il proxyFetch finto si sblocca qui). */
const complete = async (url: string) => {
  h.pending.get(url)?.();
  await flush();
};

const IMG = (n: number) => `https://image.tmdb.org/t/p/w300/cover-${n}.jpg`;

describe('DownloadManager — priorità delle copertine', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    h.started.length = 0;
    h.pending.clear();
    saved.clear();
    DownloadManager.reset();
    DownloadManager.paused = false;
    DownloadManager.cachedUrls.clear();
    DownloadManager.stats.preloadSkipped = 0;
    await flush();
  });

  afterEach(() => {
    DownloadManager.reset();
  });

  it('una copertina visibile supera i prefetch già in coda', async () => {
    // 10 prefetch: riempiono tutti gli slot e restano in volo (nessuno completa).
    for (let i = 0; i < 10; i++) void DownloadManager.requestImage(IMG(i), 0);
    await flush();
    expect(h.started).toHaveLength(10);

    // Altri prefetch: non c'è posto, restano in attesa.
    for (let i = 10; i < 18; i++) void DownloadManager.requestImage(IMG(i), 0);
    await flush();
    expect(h.started).toHaveLength(10);

    // Ora l'utente scorre e una copertina entra nello schermo (priorità alta).
    const visible = IMG(99);
    const visibleDone = DownloadManager.requestImage(visible, 2);
    await flush();
    // Nessuno slot libero: anche lei aspetta.
    expect(h.started).not.toContain(visible);

    // Si libera uno slot: deve entrare lei, non il prefetch più vecchio in coda.
    await complete(IMG(0));

    expect(h.started).toContain(visible);
    expect(h.started).toHaveLength(11);
    // Il primo prefetch in attesa (IMG(10)) è ancora lì: la coda non è FIFO.
    expect(h.started).not.toContain(IMG(10));

    await complete(visible);
    await expect(visibleDone).resolves.toBeTruthy();
  });

  it('fra prefetch di pari priorità vince il più recente', async () => {
    for (let i = 0; i < 10; i++) void DownloadManager.requestImage(IMG(i), 0);
    await flush();

    // Righe diverse in attesa: la prima chiesta è quella che l'utente ha già
    // superato, l'ultima è quella sotto i suoi occhi.
    for (let i = 10; i < 15; i++) void DownloadManager.requestImage(IMG(i), 0);
    await flush();
    const newestPrefetch = IMG(14);

    await complete(IMG(0));

    expect(h.started).toContain(newestPrefetch);
    expect(h.started).not.toContain(IMG(10));
  });

  it('i prefetch non si accodano quando la pipeline è già piena', async () => {
    // 10 in volo + 14 in attesa = 24, cioè il tetto.
    for (let i = 0; i < 24; i++) void DownloadManager.requestImage(IMG(i), 0);
    await flush();
    expect(h.started).toHaveLength(10);

    DownloadManager.preloadVisible(Array.from({ length: 20 }, (_, i) => IMG(100 + i)));
    await flush();

    expect(DownloadManager.stats.preloadSkipped).toBe(1);
    // Nessuno dei nuovi prefetch è partito: gli slot sono occupati.
    expect(h.started).toHaveLength(10);
    expect(h.started).not.toContain(IMG(100));

    // Una richiesta visibile invece parte appena si libera uno slot: il tetto
    // vale solo per i prefetch.
    const visible = IMG(999);
    void DownloadManager.requestImage(visible, 2);
    await flush();
    await complete(IMG(0));
    expect(h.started).toContain(visible);
  });
});
