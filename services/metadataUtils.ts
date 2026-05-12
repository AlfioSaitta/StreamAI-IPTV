export interface MetadataCandidate {
  id?: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  release_date?: string;
  first_air_date?: string;
  popularity?: number;
  vote_count?: number;
}

const QUALITY_TAGS = [
  'FHD', 'HD', 'SD', '4K', 'UHD', '2160p', '1080p', '720p', '576p', '480p',
  'H265', 'H264', 'HEVC', 'X265', 'X264', 'AVC', 'AAC', 'DTS', 'AC3', 'EAC3',
  'BLURAY', 'BDRIP', 'BRRIP', 'WEBDL', 'WEB-DL', 'WEBRIP', 'HDR', 'HDR10',
  'DV', 'DOLBY', 'ATMOS', 'REMUX', 'RIP', 'SUB', 'MULTI', 'DUAL', 'ITA', 'ENG',
  'TRUEHD', 'CAM', 'TS', 'TC', 'SCR', 'IMAX'
];

export const extractYear = (rawName: string): string | undefined => {
  const parenthesized = rawName.match(/[([]\s*((?:19|20)\d{2})\s*[)\]]/);
  if (parenthesized?.[1]) return parenthesized[1];

  const trailing = rawName.match(/(?:^|\s)((?:19|20)\d{2})(?:\s|[._-])*(?:$|\b(?:FHD|HD|SD|4K|UHD|1080p|720p|WEB|BLURAY)\b)/i);
  if (trailing?.[1]) return trailing[1];

  const generic = rawName.match(/(?:^|[^\d])((?:19|20)\d{2})(?!\d)/);
  return generic?.[1];
};

const stripDiacritics = (value: string): string => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

export const normalizeTitleForMatch = (value: string): string => stripDiacritics(value)
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/['’`´]/g, '')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .replace(/\b(the|a|an|il|lo|la|i|gli|le|un|uno|una|el|los|las|les|der|die|das)\b/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

export const cleanTitle = (rawName: string): string => {
  if (!rawName) return '';
  let name = rawName.trim();

  name = name.replace(/\.(mkv|mp4|avi|mov|wmv|ts|m3u8|mpg|mpeg)$/i, '');
  name = name.replace(/^([A-Z]{2,4}|\d{2,4})\s*[|:»>-]\s*/i, '');
  name = name.replace(/^(\[[^\]]+]|[(][^)]+[)]|\{[^}]+}|\|[^|]+\|)\s*/gi, '');
  name = name.replace(/\bS\d{1,2}\s*E\d{1,3}\b/gi, ' ');
  name = name.replace(/\b\d{1,2}x\d{1,3}\b/gi, ' ');
  name = name.replace(/\b(ep|episode|episodio)\s*\d{1,3}\b/gi, ' ');
  name = name.replace(/[._]+/g, ' ');

  const qualityRegex = new RegExp(`(?:^|[\\s()[\\]{}._-])(?:${QUALITY_TAGS.join('|')})(?=$|[\\s()[\\]{}._-])`, 'gi');
  name = name.replace(qualityRegex, ' ');
  name = name.replace(/\s*[([]?(?:19|20)\d{2}[)\]]?\s*$/g, ' ');
  name = name.replace(/\[[^]]*]/g, ' ');
  name = name.replace(/[{][^}]*}/g, ' ');
  name = name.replace(/\s+-\s+(?:ITA|ENG|SUB|HD|FHD|UHD).*$/i, ' ');
  name = name.replace(/[|]+/g, ' ');
  name = name.replace(/\s+/g, ' ');

  return name.trim();
};

const levenshteinDistance = (a: string, b: string): number => {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[b.length];
};

export const titleSimilarity = (first: string, second: string): number => {
  const a = normalizeTitleForMatch(cleanTitle(first));
  const b = normalizeTitleForMatch(cleanTitle(second));
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 3 || b.length < 3) return 0;

  const maxLength = Math.max(a.length, b.length);
  const distance = levenshteinDistance(a, b);
  const baseScore = 1 - distance / maxLength;
  const tokenA = new Set(a.split(' '));
  const tokenB = new Set(b.split(' '));
  const overlap = [...tokenA].filter(token => tokenB.has(token)).length;
  const tokenScore = overlap / Math.max(tokenA.size, tokenB.size);

  return Math.max(baseScore, tokenScore * 0.92);
};

export const isLikelyTitleMatch = (first: string, second: string, expectedYear?: string, candidateYear?: string): boolean => {
  const normalizedFirst = normalizeTitleForMatch(cleanTitle(first));
  const normalizedSecond = normalizeTitleForMatch(cleanTitle(second));
  if (!normalizedFirst || !normalizedSecond) return false;
  if (Math.min(normalizedFirst.length, normalizedSecond.length) < 3) {
    return normalizedFirst === normalizedSecond;
  }

  const yearCompatible = !expectedYear || !candidateYear || Math.abs(Number(expectedYear) - Number(candidateYear)) <= 1;
  const similarity = titleSimilarity(normalizedFirst, normalizedSecond);
  const containsSafely = Math.min(normalizedFirst.length, normalizedSecond.length) >= 6 && (
    normalizedFirst.includes(normalizedSecond) || normalizedSecond.includes(normalizedFirst)
  );

  return yearCompatible && (similarity >= 0.84 || containsSafely);
};

export const getCandidateTitle = (candidate: MetadataCandidate): string => (
  candidate.title || candidate.name || candidate.original_title || candidate.original_name || ''
);

export const getCandidateYear = (candidate: MetadataCandidate): string | undefined => {
  const date = candidate.release_date || candidate.first_air_date || '';
  return date ? date.split('-')[0] : undefined;
};

export const pickBestMetadataCandidate = <T extends MetadataCandidate>(
  candidates: T[],
  query: string,
  expectedYear?: string
): T | null => {
  const normalizedQuery = normalizeTitleForMatch(cleanTitle(query));
  if (!normalizedQuery || normalizedQuery.length < 2) return null;

  const scored = candidates
    .map(candidate => {
      const title = getCandidateTitle(candidate);
      const candidateYear = getCandidateYear(candidate);
      const similarity = titleSimilarity(query, title);
      const yearBonus = expectedYear && candidateYear && Math.abs(Number(expectedYear) - Number(candidateYear)) <= 1 ? 0.16 : 0;
      const popularityBonus = Math.min(Number(candidate.popularity || 0) / 1000, 0.08);
      const voteBonus = Math.min(Number(candidate.vote_count || 0) / 5000, 0.04);
      const shortTitlePenalty = normalizedQuery.length < 4 && similarity < 1 ? 0.35 : 0;
      return {
        candidate,
        score: similarity + yearBonus + popularityBonus + voteBonus - shortTitlePenalty,
        similarity
      };
    })
    .filter(item => item.similarity >= 0.72 || isLikelyTitleMatch(query, getCandidateTitle(item.candidate), expectedYear, getCandidateYear(item.candidate)))
    .sort((a, b) => b.score - a.score);

  return scored[0]?.candidate || null;
};
