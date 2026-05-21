// E.3 — Facciata Web Worker pipeline.
// Espone API async che instradano i task pesanti su worker dedicati quando
// disponibili (Vite `?worker` import) oppure ricadono sul main thread per
// ambienti senza `Worker` (Node/Vitest, casi rari).
//
// Strategia di scheduling:
// - **Soglia size:** sotto la quale conviene restare sul main thread per
//   evitare l'overhead di spawning + postMessage. Default conservative.
// - **Pool 1 worker per tipo:** una sola istanza per worker che gestisce
//   richieste sequenziali via id. Sufficiente per i nostri use case (un
//   parse alla volta, non concorrente). Si terminate-and-respawn quando
//   non viene usato per > 60s per restituire memoria.
// - **Promise-per-richiesta:** ogni postMessage ha un `id` numerico crescente
//   risolto dal listener interno; gli errori del worker bubblano come
//   `Promise.reject(new Error(...))`.

import type { Category, EpgProgramme } from '../../types.ts';
import type { MetadataCandidate } from '../metadataUtils.ts';
import type { PickBestItem } from './metadataWorker.ts';

// Soglie (modificabili da test)
const PLAYLIST_WORKER_MIN_SIZE = 256 * 1024;   // 256 kB
const EPG_WORKER_MIN_SIZE = 256 * 1024;        // 256 kB
const METADATA_WORKER_MIN_BATCH = 4;           // pickBest in batch
const IDLE_WORKER_TTL_MS = 60_000;             // termina worker idle dopo 60s

// Detect once at module load.
const hasWorker =
  typeof Worker !== 'undefined' && typeof URL !== 'undefined';

// ─── Pool generico ──────────────────────────────────────────────────────

interface PendingTask<T> {
  resolve: (value: T) => void;
  reject: (err: Error) => void;
}

class WorkerPool<TReq extends { id: number }, TRes extends { id: number; type: 'result' | 'error'; message?: string }> {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingTask<TRes>>();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly factory: () => Worker) {}

  private ensureWorker(): Worker {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.worker) return this.worker;
    const w = this.factory();
    w.addEventListener('message', (event: MessageEvent<TRes>) => {
      const res = event.data;
      if (!res || typeof res.id !== 'number') return;
      const task = this.pending.get(res.id);
      if (!task) return;
      this.pending.delete(res.id);
      if (res.type === 'error') {
        task.reject(new Error(res.message || 'Worker error'));
      } else {
        task.resolve(res);
      }
      this.scheduleIdleShutdown();
    });
    w.addEventListener('error', (event: ErrorEvent) => {
      const err = new Error(event.message || 'Worker crashed');
      for (const task of this.pending.values()) task.reject(err);
      this.pending.clear();
      this.terminate();
    });
    this.worker = w;
    return w;
  }

  private scheduleIdleShutdown(): void {
    if (this.pending.size > 0) return;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.terminate();
    }, IDLE_WORKER_TTL_MS);
  }

  send(payload: Omit<TReq, 'id'>): Promise<TRes> {
    const id = this.nextId++;
    return new Promise<TRes>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        const w = this.ensureWorker();
        w.postMessage({ ...payload, id });
      } catch (err) {
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  terminate(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  /** Pending count — esposto per test. */
  get pendingSize(): number {
    return this.pending.size;
  }
}

// ─── Worker factories (Vite `new Worker(new URL(...), {type:'module'})`) ──
// Pattern ufficiale ESM, supportato sia da Vite che da bundler moderni.
// Le factory sono *lazy*: la prima `send()` istanzia il worker.

const playlistPool = hasWorker
  ? new WorkerPool<import('./playlistWorker.ts').PlaylistRequest, import('./playlistWorker.ts').PlaylistResponse>(
      () => new Worker(new URL('./playlistWorker.ts', import.meta.url), { type: 'module' }),
    )
  : null;

const epgPool = hasWorker
  ? new WorkerPool<import('./epgWorker.ts').EpgRequest, import('./epgWorker.ts').EpgResponse>(
      () => new Worker(new URL('./epgWorker.ts', import.meta.url), { type: 'module' }),
    )
  : null;

const metadataPool = hasWorker
  ? new WorkerPool<import('./metadataWorker.ts').MetadataRequest, import('./metadataWorker.ts').MetadataResponse>(
      () => new Worker(new URL('./metadataWorker.ts', import.meta.url), { type: 'module' }),
    )
  : null;

// ─── Public API ────────────────────────────────────────────────────────

/**
 * Esegue `parseM3U(text)` in un worker se il payload supera la soglia,
 * altrimenti fa fallback sincrono sul main thread.
 */
export const parseM3UAsync = async (text: string): Promise<Category[]> => {
  if (playlistPool && text.length >= PLAYLIST_WORKER_MIN_SIZE) {
    try {
      const res = await playlistPool.send({ type: 'parseM3U', text });
      if (res.type === 'result') return res.categories;
    } catch (err) {
      console.warn('[workers] playlistWorker failed, fallback main:', err);
    }
  }
  const { parseM3U } = await import('../parser.ts');
  return parseM3U(text);
};

/**
 * Parse + prune XMLTV. Se `xml` supera la soglia (256 kB) gira nel worker.
 * Restituisce `programmes` già potate; l'indicizzazione (Map) resta al chiamante.
 */
export const parseXmltvAsync = async (
  xml: string,
  retentionPastMs: number,
  horizonFutureMs: number,
): Promise<{ programmes: EpgProgramme[]; totalParsed: number }> => {
  if (epgPool && xml.length >= EPG_WORKER_MIN_SIZE) {
    try {
      const res = await epgPool.send({
        type: 'parseXmltv',
        xml,
        retentionPastMs,
        horizonFutureMs,
      });
      if (res.type === 'result') {
        return { programmes: res.programmes, totalParsed: res.totalParsed };
      }
    } catch (err) {
      console.warn('[workers] epgWorker failed, fallback main:', err);
    }
  }
  const { parseXmltvProgrammes } = await import('../epg/xmltvParser.ts');
  const all = parseXmltvProgrammes(xml);
  const now = Date.now();
  const minStart = now - retentionPastMs;
  const maxStart = now + horizonFutureMs;
  const programmes = all.filter(p => p.stop >= minStart && p.start <= maxStart);
  return { programmes, totalParsed: all.length };
};

/**
 * Fuzzy match di un batch di candidati TMDB. Sotto la soglia
 * (`METADATA_WORKER_MIN_BATCH`) gira sul main per evitare l'overhead.
 */
export const pickBestMetadataBatchAsync = async (
  batch: PickBestItem[],
): Promise<{ key: string; candidate: MetadataCandidate | null }[]> => {
  if (metadataPool && batch.length >= METADATA_WORKER_MIN_BATCH) {
    try {
      const res = await metadataPool.send({ type: 'pickBest', batch });
      if (res.type === 'result') return res.results;
    } catch (err) {
      console.warn('[workers] metadataWorker failed, fallback main:', err);
    }
  }
  const { pickBestMetadataCandidate } = await import('../metadataUtils.ts');
  return batch.map(item => ({
    key: item.key,
    candidate: pickBestMetadataCandidate(item.candidates, item.query, item.expectedYear),
  }));
};

/** Termina i worker (utile per test e shutdown app). */
export const terminateAllWorkers = (): void => {
  playlistPool?.terminate();
  epgPool?.terminate();
  metadataPool?.terminate();
};

/** Indica se l'ambiente attuale supporta i Web Worker. */
export const workersAvailable = (): boolean => hasWorker;

// Re-export tipi per i consumatori
export type { PickBestItem };


