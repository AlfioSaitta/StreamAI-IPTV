
import { CacheService } from './cacheService.ts';
import { proxyFetch } from './proxyFetch.ts';

// Configurazione
const MAX_CONCURRENT_DOWNLOADS = 10; // Download paralleli aumentati per Wails
const DOWNLOAD_TIMEOUT_MS = 15000; // Timeout leggermente aumentato

/**
 * Quanti download (in corso + in attesa) oltre i quali i prefetch smettono di
 * accodarsi. Vedi `preloadVisible`.
 */
const PRELOAD_QUEUE_LIMIT = 24;

/** Per quanto un URL resta escluso dopo un fallimento, prima di poter ritentare. */
const FAILED_URL_TTL_MS = 5 * 60 * 1000;

/**
 * Attese per uno slot di download libero, **ordinate per priorità**.
 *
 * Erano una semplice coda FIFO, e il parametro `priority` veniva ignorato (si
 * chiamava `_priority`): così i prefetch delle righe già superate restavano in
 * testa e le copertine visibili aspettavano dietro decine di immagini che
 * nessuno stava più guardando. È la differenza fra "le copertine compaiono
 * mentre scorri" e "compaiono dopo".
 *
 * A parità di priorità vince il **più recente**: fra due prefetch, quello
 * appena chiesto è la riga che l'utente sta guardando adesso, l'altro è quella
 * che ha già lasciato indietro.
 */
interface SlotWaiter {
  priority: number;
  seq: number;
  wake: () => void;
}

const slotWaiters: SlotWaiter[] = [];
let waiterSeq = 0;

/** Estrae il waiter da servire: priorità più alta, a parità il più recente. */
const takeNextWaiter = (): SlotWaiter | undefined => {
  let bestIdx = -1;
  for (let i = 0; i < slotWaiters.length; i++) {
    if (bestIdx === -1) {
      bestIdx = i;
      continue;
    }
    const candidate = slotWaiters[i];
    const best = slotWaiters[bestIdx];
    if (candidate.priority > best.priority || (candidate.priority === best.priority && candidate.seq > best.seq)) {
      bestIdx = i;
    }
  }
  return bestIdx === -1 ? undefined : slotWaiters.splice(bestIdx, 1)[0];
};

/**
 * Rilascia lo slot di `url` e sveglia il waiter con la priorità più alta.
 * Ogni percorso di uscita di `download` passa da qui (via `finally`), cosi' lo
 * slot non puo' restare occupato per sempre.
 */
const releaseSlot = (url: string): void => {
  DownloadManager.processing.delete(url);
  takeNextWaiter()?.wake();
};

/**
 * Attende che si liberi uno slot. Risolve `false` se nel frattempo arriva un
 * abort (il waiter viene tolto dalla coda, cosi' non resta appeso).
 */
const waitForSlot = (priority: number, signal?: AbortSignal): Promise<boolean> =>
  new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(false);
      return;
    }
    const waiter: SlotWaiter = {
      priority,
      seq: ++waiterSeq,
      wake: () => {
        signal?.removeEventListener('abort', onAbort);
        resolve(true);
      },
    };
    const onAbort = () => {
      const idx = slotWaiters.indexOf(waiter);
      if (idx !== -1) slotWaiters.splice(idx, 1);
      resolve(false);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    slotWaiters.push(waiter);
  });

/** Marca `url` come fallito per `FAILED_URL_TTL_MS`. */
const markUrlFailed = (url: string): void => {
  DownloadManager.failedUrls.set(url, Date.now() + FAILED_URL_TTL_MS);
};

/** True se `url` e' fallito di recente (le voci scadute vengono ripulite qui). */
const isUrlFailed = (url: string): boolean => {
  const expiresAt = DownloadManager.failedUrls.get(url);
  if (expiresAt === undefined) return false;
  if (expiresAt <= Date.now()) {
    DownloadManager.failedUrls.delete(url);
    return false;
  }
  return true;
};

// noinspection JSUnusedGlobalSymbols
export const DownloadManager = {
  // Coda per download on-demand
  queue: new Map<string, {
    resolves: Array<(url: string | null) => void>,
    priority: number,
    signal?: AbortSignal
  }>(),
  processing: new Set<string>(),
  queued: new Set<string>(), // Nuova tracciabilità per evitare duplicati in attesa
  abortController: null as AbortController | null,

  // Stato pausa globale (per streaming live)
  paused: false,

  // Cache URL già scaricati (evita richieste duplicate)
  cachedUrls: new Set<string>(),
  /**
   * URL falliti di recente: `url -> timestamp di scadenza`.
   *
   * Prima era un `Set` senza scadenza: un fallimento transitorio (timeout sotto
   * carico, rete instabile) escludeva quell'immagine per TUTTA la sessione e per
   * tutti i profili, senza alcun modo di ritentarla se non svuotando la lista a
   * mano dalle impostazioni.
   */
  failedUrls: new Map<string, number>(),

  // Statistiche
  stats: {
    downloaded: 0,
    failed: 0,
    fromCache: 0,
    totalBytes: 0,
    /** Prefetch non accodati perché la pipeline era già piena (vedi preloadVisible). */
    preloadSkipped: 0
  },

  // Pausa tutti i download (chiamato quando si avvia un live)
  pause: () => {
    DownloadManager.paused = true;
    // Annulla download in corso
    if (DownloadManager.abortController) {
      DownloadManager.abortController.abort();
      DownloadManager.abortController = null;
    }
    // Risolvi tutte le richieste in attesa con URL originale
    DownloadManager.queue.forEach(({ resolves }, url) => {
      resolves.forEach(resolve => resolve(url));
    });
    DownloadManager.queue.clear();
    DownloadManager.processing.clear();
    DownloadManager.queued.clear();

    // Sveglia le attese in coda per uno slot: ognuna rivaluta `paused` ed esce
    // restituendo l'URL originale. Senza questo resterebbero parcheggiate fino
    // al prossimo slot liberato (o al timeout di un download in volo).
    const waiters = slotWaiters.splice(0, slotWaiters.length);
    waiters.forEach(waiter => waiter.wake());
  },

  // Riprendi i download
  resume: () => {
    DownloadManager.paused = false;
  },

  // Verifica se è in pausa
  isPaused: () => DownloadManager.paused,

  // Richiedi un'immagine (chiamato da CachedImage)
  // Ritorna l'URL dell'immagine (da cache o scaricata)
  requestImage: async (url: string, priority: number = 1, signal?: AbortSignal): Promise<string | null> => {
    if (!url || !url.startsWith('http')) return null;

    if (signal?.aborted) return url;

    // Se in pausa, ritorna URL originale senza scaricare
    if (DownloadManager.paused) {
      return url;
    }

    // 1. Check memoria locale
    if (DownloadManager.cachedUrls.has(url)) {
      const cached = await CacheService.getImage(url);
      if (cached) {
        DownloadManager.stats.fromCache++;
        return cached;
      }
      DownloadManager.cachedUrls.delete(url);
    }

    // 2. Check se già fallito di recente
    if (isUrlFailed(url)) {
      return url;
    }

    // 3. Check IndexedDB
    const cached = await CacheService.getImage(url);
    if (cached) {
      DownloadManager.cachedUrls.add(url);
      DownloadManager.stats.fromCache++;
      return cached;
    }

    // 4. Se già in download o in coda, attendi
    if (DownloadManager.processing.has(url) || DownloadManager.queued.has(url)) {
      return new Promise((resolve) => {
        const existing = DownloadManager.queue.get(url);
        if (existing) {
          if (priority > existing.priority) existing.priority = priority;
          existing.resolves.push(resolve);
        } else {
          DownloadManager.queue.set(url, { resolves: [resolve], priority, signal });
        }
        
        // Se il nuovo segnale viene abortito, risolvi subito con fallback
        signal?.addEventListener('abort', () => {
          const stillThere = DownloadManager.queue.get(url);
          if (stillThere) {
            const idx = stillThere.resolves.indexOf(resolve);
            if (idx !== -1) {
              stillThere.resolves.splice(idx, 1);
              resolve(url);
            }
          }
        }, { once: true });
      });
    }

    // 5. Avvia download
    return DownloadManager.download(url, priority, signal);
  },

  // Download effettivo
  download: async (url: string, priority: number, signal?: AbortSignal): Promise<string | null> => {
    if (DownloadManager.paused || signal?.aborted) return url;

    DownloadManager.queued.add(url);

    try {
      // Limita concorrenza attendendo la liberazione di uno slot, senza polling.
      // Il busy-wait precedente (`setTimeout(50)` in un while) con 200 richieste
      // in coda lasciava ~190 waiter che si risvegliavano 20 volte al secondo,
      // cioe' ~3800 timer/s di pura attesa sul main thread.
      while (DownloadManager.processing.size >= MAX_CONCURRENT_DOWNLOADS) {
        if (DownloadManager.paused || signal?.aborted) return url;
        const gotSlot = await waitForSlot(priority, signal);
        if (!gotSlot || DownloadManager.paused || signal?.aborted) return url;
      }

      if (DownloadManager.paused || signal?.aborted) return url;

      DownloadManager.queued.delete(url);
      DownloadManager.processing.add(url);

      const resolveWaiting = (result: string | null) => {
        const waiting = DownloadManager.queue.get(url);
        if (waiting) {
          waiting.resolves.forEach(resolve => resolve(result));
          DownloadManager.queue.delete(url);
        }
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
      
      // Abort interno se viene abortito il segnale esterno
      const onAbort = () => controller.abort();
      signal?.addEventListener('abort', onAbort);

      try {
        const response = await proxyFetch(url, {
          mode: 'cors',
          credentials: 'omit',
          signal: controller.signal,
          headers: {
            'Accept': 'image/webp,image/*,*/*;q=0.8'
          }
        });

        clearTimeout(timeoutId);
        signal?.removeEventListener('abort', onAbort);

        if (DownloadManager.paused || signal?.aborted) return url;
        if (!response.ok) {
          markUrlFailed(url);
          DownloadManager.stats.failed++;
          resolveWaiting(url);
          return url;
        }

        const blob = await response.blob();
        if (DownloadManager.paused || signal?.aborted) return url;

        // Verifica che sia un'immagine valida
        if (!blob.type.startsWith('image/') && blob.size < 100) {
          markUrlFailed(url);
          DownloadManager.stats.failed++;
          resolveWaiting(url);
          return url;
        }

        // Salva in cache
        await CacheService.saveImage(url, blob);
        DownloadManager.cachedUrls.add(url);
        DownloadManager.stats.downloaded++;
        DownloadManager.stats.totalBytes += blob.size;

        // Ottieni URL dalla cache
        const cachedUrl = await CacheService.getImage(url);
        resolveWaiting(cachedUrl);
        return cachedUrl;

      } catch (e: any) {
        clearTimeout(timeoutId);
        signal?.removeEventListener('abort', onAbort);
        
        if (e.name !== 'AbortError' && !signal?.aborted) {
          markUrlFailed(url);
          DownloadManager.stats.failed++;
        }

        resolveWaiting(url);
        return url;
      }
    } finally {
      DownloadManager.queued.delete(url);
      releaseSlot(url);
    }
  },

  // Precarica immagini visibili (chiamato quando si scrolla)
  preloadVisible: (urls: string[]) => {
    // Backpressure: se la pipeline è già piena, i prefetch non si accodano.
    // Servono a rendere fluido lo scorrimento; se invece lo rallentano — perché
    // occupano gli slot che servono alle copertine sotto gli occhi dell'utente —
    // hanno smesso di servire a qualcosa. Le richieste visibili non passano di
    // qui e non sono soggette a questo tetto.
    if (DownloadManager.processing.size + DownloadManager.queued.size >= PRELOAD_QUEUE_LIMIT) {
      DownloadManager.stats.preloadSkipped++;
      return;
    }

    const validUrls = urls.filter(u =>
      u?.startsWith('http') &&
      !DownloadManager.cachedUrls.has(u) &&
      !DownloadManager.processing.has(u) &&
      !isUrlFailed(u)
    ).slice(0, 20); // Max 20 preload (aumentato da 10 dopo ottimizzazione abort)

    // Avvia download con priorità bassa (non bloccante)
    validUrls.forEach(url => {
      DownloadManager.requestImage(url, 0);
    });
  },

  // Cancella URL falliti per permettere retry
  clearFailed: () => {
    DownloadManager.failedUrls.clear();
  },

  // Reset completo
  reset: () => {
    if (DownloadManager.abortController) {
      DownloadManager.abortController.abort();
      DownloadManager.abortController = null;
    }
    DownloadManager.queue.clear();
    DownloadManager.processing.clear();
    DownloadManager.queued.clear();
    DownloadManager.failedUrls.clear();
  },

  getStats: () => ({
    ...DownloadManager.stats,
    queueSize: DownloadManager.queue.size,
    processing: DownloadManager.processing.size,
    cached: DownloadManager.cachedUrls.size,
    failed: DownloadManager.failedUrls.size
  })
};
