import type { Category, Channel } from '../types.ts';

export interface IndexedSearchFields {
  nameLower: string;
  cleanNameLower: string;
  groupLower: string;
  genreLower: string;
  year: string;
  haystack: string;
}

export type IndexedChannel = Channel & IndexedSearchFields;

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

  return {
    ...channel,
    nameLower,
    cleanNameLower,
    groupLower,
    genreLower,
    year,
    haystack: `${cleanNameLower} ${nameLower} ${groupLower} ${genreLower} ${year}`.trim()
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
