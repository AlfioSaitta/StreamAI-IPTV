import { CacheService } from './cacheService.ts';
import {
  cleanTitle,
  extractYear,
  isLikelyTitleMatch,
  pickBestMetadataCandidate
} from './metadataUtils.ts';

// Simple in-memory cache to avoid hitting rate limits
const tmdbCache = new Map<string, any>();
const tmdbInFlight = new Map<string, Promise<any>>();
const TMDB_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TMDB_CACHE_MAX_ENTRIES = 500;

const normalizeTmdbLanguage = (language: string): string => {
  if (language.includes('-')) return language;
  const defaults: Record<string, string> = {
    it: 'it-IT',
    en: 'en-US',
    es: 'es-ES',
    fr: 'fr-FR',
    de: 'de-DE',
    pt: 'pt-PT',
    ru: 'ru-RU',
    ja: 'ja-JP',
    ko: 'ko-KR',
    zh: 'zh-CN',
    ar: 'ar-SA'
  };
  return defaults[language] || 'en-US';
};

// Configura la chiave in .env come VITE_TMDB_API_KEY. Non inserire chiavi nel codice sorgente.
const TMDB_API_KEY = import.meta.env.VITE_TMDB_API_KEY || '';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

export const MetadataService = {
  isConfigured: (): boolean => Boolean(TMDB_API_KEY),
  extractYear,
  isTitleMatch: isLikelyTitleMatch,

  /**
   * Cleans raw IPTV names to get a search-friendly title.
   * Example: "[EN] The Matrix (1999) FHD.mkv" -> "The Matrix"
   */
  cleanTitle,

  /**
   * Searches TMDB for a movie or series.
   */
  searchTMDB: async (query: string, type: 'movie' | 'series', year?: string, language: string = 'it') => {
    if (!TMDB_API_KEY) return null;
    
    // Normalize query
    const cleanQuery = cleanTitle(query).trim();
    if (!cleanQuery || cleanQuery.length < 2) return null;

    const expectedYear = year || extractYear(query);
    const normalizedLanguage = normalizeTmdbLanguage(language);
    const cacheKey = `tmdb_search_${type}_${cleanQuery.toLowerCase()}_${expectedYear || ''}_${normalizedLanguage}`;
    if (tmdbCache.has(cacheKey)) return tmdbCache.get(cacheKey);
    if (tmdbInFlight.has(cacheKey)) return tmdbInFlight.get(cacheKey);

    const request = (async () => {
      const cached = await CacheService.getApiData(cacheKey, { maxAgeMs: TMDB_CACHE_TTL_MS });
      if (cached !== null) {
        tmdbCache.set(cacheKey, cached);
        return cached;
      }

      const searchType = type === 'series' ? 'tv' : 'movie';
      const languagesToTry = Array.from(new Set([normalizedLanguage, 'en-US']));

      for (const lang of languagesToTry) {
        let url = `${TMDB_BASE_URL}/search/${searchType}?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(cleanQuery)}&language=${lang}&include_adult=false`;
        if (expectedYear) url += type === 'series' ? `&first_air_date_year=${expectedYear}` : `&primary_release_year=${expectedYear}`;

        try {
          const res = await fetch(url);
          if (!res.ok) {
            console.warn(`TMDB Search failed for ${query} (${lang}): ${res.statusText}`);
            continue;
          }
          const data = await res.json();
          const result = pickBestMetadataCandidate(data.results || [], cleanQuery, expectedYear);
          if (result) {
            tmdbCache.set(cacheKey, result);
            await CacheService.saveApiData(cacheKey, result);
            CacheService.pruneApiCache('tmdb_', TMDB_CACHE_MAX_ENTRIES).catch(() => undefined);
            return result;
          }
        } catch (e) {
          console.warn(`TMDB Search failed for ${query} (${lang}):`, e);
        }
      }

      return null;
    })();

    tmdbInFlight.set(cacheKey, request);
    try {
      return await request;
    } finally {
      tmdbInFlight.delete(cacheKey);
    }
  },

  /**
   * Gets full details (images, plot, cast) by TMDB ID.
   */
  getDetails: async (tmdbId: number, type: 'movie' | 'series', language: string = 'it') => {
    if (!TMDB_API_KEY) return null;

    const cacheKey = `details_${type}_${tmdbId}_${language}`;
    if (tmdbCache.has(cacheKey)) return tmdbCache.get(cacheKey);
    if (tmdbInFlight.has(cacheKey)) return tmdbInFlight.get(cacheKey);

    const request = (async () => {
      const cached = await CacheService.getApiData(`tmdb_${cacheKey}`, { maxAgeMs: TMDB_CACHE_TTL_MS });
      if (cached !== null) {
        tmdbCache.set(cacheKey, cached);
        return cached;
      }

      const searchType = type === 'series' ? 'tv' : 'movie';
      const normalizedLanguage = normalizeTmdbLanguage(language);
      const url = `${TMDB_BASE_URL}/${searchType}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=credits,images,similar,recommendations&language=${normalizedLanguage}`;

      const res = await fetch(url);
      if (!res.ok) throw new Error(res.statusText);
      const data = await res.json();
      
      tmdbCache.set(cacheKey, data);
      await CacheService.saveApiData(`tmdb_${cacheKey}`, data);
      CacheService.pruneApiCache('tmdb_', TMDB_CACHE_MAX_ENTRIES).catch(() => undefined);
      return data;
    })();

    tmdbInFlight.set(cacheKey, request);
    try {
      return await request;
    } catch (e) {
      console.warn(`TMDB Details failed for ID ${tmdbId}:`, e);
      return null;
    } finally {
      tmdbInFlight.delete(cacheKey);
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