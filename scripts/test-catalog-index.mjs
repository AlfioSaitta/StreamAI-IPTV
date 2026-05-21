import assert from 'node:assert/strict';

const { indexChannels, searchIndexedChannels } = await import('../frontend/services/catalogIndex.ts');

const channels = indexChannels([
  { id: '1', name: 'IT: The.Matrix.1999.FHD', cleanName: 'The Matrix', group: 'Cinema', genre: 'Sci-Fi', year: '1999', url: 'u', type: 'movie' },
  { id: '2', name: 'Sky Sport 24 HD', group: 'Sport', genre: 'News', url: 'u', type: 'live' },
  { id: '3', name: 'La vita è bella', group: 'Film Italiani', genre: 'Drammatico', year: '1997', url: 'u', type: 'movie' }
]);

assert.equal(channels[0].cleanNameLower, 'the matrix');
assert.equal(channels[2].cleanNameLower, 'la vita e bella');
assert.equal(searchIndexedChannels(channels, 'matrix')[0].id, '1');
assert.equal(searchIndexedChannels(channels, 'sci fi')[0].id, '1');
assert.equal(searchIndexedChannels(channels, 'sport')[0].id, '2');
assert.equal(searchIndexedChannels(channels, 'vita bella')[0].id, '3');
assert.equal(searchIndexedChannels(channels, '1997')[0].id, '3');
assert.equal(searchIndexedChannels(channels, 'inesistente').length, 0);

const largeCatalog = indexChannels(Array.from({ length: 8000 }, (_, index) => ({
  id: `vod-${index}`,
  name: `Film Catalogo ${index} ${index === 7342 ? 'AlphaBeta' : 'Standard'} FHD`,
  cleanName: `Film Catalogo ${index} ${index === 7342 ? 'AlphaBeta' : 'Standard'}`,
  group: index % 2 === 0 ? 'Azione' : 'Commedia',
  genre: index % 3 === 0 ? 'Sci-Fi' : 'Drama',
  year: String(1980 + (index % 45)),
  url: 'u',
  type: 'movie'
})));

const startedAt = Date.now();
const largeResult = searchIndexedChannels(largeCatalog, 'AlphaBeta', 10);
const elapsedMs = Date.now() - startedAt;
assert.equal(largeResult[0].id, 'vod-7342');
assert.ok(elapsedMs < 250, `large catalog search should stay fast, got ${elapsedMs}ms`);

console.log('Catalog index tests passed');
