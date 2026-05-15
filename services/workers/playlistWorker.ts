/// <reference lib="webworker" />
// E.3 — Web Worker per parse M3U.
// Riceve `{ type: 'parseM3U', text }` e risponde con `{ type: 'result', id, categories }`.
// In caso di errore: `{ type: 'error', id, message }`.
//
// Le funzioni di parsing live in `services/parser.ts` come modulo puro: il
// worker fa solo orchestration message-based per non duplicare logica.

import { parseM3U } from '../parser.ts';

type PlaylistRequest = { type: 'parseM3U'; id: number; text: string };
type PlaylistResponse =
  | { type: 'result'; id: number; categories: ReturnType<typeof parseM3U> }
  | { type: 'error'; id: number; message: string };

// Vite trasforma `self` in `WorkerGlobalScope` quando importato con `?worker`.
const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.addEventListener('message', (event: MessageEvent<PlaylistRequest>) => {
  const msg = event.data;
  if (!msg || msg.type !== 'parseM3U') return;
  try {
    const categories = parseM3U(msg.text);
    const reply: PlaylistResponse = { type: 'result', id: msg.id, categories };
    ctx.postMessage(reply);
  } catch (err) {
    const reply: PlaylistResponse = {
      type: 'error',
      id: msg.id,
      message: err instanceof Error ? err.message : String(err),
    };
    ctx.postMessage(reply);
  }
});

export type { PlaylistRequest, PlaylistResponse };

