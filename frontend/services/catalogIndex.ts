import type { Category, Channel } from '../types.ts';

export interface IndexedSearchFields {
  nameLower: string;
  cleanNameLower: string;
  groupLower: string;
  genreLower: string;
  descriptionLower: string;
  year: string;
  haystack: string;
  /** C.3 Filtri avanzati — vero se il nome o group contiene un tag qualità HD+. */
  isHD: boolean;
  /** C.3 Filtri avanzati — lista normalizzata di generi atomici (lowercase). */
  genreTokens: string[];
}

export type IndexedChannel = Channel & IndexedSearchFields;

// Pattern compilato una sola volta. Match insensibile a maiuscole, riconosce
// anche i separatori comuni (`[FHD]`, `.HD.`, `(4K)`, `1080p`, ecc.). 720p è
// considerato HD; 480p/SD esclusi esplicitamente.
const HD_RE = /(?:^|[\s([{._|-])(?:fhd|uhd|qhd|hdr|hdr10|hdr10\+|dolby|dv|hevc|h265|x265|4k|2160p|1440p|1080p|720p|hd)(?:$|[\s)\]}._|-])/i;

const splitGenres = (raw: string | undefined): string[] => {
  if (!raw) return [];
  return raw
    .split(/[,\/|;&]+/)
    .map(g => g.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
    .filter(g => g.length > 1);
};

/**
 * Quanti caratteri di `description`/`plot` finiscono nell'indice di ricerca.
 *
 * Le trame dei film arrivano a 300-500 caratteri: normalizzarle tutte, per
 * decine di migliaia di titoli, era il costo dominante dell'indicizzazione
 * (`normalize('NFD')` + 3 regex su stringhe lunghe) e gonfiava `haystack` di
 * centinaia di byte per canale. Cercare oltre i primi caratteri della trama non
 * ha valore pratico: nessuno cerca un film da una frase a met\u00e0 sinossi.
 */
const DESCRIPTION_SEARCH_LIMIT = 256;

const truncateForSearch = (value: string | undefined): string | undefined =>
  value && value.length > DESCRIPTION_SEARCH_LIMIT ? value.slice(0, DESCRIPTION_SEARCH_LIMIT) : value;

const searchNormalizationCache = new Map<string, string>();

const normalizeSearchText = (value: string | undefined): string => {
  if (!value) return '';
  const cached = searchNormalizationCache.get(value);
  if (cached !== undefined) return cached;

  const result = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Evita memory leak su cataloghi infiniti
  if (searchNormalizationCache.size > 20000) searchNormalizationCache.clear();
  searchNormalizationCache.set(value, result);
  return result;
};

/**
 * Memo dell'indicizzazione per identit\u00e0 dell'oggetto canale.
 *
 * Lo stesso oggetto `Channel` viene indicizzato pi\u00f9 volte: `indexedAllChannels`
 * (live+VOD+serie) e poi le liste per tab (`indexedLive/Vod/SeriesCategories` e
 * `indexedBaseCategories`) ripassano sugli stessi oggetti. Senza memo ogni
 * passata ricostruiva da zero gli `IndexedChannel` (6 normalizzazioni + 2 regex
 * + haystack + split dei generi): su un catalogo da ~45k canali erano ~90k
 * indicizzazioni complete all'avvio, cio\u00e8 secondi di main thread bloccato.
 *
 * `WeakMap` perch\u00e9 le chiavi sono oggetti del catalogo: sostituendo il catalogo
 * (refresh) le vecchie voci diventano raccoglibili dal GC, senza dover
 * invalidare nulla a mano.
 */
const indexedChannelCache = new WeakMap<Channel, IndexedChannel>();

export const indexChannel = (channel: Channel): IndexedChannel => {
  // Se già indicizzato (es. dal worker) E ha il nuovo campo descriptionLower, ritorna 1:1
  if ('haystack' in channel && 'descriptionLower' in channel) {
    return channel as IndexedChannel;
  }

  // Stesso oggetto già indicizzato in una passata precedente (es. da
  // `indexedAllChannels`): riusiamo il risultato invece di rifare tutto.
  const memo = indexedChannelCache.get(channel);
  if (memo) return memo;

  const nameLower = normalizeSearchText(channel.name);
  const cleanNameLower = normalizeSearchText(channel.cleanName || channel.name);
  const groupLower = normalizeSearchText(channel.group);
  const genreLower = normalizeSearchText(channel.genre);
  // La trama va troncata PRIMA di normalizzare: e' il campo piu' lungo e la
  // normalizzazione (NFD + regex) scala con la sua lunghezza.
  const descriptionLower = normalizeSearchText(truncateForSearch(channel.description));
  const year = normalizeSearchText(channel.year);
  const isHD = HD_RE.test(channel.name || '') || HD_RE.test(channel.group || '');
  const genreTokens = splitGenres(channel.genre);

  const indexed: IndexedChannel = {
    ...channel,
    nameLower,
    cleanNameLower,
    groupLower,
    genreLower,
    descriptionLower,
    year,
    haystack: `${cleanNameLower} ${nameLower} ${groupLower} ${genreLower} ${descriptionLower} ${year}`.trim(),
    isHD,
    genreTokens,
  };

  indexedChannelCache.set(channel, indexed);
  return indexed;
};

/**
 * @deprecated For main thread use. These functions are now executed in a web worker.
 * They are exported only for the worker to use them.
 */
export const indexChannels = (channels: Channel[]): IndexedChannel[] => channels.map(indexChannel);

/**
 * @deprecated For main thread use. These functions are now executed in a web worker.
 * They are exported only for the worker to use them.
 */
export const indexCategories = (categories: Category[]): Array<Category & { channels: IndexedChannel[] }> => categories.map(category => ({
  ...category,
  channels: indexChannels(category.channels)
}));

// This function is now only used inside the worker.
// It's kept here for reference and for the worker to import it.
export const searchIndexedChannels = (channels: IndexedChannel[], query: string, limit = 150): IndexedChannel[] => {
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery.length < 2) return channels.slice(0, limit);

  const tokens = normalizedQuery.split(' ').filter(token => token.length > 1);
  const scored = channels
    .map(channel => {
      let score = 0;
      for (const token of tokens) {
        if (channel.cleanNameLower === token || channel.nameLower === token) score += 40;
        else if (channel.cleanNameLower.startsWith(token)) score += 25;
        else if (channel.nameLower.startsWith(token)) score += 20;
        else if (channel.cleanNameLower.includes(token)) score += 14;
        else if (channel.nameLower.includes(token)) score += 10;
        else if (channel.groupLower.includes(token) || channel.genreLower.includes(token)) score += 6;
        else if (channel.descriptionLower && channel.descriptionLower.includes(token)) score += 2;
        else if (channel.year === token) score += 5;
        else if (!channel.haystack.includes(token)) return null;
      }
      return score > 0 ? { channel, score } : null;
    })
    .filter((entry): entry is { channel: IndexedChannel; score: number } => entry !== null)
    .sort((a, b) => b.score - a.score || a.channel.cleanNameLower.localeCompare(b.channel.cleanNameLower));

  return scored.slice(0, limit).map(entry => entry.channel);
};


/**
 * C.3 Filtri avanzati: estrae i generi più frequenti dal catalogo indicizzato
 * per popolare il selettore "Per genere" nella ricerca globale.
 * @param channels indicizzati
 * @param topN numero massimo di generi da restituire (ordinati per frequenza)
 */
export const extractTopGenres = (channels: IndexedChannel[], topN = 24): string[] => {
  const counts = new Map<string, number>();
  for (const ch of channels) {
    for (const g of ch.genreTokens) {
      counts.set(g, (counts.get(g) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, topN)
    .map(([g]) => g);
};

/** C.3 — soglia "nuovi" (ms): elementi aggiunti negli ultimi 30 giorni. */
export const NEW_ITEM_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;