/// <reference lib="webworker" />
// E.3 — Web Worker per parse XMLTV.
// Riceve `{ type: 'parseXmltv', xml, retentionPastMs, horizonFutureMs }` e
// risponde con `{ type: 'result', id, programmes, totalParsed }`.
//
// La pipeline (parse + prune) gira tutta nel worker per evitare jank della
// UI su file XMLTV grandi (10-100 MB su provider Italiani). L'indicizzazione
// (Map<tvgId, …>) resta sul main thread perché Map serializza male via
// structured clone e la sua costruzione è O(n) economica.

import type { EpgProgramme } from '../../types.ts';
import { parseXmltvProgrammes } from '../epg/xmltvParser.ts';

type EpgRequest = {
  type: 'parseXmltv';
  id: number;
  xml: string;
  retentionPastMs: number;
  horizonFutureMs: number;
};
type EpgResponse =
  | { type: 'result'; id: number; programmes: EpgProgramme[]; totalParsed: number }
  | { type: 'error'; id: number; message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

const pruneProgrammes = (
  programmes: EpgProgramme[],
  retentionPastMs: number,
  horizonFutureMs: number,
): EpgProgramme[] => {
  const now = Date.now();
  const minStart = now - retentionPastMs;
  const maxStart = now + horizonFutureMs;
  return programmes.filter(p => p.stop >= minStart && p.start <= maxStart);
};

ctx.addEventListener('message', (event: MessageEvent<EpgRequest>) => {
  const msg = event.data;
  if (!msg || msg.type !== 'parseXmltv') return;
  try {
    const all = parseXmltvProgrammes(msg.xml);
    const pruned = pruneProgrammes(all, msg.retentionPastMs, msg.horizonFutureMs);
    const reply: EpgResponse = {
      type: 'result',
      id: msg.id,
      programmes: pruned,
      totalParsed: all.length,
    };
    ctx.postMessage(reply);
  } catch (err) {
    const reply: EpgResponse = {
      type: 'error',
      id: msg.id,
      message: err instanceof Error ? err.message : String(err),
    };
    ctx.postMessage(reply);
  }
});

export type { EpgRequest, EpgResponse };

