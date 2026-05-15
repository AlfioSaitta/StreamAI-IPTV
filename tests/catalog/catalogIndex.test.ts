// C.3 Filtri avanzati — Test per gli helper di catalogIndex aggiunti
// (`isHD`, `genreTokens`, `extractTopGenres`, `NEW_ITEM_WINDOW_MS`).

import { describe, expect, it } from 'vitest';

import {
  indexChannels,
  extractTopGenres,
  NEW_ITEM_WINDOW_MS,
} from '../../services/catalogIndex.ts';
import type { Channel } from '../../types.ts';

const mk = (over: Partial<Channel>): Channel => ({
  id: over.id ?? 'c1',
  name: over.name ?? 'Channel',
  url: 'http://example.com/x',
  ...over,
});

describe('catalogIndex — HD detection (C.3)', () => {
  it('marks FHD/HD/4K/H265 tags as HD', () => {
    const channels = indexChannels([
      mk({ id: '1', name: 'The Matrix [FHD]' }),
      mk({ id: '2', name: 'Inception 1080p' }),
      mk({ id: '3', name: 'Dune (4K)' }),
      mk({ id: '4', name: 'Tenet.HEVC' }),
      mk({ id: '5', name: 'Old Movie SD' }),
      mk({ id: '6', name: 'Some Stream' }),
      mk({ id: '7', name: 'Rai 1', group: 'IT — Cinema HD' }),
    ]);
    expect(channels[0].isHD).toBe(true);
    expect(channels[1].isHD).toBe(true);
    expect(channels[2].isHD).toBe(true);
    expect(channels[3].isHD).toBe(true);
    expect(channels[4].isHD).toBe(false);
    expect(channels[5].isHD).toBe(false);
    expect(channels[6].isHD).toBe(true); // dal group
  });

  it('does not match "shd" or random letters containing hd', () => {
    const [ch] = indexChannels([mk({ id: '1', name: 'ShdNgChannel' })]);
    expect(ch.isHD).toBe(false);
  });
});

describe('catalogIndex — genre tokens (C.3)', () => {
  it('splits comma/slash/pipe-separated genres into lowercase atoms', () => {
    const channels = indexChannels([
      mk({ id: '1', genre: 'Action, Sci-Fi / Thriller' }),
      mk({ id: '2', genre: 'Drama|Romance' }),
      mk({ id: '3', genre: 'Comédie & Aventure' }),
      mk({ id: '4' }), // no genre
    ]);
    expect(channels[0].genreTokens).toEqual(expect.arrayContaining(['action', 'sci-fi', 'thriller']));
    expect(channels[1].genreTokens).toEqual(expect.arrayContaining(['drama', 'romance']));
    // diacritica rimossa
    expect(channels[2].genreTokens).toEqual(expect.arrayContaining(['comedie', 'aventure']));
    expect(channels[3].genreTokens).toEqual([]);
  });
});

describe('catalogIndex — extractTopGenres (C.3)', () => {
  it('returns genres sorted by frequency desc, then alpha', () => {
    const channels = indexChannels([
      mk({ id: '1', genre: 'Action' }),
      mk({ id: '2', genre: 'Action' }),
      mk({ id: '3', genre: 'Action' }),
      mk({ id: '4', genre: 'Drama' }),
      mk({ id: '5', genre: 'Drama' }),
      mk({ id: '6', genre: 'Comedy' }),
    ]);
    const top = extractTopGenres(channels, 10);
    expect(top.slice(0, 3)).toEqual(['action', 'drama', 'comedy']);
  });

  it('respects topN limit', () => {
    const channels = indexChannels(
      Array.from({ length: 20 }, (_, i) => mk({ id: String(i), genre: `Genre${i}` })),
    );
    expect(extractTopGenres(channels, 5).length).toBe(5);
  });
});

describe('catalogIndex — NEW_ITEM_WINDOW_MS (C.3)', () => {
  it('exports a 30-day window in ms', () => {
    expect(NEW_ITEM_WINDOW_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});

