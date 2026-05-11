// Simple in-memory cache to avoid hitting rate limits
const tmdbCache = new Map<string, any>();

// Configura la chiave in .env come VITE_TMDB_API_KEY. Non inserire chiavi nel codice sorgente.
const TMDB_API_KEY = import.meta.env.VITE_TMDB_API_KEY || '';
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
    name = name.replace(/^(\[[^\]]+]|[(][^)]+[)]|\|[^|]+\||[A-Z0-9]{2,4}\s*[:-])\s*/gi, '');

    // Remove file extensions
    name = name.replace(/\.(mkv|mp4|avi|ts|m3u8)$/i, '');

    // Remove quality tags and codecs (case insensitive, surrounded by word boundaries or separators)
    const techTags = [
      'FHD', 'HD', 'SD', '4K', 'UHD', '1080p', '720p', '480p', 
      'H265', 'H264', 'HEVC', 'AAC', 'DTS', 'AC3', 'BLURAY', 'WEBDL', 'HDR',
      'HC', 'RIP', 'SUB', 'ITA', 'ENG'
    ];
    const regex = new RegExp(`[\\s._-](${techTags.join('|')})([\\s._-]|$)`, 'gi');
    name = name.replace(regex, '');

    // Remove years in parentheses if they are at the end (e.g. "Title (2022)")
    // or just a year at the end "Title 2022"
    name = name.replace(/\s*\(?\d{4}\)?\s*$/, '');

    // Clean up extra whitespace/dots/dashes leftovers
    name = name.replace(/[._-]/g, ' ');
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
   * Helper to get details by searching for a title first, then fetching full details.
   * This encapsulates the common pattern of search-then-fetch used across components.
   * 
   * @param title - The title to search for (cleanName or name)
   * @param type - 'movie' or 'series'
   * @param year - Optional year to narrow down search results
   * @param language - Language code for results (default: 'it')
   * @returns Full TMDB details if found, null otherwise
   */
  getDetailsByTitle: async (title: string, type: 'movie' | 'series', year?: string, language: string = 'it') => {
    try {
      const result = await MetadataService.searchTMDB(title, type, year, language);
      if (result?.id) {
        return await MetadataService.getDetails(result.id, type, language);
      }
      return null;
    } catch (err) {
      console.warn(`Failed to get details for ${title}:`, err);
      return null;
    }
  },

  /**
   * Helper to get a high-quality image URL
   */
  getImageUrl: (path: string | null | undefined, size: 'w500' | 'w780' | 'w1280' | 'original' = 'w500') => {
    if (!path) return null;
    return `https://image.tmdb.org/t/p/${size}${path}`;
  },

  /**
   * Restituisce un array di contenuti simili coerenti (film o serie) per suggerimenti.
   * Usa i dati TMDB già ottenuti da getDetails.
   * Se non ci sono risultati, prova a suggerire titoli dello stesso genere.
   * @param details - Oggetto dettagli TMDB (output di getDetails o getDetailsByTitle)
   * @param type - 'movie' o 'series'
   * @returns Array di oggetti { id, title, poster, overview, type }
   */
  getSimilar: (details: any, type: 'movie' | 'series') => {
    if (!details) return [];
    // Unisci similar e recommendations, filtra duplicati per id
    const similarArr = [
      ...(details.similar?.results || []),
      ...(details.recommendations?.results || [])
    ];
    const seen = new Set();
    let normalized = similarArr.filter(item => {
      if (!item?.id || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    }).map(item => ({
      id: item.id,
      title: item.title || item.name || '',
      poster: item.poster_path ? MetadataService.getImageUrl(item.poster_path, 'w500') : null,
      overview: item.overview || '',
      popularity: item.popularity || 0,
      type: type
    }));
    // Ordina per popolarità decrescente
    normalized = normalized.sort((a, b) => b.popularity - a.popularity);
    // Se non ci sono risultati, prova a suggerire titoli dello stesso genere
    if (normalized.length === 0 && Array.isArray(details.genres) && details.genres.length > 0 && details.id) {
      // Cerca tra recommendations tutti i titoli con almeno un genere in comune
      const genreIds = details.genres.map((g: any) => g.id);
      const allCandidates = [
        ...(details.recommendations?.results || []),
        ...(details.similar?.results || [])
      ];
      const genreSeen = new Set();
      normalized = allCandidates.filter(item => {
        if (!item?.id || item.id === details.id || genreSeen.has(item.id)) return false;
        genreSeen.add(item.id);
        if (!Array.isArray(item.genre_ids)) return false;
        return item.genre_ids.some((gid: number) => genreIds.includes(gid));
      }).map(item => ({
        id: item.id,
        title: item.title || item.name || '',
        poster: item.poster_path ? MetadataService.getImageUrl(item.poster_path, 'w500') : null,
        overview: item.overview || '',
        popularity: item.popularity || 0,
        type: type
      })).sort((a, b) => b.popularity - a.popularity);
    }
    // Rimuovi la proprietà popularity prima di restituire
    return normalized.map(({popularity, ...rest}) => rest);
  },
};