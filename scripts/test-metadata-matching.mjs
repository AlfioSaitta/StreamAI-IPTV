import assert from 'node:assert/strict';

const {
  cleanTitle,
  extractYear,
  isLikelyTitleMatch,
  pickBestMetadataCandidate,
  titleSimilarity
} = await import('../frontend/services/metadataUtils.ts');

const cleanCases = [
  ['IT: The.Matrix.1999.FHD.H265.mkv', 'The Matrix'],
  ['[EN] Breaking Bad S01E02 1080p WEB-DL', 'Breaking Bad'],
  ['|IT| La vita è bella (1997) HD', 'La vita è bella'],
  ['US - Interstellar.2014.2160p.HDR.mkv', 'Interstellar']
];

for (const [raw, expected] of cleanCases) {
  assert.equal(cleanTitle(raw), expected, `cleanTitle failed for ${raw}`);
}

assert.equal(extractYear('Blade Runner 2049 (2017) 4K'), '2017');
assert.ok(titleSimilarity('La vita e bella', 'La vita è bella') > 0.9);
assert.ok(isLikelyTitleMatch('The Matrix', 'Matrix', '1999', '1999'));
assert.ok(!isLikelyTitleMatch('It', 'It Follows', '2017', '2014'), 'short title false positive should be rejected');

const best = pickBestMetadataCandidate([
  { id: 1, title: 'The Matrix Reloaded', release_date: '2003-05-15', popularity: 80 },
  { id: 2, title: 'The Matrix', release_date: '1999-03-31', popularity: 120 },
  { id: 3, title: 'Matrix', release_date: '1993-01-01', popularity: 5 }
], 'IT: The Matrix (1999) FHD', '1999');

assert.equal(best?.id, 2, 'best TMDB candidate should prefer exact title/year match');

console.log('Metadata matching tests passed');
