
import { CacheService } from './cacheService.ts';

// Configurazione
const MAX_CONCURRENT_DOWNLOADS = 6; // Download paralleli
const DOWNLOAD_TIMEOUT_MS = 10000;

export const DownloadManager = {
  // Coda per download on-demand
  queue: new Map<string, {
    resolve: (url: string | null) => void,
    priority: number
  }>(),
  processing: new Set<string>(),
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
    DownloadManager.queue.forEach(({ resolve }, url) => {
      resolve(url);
    });
    DownloadManager.queue.clear();
    DownloadManager.processing.clear();
  },

  // Riprendi i download
  resume: () => {
    DownloadManager.paused = false;
  },

  // Verifica se è in pausa
  isPaused: () => DownloadManager.paused,

  // Richiedi un'immagine (chiamato da CachedImage)
  // Ritorna l'URL dell'immagine (da cache o scaricata)
  requestImage: async (url: string, priority: number = 1): Promise<string | null> => {
    if (!url || !url.startsWith('http')) return null;

    // Se in pausa, ritorna URL originale senza scaricare
    if (DownloadManager.paused) {
      return url;
    }

    // 1. Check memoria locale
    if (DownloadManager.cachedUrls.has(url)) {
      DownloadManager.stats.fromCache++;
      return CacheService.getImage(url);
    }

    // 2. Check se già fallito di recente
    if (DownloadManager.failedUrls.has(url)) {
      return url; // Ritorna URL originale, lascia che il browser gestisca
    }

    // 3. Check IndexedDB
    const cached = await CacheService.getImage(url);
    if (cached) {
      DownloadManager.cachedUrls.add(url);
      DownloadManager.stats.fromCache++;
      return cached;
    }

    // 4. Se già in download, attendi
    if (DownloadManager.processing.has(url)) {
      return new Promise((resolve) => {
        const existing = DownloadManager.queue.get(url);
        if (existing) {
          // Aggiorna priorità se maggiore
          if (priority > existing.priority) {
            existing.priority = priority;
          }
          const originalResolve = existing.resolve;
          existing.resolve = (result) => {
            originalResolve(result);
            resolve(result);
          };
        } else {
          DownloadManager.queue.set(url, { resolve, priority });
        }
      });
    }

    // 5. Avvia download
    return DownloadManager.download(url, priority);
  },

  // Download effettivo
  download: async (url: string, priority: number): Promise<string | null> => {
    // Se in pausa, ritorna URL originale
    if (DownloadManager.paused) {
      return url;
    }

    // Limita concorrenza
    while (DownloadManager.processing.size >= MAX_CONCURRENT_DOWNLOADS) {
      if (DownloadManager.paused) return url;
      await new Promise(r => setTimeout(r, 50));
    }

    if (DownloadManager.paused) return url;

    DownloadManager.processing.add(url);

    if (!DownloadManager.abortController) {
      DownloadManager.abortController = new AbortController();
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

      const response = await fetch(url, {
        mode: 'cors',
        credentials: 'omit',
        signal: controller.signal,
        headers: {
          'User-Agent': 'StreamAI IPTV',
          'Accept': 'image/webp,image/*,*/*;q=0.8'
        }
      });

      clearTimeout(timeoutId);

      if (DownloadManager.paused) return url;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const blob = await response.blob();

      if (DownloadManager.paused) return url;

      // Verifica che sia un'immagine valida
      if (!blob.type.startsWith('image/') && blob.size < 100) {
        throw new Error('Invalid image');
      }

      // Salva in cache
      await CacheService.saveImage(url, blob);
      DownloadManager.cachedUrls.add(url);
      DownloadManager.stats.downloaded++;
      DownloadManager.stats.totalBytes += blob.size;

      // Ottieni URL dalla cache
      const cachedUrl = await CacheService.getImage(url);

      // Notifica chi sta aspettando
      const waiting = DownloadManager.queue.get(url);
      if (waiting) {
        waiting.resolve(cachedUrl);
        DownloadManager.queue.delete(url);
      }

      return cachedUrl;

    } catch (e: any) {
      if (e.name !== 'AbortError') {
        DownloadManager.failedUrls.add(url);
        DownloadManager.stats.failed++;
      }

      // Notifica chi sta aspettando
      const waiting = DownloadManager.queue.get(url);
      if (waiting) {
        waiting.resolve(url); // Ritorna URL originale come fallback
        DownloadManager.queue.delete(url);
      }

      return url; // Ritorna URL originale, il browser proverà a caricarla
    } finally {
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
    ).slice(0, 10); // Max 10 preload

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
