/// <reference lib="webworker" />
// E.3 — Web Worker per fuzzy matching TMDB in batch.
// Riceve `{ type: 'pickBest', batch:[{key,query,expectedYear,candidates}] }` e
// risponde con `{ type: 'result', id, results: { key, candidate | null }[] }`.
//
// Il chiamante invia tutto il batch (es. enrich di una pagina di catalogo) e
// riceve indietro i match migliori già scelti, senza bloccare il main thread.
// Utile quando si fanno scoring di centinaia di candidati per pagina.

import {
  pickBestMetadataCandidate,
  type MetadataCandidate,
} from '../metadataUtils.ts';

type PickBestItem = {
  /** Identificatore opaco usato dal chiamante per ricongiungere il risultato. */
  key: string;
  query: string;
  expectedYear?: string;
  candidates: MetadataCandidate[];
};

type MetadataRequest = {
  type: 'pickBest';
  id: number;
  batch: PickBestItem[];
};
type MetadataResponse =
  | {
      type: 'result';
      id: number;
      results: { key: string; candidate: MetadataCandidate | null }[];
    }
  | { type: 'error'; id: number; message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.addEventListener('message', (event: MessageEvent<MetadataRequest>) => {
  const msg = event.data;
  if (!msg || msg.type !== 'pickBest') return;
  try {
    const results = msg.batch.map(item => ({
      key: item.key,
      candidate: pickBestMetadataCandidate(item.candidates, item.query, item.expectedYear),
    }));
    const reply: MetadataResponse = { type: 'result', id: msg.id, results };
    ctx.postMessage(reply);
  } catch (err) {
    const reply: MetadataResponse = {
      type: 'error',
      id: msg.id,
      message: err instanceof Error ? err.message : String(err),
    };
    ctx.postMessage(reply);
  }
});

export type { MetadataRequest, MetadataResponse, PickBestItem };

