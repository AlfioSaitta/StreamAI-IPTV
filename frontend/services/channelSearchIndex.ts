/**
 * Indice di ricerca per titolo sul catalogo, usato per collegare i metadati
 * (TMDB/AI) ai canali locali.
 *
 * Perche' esiste: il matching avveniva con una scansione lineare di TUTTO il
 * catalogo per ciascun titolo da cercare, confrontando con `isTitleMatch` (che
 * a sua volta fa 4 `cleanTitle` + Levenshtein + Set di token per candidato).
 * La pagina di dettaglio cerca 20-40 titoli suggeriti, quindi su un catalogo da
 * 50k canali si arrivava a ~2M confronti: decine di secondi di freeze del main
 * thread all'apertura del dettaglio.
 *
 * Qui il costo passa a O(N) una volta sola (costruzione dell'indice) piu' O(1)
 * per il match esatto, con un fallback fuzzy ristretto ai soli candidati che
 * condividono almeno un token con il titolo cercato.
 */
import type { Channel } from '../types.ts';
import { cleanTitle, normalizeTitleForMatch } from './metadataUtils.ts';

export interface ChannelSearchIndex {
  /** Titolo normalizzato -> primo canale con quel titolo. */
  readonly exact: Map<string, Channel>;
  /** Token del titolo -> canali che lo contengono. */
  readonly byToken: Map<string, Channel[]>;
}

/**
 * Tetto ai candidati considerati nel fallback fuzzy.
 *
 * Serve a garantire un limite superiore: un token molto comune (es. "the") puo'
 * altrimenti riportare in gioco quasi tutto il catalogo, annullando il
 * vantaggio dell'indice. I token vengono visitati dal piu' raro al piu' comune,
 * quindi il taglio scarta per primi i candidati meno informativi.
 */
const MAX_FUZZY_CANDIDATES = 3000;

/** Titolo normalizzato di un canale (stessa normalizzazione del matching). */
export const normalizeChannelTitle = (channel: Channel): string =>
  normalizeTitleForMatch(cleanTitle(channel.cleanName || channel.name));

/**
 * Costruisce l'indice. Da memoizzare sul catalogo: e' O(N) con allocazioni
 * (una voce `exact` e un bucket per token).
 */
export const buildChannelSearchIndex = (channels: Channel[]): ChannelSearchIndex => {
  const exact = new Map<string, Channel>();
  const byToken = new Map<string, Channel[]>();

  for (const channel of channels) {
    // Solo VOD/serie: sono gli unici tipi confrontati con i metadati.
    if (channel.type !== 'movie' && channel.type !== 'series') continue;

    const key = normalizeChannelTitle(channel);
    if (!key) continue;

    if (!exact.has(key)) exact.set(key, channel);

    for (const token of new Set(key.split(' '))) {
      if (token.length < 2) continue;
      const bucket = byToken.get(token);
      if (bucket) {
        bucket.push(channel);
      } else {
        byToken.set(token, [channel]);
      }
    }
  }

  return { exact, byToken };
};

/**
 * Candidati plausibili per `title`, in ordine di preferenza: prima il match
 * esatto del titolo normalizzato, poi i canali che condividono almeno un token.
 *
 * Il chiamante deve comunque validare con `isTitleMatch`: questo elenco e' un
 * insieme di candidati ristretto, non un risultato.
 */
export const candidateChannels = (index: ChannelSearchIndex, title: string): Channel[] => {
  const key = normalizeTitleForMatch(cleanTitle(title));
  if (!key) return [];

  const out: Channel[] = [];
  const seen = new Set<string>();

  const push = (channel: Channel): void => {
    if (seen.has(channel.id)) return;
    seen.add(channel.id);
    out.push(channel);
  };

  const exact = index.exact.get(key);
  if (exact) push(exact);

  const tokens = [...new Set(key.split(' '))].filter(token => token.length >= 2);
  // Dal token piu' raro al piu' comune: restringe prima l'insieme.
  tokens.sort(
    (a, b) => (index.byToken.get(a)?.length ?? Number.MAX_SAFE_INTEGER) - (index.byToken.get(b)?.length ?? Number.MAX_SAFE_INTEGER),
  );

  for (const token of tokens) {
    const bucket = index.byToken.get(token);
    if (!bucket) continue;
    for (const channel of bucket) {
      if (out.length >= MAX_FUZZY_CANDIDATES) return out;
      push(channel);
    }
  }

  return out;
};
