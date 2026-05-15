import type { Category, Channel } from '../types.ts';

export interface IndexedSearchFields {
  nameLower: string;
  cleanNameLower: string;
  groupLower: string;
  genreLower: string;
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

const normalizeSearchText = (value: string | undefined): string => (value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim();

export const indexChannel = (channel: Channel): IndexedChannel => {
  const nameLower = normalizeSearchText(channel.name);
  const cleanNameLower = normalizeSearchText(channel.cleanName || channel.name);
  const groupLower = normalizeSearchText(channel.group);
  const genreLower = normalizeSearchText(channel.genre);
  const year = normalizeSearchText(channel.year);
  // L'HD detection lavora sul nome **originale** (i tag tipo "[FHD]" sono
  // proprio quelli che `cleanTitle` rimuove) + group per coprire i casi tipo
  // "IT - Cinema HD".
  const isHD = HD_RE.test(channel.name || '') || HD_RE.test(channel.group || '');
  const genreTokens = splitGenres(channel.genre);

  return {
    ...channel,
    nameLower,
    cleanNameLower,
    groupLower,
    genreLower,
    year,
    haystack: `${cleanNameLower} ${nameLower} ${groupLower} ${genreLower} ${year}`.trim(),
    isHD,
    genreTokens,
  };
};

export const indexChannels = (channels: Channel[]): IndexedChannel[] => channels.map(indexChannel);

export const indexCategories = (categories: Category[]): Array<Category & { channels: IndexedChannel[] }> => categories.map(category => ({
  ...category,
  channels: indexChannels(category.channels)
}));

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

