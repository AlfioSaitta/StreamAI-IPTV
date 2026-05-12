
import { Category, Channel, XtreamCredentials, XtreamContent, XtreamAccountInfo } from '../types.ts';
import { MetadataService } from './metadata.ts';
import { CacheService } from './cacheService.ts';

// User-Agent per tutte le richieste IPTV
const IPTV_USER_AGENT = 'StreamAI IPTV';

// Helper for direct fetching con User-Agent IPTV
const fetchDirect = async (url: string) => {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': IPTV_USER_AGENT,
        'Accept': '*/*',
      }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error(`Fetch error for ${url}:`, err);
    throw err;
  }
};

const normalizeBaseUrl = (url: string) => {
    let baseUrl = url.trim().replace(/\/$/, '');
    if (!/^https?:\/\//i.test(baseUrl)) {
        baseUrl = `http://${baseUrl}`;
    }
    return baseUrl;
}

export const getSeriesInfo = async (creds: XtreamCredentials, seriesId: string | number): Promise<any> => {
    const baseUrl = normalizeBaseUrl(creds.url);
    // Series info is dynamic and small, we might cache it briefly or just fetch it.
    // For now, let's cache it to improve back/forth navigation speed
    const cacheKey = `series_${creds.url}_${seriesId}`;
    const cached = await CacheService.getApiData(cacheKey);
    if (cached) return cached;

    const url = `${baseUrl}/player_api.php?username=${creds.username}&password=${creds.password}&action=get_series_info&series_id=${seriesId}`;
    const data = await fetchDirect(url);
    
    await CacheService.saveApiData(cacheKey, data);
    return data;
};

export const loginXtream = async (creds: XtreamCredentials, forceRefresh = false): Promise<XtreamContent> => {
  const baseUrl = normalizeBaseUrl(creds.url);
  const cacheKey = `content_${creds.url}_${creds.username}`;

  // 1. Check Cache first (if not forcing refresh)
  if (!forceRefresh) {
      const cachedData = await CacheService.getApiData(cacheKey);
      if (cachedData) {
          console.log("Loaded content from Cache (Instant Start)");
          return cachedData;
      }
  }

  try {
    // 2. Authenticate
    const authUrl = `${baseUrl}/player_api.php?username=${creds.username}&password=${creds.password}`;
    const authData = await fetchDirect(authUrl);
    
    if (authData.user_info?.auth === 0) {
      throw new Error('Authentication failed. Check credentials.');
    }

    // Parallel Fetching
    const fetchSafe = async (url: string) => {
        try { return await fetchDirect(url); } catch (e) { console.warn("Partial fetch failed:", url); return []; }
    };

    const [
      liveCats, liveStreams,
      vodCats, vodStreams,
      seriesCats, seriesStreams
    ] = await Promise.all([
      fetchSafe(`${baseUrl}/player_api.php?username=${creds.username}&password=${creds.password}&action=get_live_categories`),
      fetchSafe(`${baseUrl}/player_api.php?username=${creds.username}&password=${creds.password}&action=get_live_streams`),
      fetchSafe(`${baseUrl}/player_api.php?username=${creds.username}&password=${creds.password}&action=get_vod_categories`),
      fetchSafe(`${baseUrl}/player_api.php?username=${creds.username}&password=${creds.password}&action=get_vod_streams`),
      fetchSafe(`${baseUrl}/player_api.php?username=${creds.username}&password=${creds.password}&action=get_series_categories`),
      fetchSafe(`${baseUrl}/player_api.php?username=${creds.username}&password=${creds.password}&action=get_series`)
    ]);

    // Helper to map streams to categories
    const processContent = (categories: any[], streams: any[], type: 'live' | 'movie' | 'series'): Category[] => {
      const categoryMap: Record<string, Category> = {};

      if (Array.isArray(categories)) {
        categories.forEach((c: any) => {
          categoryMap[c.category_id] = {
            name: c.category_name,
            channels: []
          };
        });
      }

      if (Array.isArray(streams)) {
        streams.forEach((stream: any) => {
          const catId = stream.category_id;
          let streamUrl = '';

          if (type === 'live') {
             // Usa .ts invece di .m3u8 per evitare problemi con redirect HLS
             streamUrl = `${baseUrl}/live/${creds.username}/${creds.password}/${stream.stream_id}.ts`;
          } else if (type === 'movie') {
             const ext = stream.container_extension || 'mp4';
             streamUrl = `${baseUrl}/movie/${creds.username}/${creds.password}/${stream.stream_id}.${ext}`;
          } else if (type === 'series') {
             streamUrl = ''; 
          }

          let year = undefined;
          if (stream.releaseDate) year = stream.releaseDate.split('-')[0];
          else if (stream.year) year = stream.year;
          else if (stream.added && !isNaN(Number(stream.added))) {
             year = new Date(Number(stream.added) * 1000).getFullYear().toString();
          }

          const rawName = stream.name || '';
          const cleanName = MetadataService.cleanTitle(rawName);

          const channel: Channel = {
            id: type === 'series' ? `series-${stream.series_id}` : stream.stream_id.toString(),
            name: rawName,
            cleanName: cleanName,
            logo: stream.stream_icon || stream.cover,
            group: categoryMap[catId]?.name || 'Uncategorized',
            url: streamUrl,
            type: type,
            seriesId: type === 'series' ? stream.series_id : undefined,
            description: stream.plot || stream.description,
            rating: stream.rating || stream.rating_5based,
            year: year,
            genre: stream.genre,
            cast: stream.cast,
            director: stream.director,
            // D.1 EPG: keep the provider-supplied tvg id for live streams
            tvgId: type === 'live'
              ? (typeof stream.epg_channel_id === 'string' && stream.epg_channel_id ? stream.epg_channel_id : undefined)
              : undefined,
          };

          if (categoryMap[catId]) {
            categoryMap[catId].channels.push(channel);
          } else {
             if (!categoryMap['other']) categoryMap['other'] = { name: 'Other', channels: [] };
             categoryMap['other'].channels.push(channel);
          }
        });
      }

      return Object.values(categoryMap)
        .filter(c => c.channels.length > 0)
        .sort((a, b) => a.name.localeCompare(b.name));
    };

    const finalResult = {
      live: processContent(liveCats, liveStreams, 'live'),
      vod: processContent(vodCats, vodStreams, 'movie'),
      series: processContent(seriesCats, seriesStreams, 'series')
    };

    // Save to Cache for next time
    await CacheService.saveApiData(cacheKey, finalResult);

    return finalResult;

  } catch (error) {
    console.error("Xtream Error:", error);
    throw error;
  }
};

/**
 * Lightweight health-check: calls `player_api.php` (no `action`) to retrieve
 * just the `user_info` block. Used by the periodic Xtream health-check
 * (F.3 IMPROVEMENT_PLAN_V2) to surface expiry / connection metrics.
 *
 * Throws on auth failure / network error so callers can mark the badge red.
 */
export const getXtreamAccountInfo = async (
  creds: XtreamCredentials
): Promise<XtreamAccountInfo> => {
  const baseUrl = normalizeBaseUrl(creds.url);
  const url = `${baseUrl}/player_api.php?username=${encodeURIComponent(creds.username)}&password=${encodeURIComponent(creds.password)}`;
  const data = await fetchDirect(url);

  const ui = data?.user_info ?? {};
  if (ui.auth === 0) {
    throw new Error('Xtream authentication failed (auth=0)');
  }

  const toNumber = (v: unknown): number | undefined => {
    if (v === undefined || v === null || v === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };

  return {
    username: typeof ui.username === 'string' ? ui.username : undefined,
    status: typeof ui.status === 'string' ? ui.status : undefined,
    auth: toNumber(ui.auth),
    // `exp_date` can be "0" / "" / null for unlimited accounts — keep as-is for caller logic.
    expDate: ui.exp_date ?? null,
    isTrial: typeof ui.is_trial === 'string' ? ui.is_trial : undefined,
    activeConnections: toNumber(ui.active_cons),
    maxConnections: toNumber(ui.max_connections),
    createdAt: typeof ui.created_at === 'string' ? ui.created_at : undefined,
    allowedOutputFormats: Array.isArray(ui.allowed_output_formats)
      ? ui.allowed_output_formats.filter((x: unknown): x is string => typeof x === 'string')
      : undefined,
    fetchedAt: Date.now(),
  };
};

