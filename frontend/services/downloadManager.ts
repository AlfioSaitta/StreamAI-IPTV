
import { CacheService } from './cacheService.ts';
import { proxyFetch } from './proxyFetch.ts';

// Configurazione
const MAX_CONCURRENT_DOWNLOADS = 10; // Download paralleli aumentati per Wails
const DOWNLOAD_TIMEOUT_MS = 15000; // Timeout leggermente aumentato

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
  failedUrls: new Set<string>(),

  // Statistiche
  stats: {
    downloaded: 0,
    failed: 0,
    fromCache: 0,
    totalBytes: 0
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
    if (DownloadManager.failedUrls.has(url)) {
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
  download: async (url: string, _priority: number, signal?: AbortSignal): Promise<string | null> => {
    if (DownloadManager.paused || signal?.aborted) return url;

    DownloadManager.queued.add(url);

    try {
      // Limita concorrenza
      while (DownloadManager.processing.size >= MAX_CONCURRENT_DOWNLOADS) {
        if (DownloadManager.paused || signal?.aborted) return url;
        await new Promise(r => setTimeout(r, 50));
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
          DownloadManager.failedUrls.add(url);
          DownloadManager.stats.failed++;
          resolveWaiting(url);
          return url;
        }

        const blob = await response.blob();
        if (DownloadManager.paused || signal?.aborted) return url;

        // Verifica che sia un'immagine valida
        if (!blob.type.startsWith('image/') && blob.size < 100) {
          DownloadManager.failedUrls.add(url);
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
          DownloadManager.failedUrls.add(url);
          DownloadManager.stats.failed++;
        }

        resolveWaiting(url);
        return url;
      }
    } finally {
      DownloadManager.queued.delete(url);
      DownloadManager.processing.delete(url);
    }
  },

  // Precarica immagini visibili (chiamato quando si scrolla)
  preloadVisible: (urls: string[]) => {
    const validUrls = urls.filter(u =>
      u?.startsWith('http') &&
      !DownloadManager.cachedUrls.has(u) &&
      !DownloadManager.processing.has(u) &&
      !DownloadManager.failedUrls.has(u)
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
