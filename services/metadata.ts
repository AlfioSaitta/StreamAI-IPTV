// Simple in-memory cache to avoid hitting rate limits
const tmdbCache = new Map<string, any>();

// Public demo key for fallback (The Movie Database)
// In production, use process.env.TMDB_API_KEY
const DEFAULT_KEY = '8dc93996529b459170b83ccdd133eb59';
const TMDB_API_KEY = process.env.TMDB_API_KEY || DEFAULT_KEY;
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

export const MetadataService = {
  /**
   * Cleans raw IPTV names to get a search-friendly title.
   * Example: "[EN] The Matrix (1999) FHD.mkv" -> "The Matrix"
   */
  cleanTitle: (rawName: string): string => {
    if (!rawName) return '';
    let name = rawName;

    // Remove common IPTV prefixes:
    // [IT], (US), IT:, |IT|, US -, IT - 
    name = name.replace(/^(\[[^\]]+\]|\([^\)]+\)|\|[^\|]+\||[A-Z0-9]{2,4}\s*[:\-])\s*/gi, '');

    // Remove file extensions
    name = name.replace(/\.(mkv|mp4|avi|ts|m3u8)$/i, '');

    // Remove quality tags and codecs (case insensitive, surrounded by word boundaries or separators)
    const techTags = [
      'FHD', 'HD', 'SD', '4K', 'UHD', '1080p', '720p', '480p', 
      'H265', 'H264', 'HEVC', 'AAC', 'DTS', 'AC3', 'BLURAY', 'WEBDL', 'HDR',
      'HC', 'RIP', 'SUB', 'ITA', 'ENG'
    ];
    const regex = new RegExp(`[\\s\\.\\-\\_](${techTags.join('|')})([\\s\\.\\-\\_]|$)`, 'gi');
    name = name.replace(regex, '');

    // Remove years in parentheses if they are at the end (e.g. "Title (2022)")
    // or just a year at the end "Title 2022"
    name = name.replace(/\s*\(?\d{4}\)?\s*$/, '');

    // Clean up extra whitespace/dots/dashes leftovers
    name = name.replace(/[\.\-_]/g, ' ');
    name = name.replace(/\s+/g, ' ');

    return name.trim();
  },

  /**
   * Searches TMDB for a movie or series.
   */
  searchTMDB: async (query: string, type: 'movie' | 'series', year?: string, language: string = 'it') => {
    if (!TMDB_API_KEY) return null;
    
    // Normalize query
    const cleanQuery = query.trim();
    if (!cleanQuery) return null;

    const cacheKey = `search_${type}_${cleanQuery}_${year || ''}_${language}`;
    if (tmdbCache.has(cacheKey)) return tmdbCache.get(cacheKey);

    try {
      const searchType = type === 'series' ? 'tv' : 'movie';
      let url = `${TMDB_BASE_URL}/search/${searchType}?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(cleanQuery)}&language=${language}`;
      if (year) url += `&primary_release_year=${year}`;

      const res = await fetch(url);
      if (!res.ok) throw new Error(res.statusText);
      const data = await res.json();
      
      // Get first result
      const result = data.results?.[0] || null;
      tmdbCache.set(cacheKey, result);
      return result;
    } catch (e) {
      console.warn(`TMDB Search failed for ${query}:`, e);
      return null;
    }
  },

  /**
   * Gets full details (images, plot, cast) by TMDB ID.
   */
  getDetails: async (tmdbId: number, type: 'movie' | 'series', language: string = 'it') => {
    if (!TMDB_API_KEY) return null;

    const cacheKey = `details_${type}_${tmdbId}_${language}`;
    if (tmdbCache.has(cacheKey)) return tmdbCache.get(cacheKey);

    try {
      const searchType = type === 'series' ? 'tv' : 'movie';
      const url = `${TMDB_BASE_URL}/${searchType}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=credits,images,similar,recommendations&language=${language}`;

      const res = await fetch(url);
      if (!res.ok) throw new Error(res.statusText);
      const data = await res.json();
      
      tmdbCache.set(cacheKey, data);
      return data;
    } catch (e) {
      console.warn(`TMDB Details failed for ID ${tmdbId}:`, e);
      return null;
    }
  },

  /**
   * Helper to get a high-quality image URL
   */
  getImageUrl: (path: string | null | undefined, size: 'w500' | 'w780' | 'w1280' | 'original' = 'w500') => {
    if (!path) return null;
    return `https://image.tmdb.org/t/p/${size}${path}`;
  }
};