// E.3 — Test della facciata Web Worker pipeline.
// In ambiente Vitest (Node) `Worker` non è disponibile, quindi la facciata
// deve fare fallback sincrono sul main thread con risultato identico.

import { describe, expect, it } from 'vitest';

import {
  parseM3UAsync,
  parseXmltvAsync,
  pickBestMetadataBatchAsync,
  workersAvailable,
} from '../../services/workers/index.ts';

describe('workers facade — environment detection', () => {
  it('reports workersAvailable=false in Node test runtime', () => {
    expect(workersAvailable()).toBe(false);
  });
});

describe('parseM3UAsync (E.3 playlistWorker)', () => {
  it('returns Category[] from a small M3U via main-thread fallback', async () => {
    const m3u = `#EXTM3U
#EXTINF:-1 tvg-logo="http://x/logo.png" group-title="News" tvg-id="bbc",BBC News
http://example.com/bbc.m3u8
#EXTINF:-1 group-title="Music",Vevo
http://example.com/vevo.m3u8
`;
    const categories = await parseM3UAsync(m3u);
    expect(categories.length).toBe(2);
    const all = categories.flatMap(c => c.channels);
    expect(all.length).toBe(2);
    expect(all.find(c => c.name === 'BBC News')?.tvgId).toBe('bbc');
  });

  it('handles empty input gracefully', async () => {
    const categories = await parseM3UAsync('');
    expect(categories).toEqual([]);
  });
});

describe('parseXmltvAsync (E.3 epgWorker)', () => {
  const now = Date.now();
  const fmtUtc = (ms: number) => {
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())} +0000`;
  };

  it('parses programmes and prunes past/future correctly', async () => {
    const veryOld = now - 5 * 24 * 60 * 60 * 1000; // 5 giorni fa
    const veryFar = now + 60 * 24 * 60 * 60 * 1000; // 60 giorni avanti
    const soon = now + 60 * 60 * 1000; // 1 ora avanti

    const xml = `<?xml version="1.0"?>
<tv>
  <programme start="${fmtUtc(veryOld)}" stop="${fmtUtc(veryOld + 3_600_000)}" channel="ch1">
    <title>Old</title>
  </programme>
  <programme start="${fmtUtc(soon)}" stop="${fmtUtc(soon + 3_600_000)}" channel="ch1">
    <title>Soon</title>
  </programme>
  <programme start="${fmtUtc(veryFar)}" stop="${fmtUtc(veryFar + 3_600_000)}" channel="ch1">
    <title>Far Future</title>
  </programme>
</tv>`;

    const { programmes, totalParsed } = await parseXmltvAsync(
      xml,
      24 * 60 * 60 * 1000, // retentionPastMs: 24h
      14 * 24 * 60 * 60 * 1000, // horizonFutureMs: 14d
    );
    expect(totalParsed).toBe(3);
    expect(programmes.length).toBe(1);
    expect(programmes[0].title).toBe('Soon');
  });

  it('returns empty programmes on empty xml', async () => {
    const { programmes, totalParsed } = await parseXmltvAsync('', 0, 0);
    expect(programmes).toEqual([]);
    expect(totalParsed).toBe(0);
  });
});

describe('pickBestMetadataBatchAsync (E.3 metadataWorker)', () => {
  it('returns best candidate per item via fuzzy match', async () => {
    const results = await pickBestMetadataBatchAsync([
      {
        key: 'matrix',
        query: 'The Matrix',
        expectedYear: '1999',
        candidates: [
          { id: 603, title: 'The Matrix', release_date: '1999-03-30', popularity: 80, vote_count: 24000 },
          { id: 604, title: 'The Matrix Reloaded', release_date: '2003-05-15', popularity: 60, vote_count: 12000 },
        ],
      },
      {
        key: 'no-match',
        query: 'xyz qwerty 12345',
        candidates: [
          { id: 1, title: 'Completely Different Title', release_date: '2020-01-01', popularity: 1 },
        ],
      },
    ]);
    expect(results.length).toBe(2);
    const matrix = results.find(r => r.key === 'matrix');
    expect(matrix?.candidate?.id).toBe(603);
    const noMatch = results.find(r => r.key === 'no-match');
    expect(noMatch?.candidate).toBeNull();
  });

  it('handles empty batch', async () => {
    const results = await pickBestMetadataBatchAsync([]);
    expect(results).toEqual([]);
  });
});

