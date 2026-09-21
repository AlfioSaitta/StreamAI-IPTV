// @vitest-environment jsdom
/**
 * Precaricamento "in avanti" delle copertine.
 *
 * Il prefetch che serve a rendere fluido lo scorrimento deve restare **fuori**
 * dai momenti in cui l'utente sta scorrendo: lì banda e CPU servono alle
 * immagini che ha sotto gli occhi. Qui si verifica che parta solo quando la
 * macchina è inattiva, che rispetti il tetto della pipeline (non si accoda
 * quando è piena) e che funzioni anche dove `requestIdleCallback` non esiste.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  started: [] as string[],
  pending: new Map<string, () => void>(),
}));

vi.mock('../../services/cacheService.ts', () => ({
  CacheService: {
    getImage: vi.fn(async () => null),
    saveImage: vi.fn(async () => undefined),
  },
}));

vi.mock('../../services/proxyFetch.ts', () => ({
  proxyFetch: vi.fn(async (url: string) => {
    h.started.push(url);
    await new Promise<void>((resolve) => h.pending.set(url, resolve));
    return { ok: true, blob: async () => ({ type: 'image/jpeg', size: 1024 }) };
  }),
}));

import { DownloadManager } from '../../services/downloadManager.ts';

const IMG = (n: number) => `https://image.tmdb.org/t/p/w300/cover-${n}.jpg`;

const flush = async (times = 6) => {
  for (let i = 0; i < times; i++) await Promise.resolve();
};

describe('DownloadManager — prefetch in background', () => {
  beforeEach(() => {
    h.started.length = 0;
    h.pending.clear();
    DownloadManager.reset();
    DownloadManager.paused = false;
    DownloadManager.cachedUrls.clear();
    DownloadManager.stats.preloadSkipped = 0;
  });

  afterEach(() => {
    DownloadManager.reset();
    vi.useRealTimers();
    delete (window as unknown as { requestIdleCallback?: unknown }).requestIdleCallback;
  });

  it('accoda i download solo quando la macchina è inattiva', async () => {
    const idle: Array<() => void> = [];
    Object.defineProperty(window, 'requestIdleCallback', {
      configurable: true,
      value: (cb: () => void) => {
        idle.push(cb);
        return idle.length;
      },
    });

    DownloadManager.preloadLater([IMG(1), IMG(2)]);
    await flush();

    // Nulla è partito: il lavoro è stato solo *programmato*.
    expect(idle).toHaveLength(1);
    expect(h.started).toEqual([]);

    idle[0]();
    await flush();

    expect(h.started).toEqual([IMG(1), IMG(2)]);
  });

  it('senza requestIdleCallback usa un ritardo, sempre in differita', async () => {
    vi.useFakeTimers();
    // WebKitGTK non espone requestIdleCallback: il fallback non deve partire
    // subito, altrimenti competerebbe con lo scroll in corso.
    DownloadManager.preloadLater([IMG(3)]);
    await flush();
    expect(h.started).toEqual([]);

    vi.advanceTimersByTime(1000);
    await flush();
    expect(h.started).toEqual([IMG(3)]);
  });

  it('rispetta il tetto della pipeline: non si accoda se è già piena', async () => {
    const idle: Array<() => void> = [];
    Object.defineProperty(window, 'requestIdleCallback', {
      configurable: true,
      value: (cb: () => void) => {
        idle.push(cb);
        return idle.length;
      },
    });

    // 10 in volo + 14 in attesa = il tetto.
    for (let i = 0; i < 24; i++) void DownloadManager.requestImage(IMG(i), 0);
    await flush();
    expect(h.started).toHaveLength(10);

    DownloadManager.preloadLater([IMG(100)]);
    idle.forEach(cb => cb());
    await flush();

    expect(DownloadManager.stats.preloadSkipped).toBeGreaterThan(0);
    expect(h.started).not.toContain(IMG(100));
  });

  it('non fa nulla con una lista vuota', async () => {
    const idle = vi.fn();
    Object.defineProperty(window, 'requestIdleCallback', { configurable: true, value: idle });

    DownloadManager.preloadLater([]);
    await flush();

    expect(idle).not.toHaveBeenCalled();
  });
});
