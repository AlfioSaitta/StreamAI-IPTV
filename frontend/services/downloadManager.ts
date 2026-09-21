
import { CacheService } from './cacheService.ts';
import { proxyFetch, resolveProxyURL } from './proxyFetch.ts';

// Configurazione
const MAX_CONCURRENT_DOWNLOADS = 10; // Download paralleli aumentati per Wails
const DOWNLOAD_TIMEOUT_MS = 15000; // Timeout leggermente aumentato

/**
 * Quanti download (in corso + in attesa) oltre i quali i prefetch smettono di
 * accodarsi. Vedi `preloadVisible`.
 */
const PRELOAD_QUEUE_LIMIT = 24;

/**
 * Quanti download sono ammessi **mentre si guarda un canale live**.
 *
 * Durante un live la banda è dello stream, e scaricare immagini è una causa
 * diretta di rebuffering. Ma le copertine che l'utente ha davanti vanno
 * mostrate: senza, navigare il catalogo mentre si guarda qualcosa diventa un
 * muro di segnaposto. La via di mezzo è questa — poche connessioni, solo per le
 * immagini visibili — sapendo che finiscono nella cache su disco condivisa,
 * quindi si pagano una volta sola.
 */
const PAUSED_MAX_CONCURRENT_DOWNLOADS = 4;

/**
 * Priorità minima per scaricare durante la pausa: sotto questa soglia il lavoro
 * è prefetch, e in pausa resta fermo.
 */
const VISIBLE_PRIORITY_MIN = 1;

/**
 * `requestIdleCallback` non esiste in tutte le webview (WebKitGTK non lo espone)
 * e non è nel lib DOM di tutte le versioni di TypeScript: lo dichiariamo qui
 * invece di dipendere dal tipo globale.
 */
type IdleCapableWindow = Window & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
};

/** Per quanto un URL resta escluso dopo un fallimento, prima di poter ritentare. */
const FAILED_URL_TTL_MS = 5 * 60 * 1000;

/**
 * True se, con un canale in riproduzione, questa richiesta non ha diritto alla
 * banda: sotto `VISIBLE_PRIORITY_MIN` il lavoro è prefetch, e in pausa resta
 * fermo.
 *
 * È l'unica definizione della regola. La usa `requestImage` per rifiutare, e
 * `CachedImage` per capire che il valore tornato è un rifiuto — non una copia da
 * mostrare — e che quindi non deve finire comunque in un `<img src>`.
 */
const isDownloadBlockedWhilePlaying = (priority: number): boolean =>
  DownloadManager.paused && priority < VISIBLE_PRIORITY_MIN;

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

  // Pausa il lavoro *nuovo* sulle immagini (chiamato quando si avvia un live)
  pause: () => {
    DownloadManager.paused = true;
    // I download già in volo NON vengono annullati: i byte sono già stati
    // spesi, e portarli a termine li mette in cache invece di buttarli. A
    // fermare il lavoro nuovo ci pensano il tetto ridotto in `download` e la
    // soglia di priorità in `requestImage`.
    //
    // (Qui c'era un `abortController.abort()`, ma quel campo non veniva mai
    // assegnato da nessuno: dava l'impressione di interrompere i download in
    // corso senza interrompere nulla.)
    //
    // Risolvi tutte le richieste in attesa con URL originale
    DownloadManager.queue.forEach(({ resolves }, url) => {
      resolves.forEach(resolve => resolve(url));
    });
    DownloadManager.queue.clear();
    DownloadManager.queued.clear();
    // `processing` NON viene svuotato: i download in volo proseguono davvero, e
    // azzerare il contatore ora ammetterebbe più lavoro del tetto ridotto.

    // Sveglia le attese in coda per uno slot: il loro `download` prosegue e
    // viene ammesso secondo il tetto ridotto. Senza questo resterebbero
    // parcheggiate fino al prossimo slot liberato (o al timeout di un download
    // in volo), cioè esattamente quelle immagini visibili che ora vogliamo
    // mostrare.
    const waiters = slotWaiters.splice(0, slotWaiters.length);
    waiters.forEach(waiter => waiter.wake());
  },

  // Riprendi i download
  resume: () => {
    DownloadManager.paused = false;
  },

  // Verifica se è in pausa
  isPaused: () => DownloadManager.paused,

  /** Vedi `isDownloadBlockedWhilePlaying`: è la stessa regola, esposta a chi
   *  deve decidere se mostrare un'immagine. */
  isDownloadBlockedWhilePlaying,

  // Richiedi un'immagine (chiamato da CachedImage)
  // Ritorna l'URL dell'immagine (da cache o scaricata)
  requestImage: async (url: string, priority: number = 1, signal?: AbortSignal): Promise<string | null> => {
    if (!url || !url.startsWith('http')) return null;

    if (signal?.aborted) return url;

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

    // 4. In pausa (live in riproduzione) si scarica solo ciò che l'utente sta
    //    guardando: sotto la soglia il lavoro è prefetch, e resta fermo perché
    //    la banda è dello stream. Le cache sono state consultate sopra, quindi
    //    ciò che è già scaricato si mostra comunque — non costa nulla.
    if (isDownloadBlockedWhilePlaying(priority)) {
      return url;
    }

    // 5. Se già in download o in coda, attendi
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

    // 6. Avvia download
    return DownloadManager.download(url, priority, signal);
  },

  /**
   * Ritorna un'immagine **solo se è già in cache**, senza mai scaricare.
   *
   * Guarda prima la cache del webview (memoria + IndexedDB) e poi quella su
   * disco del proxy, che è condivisa fra profili e sessioni. La seconda costa
   * una `HEAD`: il proxy risponde dalla cache senza toccare l'host dell'immagine,
   * quindi la domanda è gratuita anche quando la risposta è "no".
   *
   * Serve a mostrare le copertine mentre si guarda un canale live, quando
   * scaricare significherebbe contendere banda allo stream: un'immagine già
   * scaricata non costa nulla, una che manca resta un segnaposto.
   */
  requestCachedImage: async (url: string): Promise<string | null> => {
    if (!url || !url.startsWith('http')) return null;

    const locale = await CacheService.getImage(url);
    if (locale) {
      DownloadManager.cachedUrls.add(url);
      DownloadManager.stats.fromCache++;
      return locale;
    }

    // Senza il proxy locale (web, Android) la cache su disco non esiste: la
    // sonda andrebbe dritta all'host dell'immagine, cioè sarebbe esattamente la
    // richiesta di rete che questa funzione esiste per evitare.
    if (resolveProxyURL(url) === url) return null;

    try {
      const sonda = await proxyFetch(url, { method: 'HEAD' });
      if (sonda.headers.get('X-StreamAI-Cache') === 'hit') {
        // È sul disco del proxy: l'`<img>` la chiederà e il proxy la servirà da
        // lì, senza rete.
        DownloadManager.stats.fromCache++;
        return resolveProxyURL(url);
      }
    } catch {
      // Nessuna rete o proxy assente: si resta sul segnaposto.
    }
    return null;
  },

  // Download effettivo
  download: async (url: string, priority: number, signal?: AbortSignal): Promise<string | null> => {
    if (signal?.aborted) return url;

    DownloadManager.queued.add(url);

    try {
      // Limita concorrenza attendendo la liberazione di uno slot, senza polling.
      // Il busy-wait precedente (`setTimeout(50)` in un while) con 200 richieste
      // in coda lasciava ~190 waiter che si risvegliavano 20 volte al secondo,
      // cioe' ~3800 timer/s di pura attesa sul main thread.
      //
      // Durante un live il tetto scende: le immagini visibili devono poter
      // arrivare anche mentre si guarda un canale, ma senza occupare la banda
      // che serve allo stream.
      const limite = DownloadManager.paused ? PAUSED_MAX_CONCURRENT_DOWNLOADS : MAX_CONCURRENT_DOWNLOADS;
      while (DownloadManager.processing.size >= limite) {
        if (signal?.aborted) return url;
        const gotSlot = await waitForSlot(priority, signal);
        if (!gotSlot || signal?.aborted) return url;
      }

      if (signal?.aborted) return url;

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

        // Un download già partito si porta a termine anche se nel frattempo è
        // iniziato un live: i byte sono spesi, e in cache servono. A trattenere
        // il lavoro *nuovo* ci pensa la pausa in `requestImage`.
        if (signal?.aborted) return url;
        if (!response.ok) {
          markUrlFailed(url);
          DownloadManager.stats.failed++;
          resolveWaiting(url);
          return url;
        }

        const blob = await response.blob();
        if (signal?.aborted) return url;

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

  /**
   * Precarica le immagini che serviranno probabilmente fra poco (la schermata
   * successiva), ma **solo quando la macchina è inattiva**.
   *
   * La differenza con `preloadVisible` è il momento: mentre l'utente scorre,
   * banda e CPU servono alle copertine che ha sotto gli occhi; appena si ferma,
   * è il momento giusto per preparare quelle che vedrà scorrendo ancora.
   * Vale lo stesso tetto: se la pipeline è piena, non si accoda nulla.
   */
  preloadLater: (urls: string[]) => {
    if (urls.length === 0) return;

    const run = () => DownloadManager.preloadVisible(urls);
    const idle = (window as IdleCapableWindow).requestIdleCallback;

    if (typeof idle === 'function') {
      idle(run, { timeout: 2000 });
      return;
    }

    // Webview senza requestIdleCallback (WebKitGTK non lo espone): un ritardo
    // breve ottiene lo stesso effetto, cioè non competere con lo scroll.
    setTimeout(run, 800);
  },

  // Cancella URL falliti per permettere retry
  clearFailed: () => {
    DownloadManager.failedUrls.clear();
  },

  // Reset completo
  reset: () => {
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
