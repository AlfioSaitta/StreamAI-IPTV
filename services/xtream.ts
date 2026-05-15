
import {
  Category,
  Channel,
  XtreamCredentials,
  XtreamContent,
  XtreamAccountInfo,
  XtreamBlockHealth,
} from '../types.ts';
import { MetadataService } from './metadata.ts';
import { CacheService } from './cacheService.ts';

// User-Agent per tutte le richieste IPTV
const IPTV_USER_AGENT = 'StreamAI IPTV';

// BUG-1 §2.3 Step 3 + hotfix 2026-05-14: timeout esplicito per le fetch del
// catalogo. I provider Xtream possono rispondere 503 sotto carico, e i
// payload `get_vod_streams` / `get_series` arrivano a 10-30 MB di JSON su
// account con cataloghi grandi: timeout troppo aggressivi facevano scadere
// la richiesta prima del completamento del download.
const DEFAULT_FETCH_TIMEOUT_MS = 45_000;
const RETRY_FETCH_TIMEOUT_MS = 30_000;
const RETRY_BACKOFF_MS = 1_500;

/**
 * Risultato strutturato per ogni chiamata di catalogo. Sostituisce il
 * vecchio `fetchSafe` che restituiva `[]` indistinguibile da un array vuoto
 * legittimo (BUG-1 §2.1 cause 1+2).
 */
type FetchResult<T> = { ok: true; data: T[] } | { ok: false; reason: string };

// Helper for direct fetching con User-Agent IPTV e timeout
const fetchDirect = async (url: string, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS): Promise<unknown> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': IPTV_USER_AGENT,
        'Accept': '*/*',
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error(`Request timeout after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
};

const normalizeBaseUrl = (url: string) => {
    let baseUrl = url.trim().replace(/\/$/, '');
    if (!/^https?:\/\//i.test(baseUrl)) {
        baseUrl = `http://${baseUrl}`;
    }
    return baseUrl;
}

/**
 * BUG-1 §2.3 Step 2: tenta il parsing alternativo quando il server non
 * risponde con un array puro. Molti pannelli Xtream wrappano il payload in
 * `{ data: [...] }`, `{ streams: [...] }`, `{ result: [...] }`, oppure
 * ritornano `{ error: "..." }` in caso di sezione disabilitata. Restituisce
 * un FetchResult invece di `[]` per non avvelenare la cache (§2.1 causa 1).
 */
const fetchCatalog = async <T = unknown>(
  url: string,
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<FetchResult<T>> => {
  try {
    const data = await fetchDirect(url, timeoutMs);
    if (Array.isArray(data)) {
      return { ok: true, data: data as T[] };
    }
    if (data && typeof data === 'object') {
      const obj = data as Record<string, unknown>;
      const wrapped =
        (Array.isArray(obj.data)    && (obj.data as T[])) ||
        (Array.isArray(obj.streams) && (obj.streams as T[])) ||
        (Array.isArray(obj.result)  && (obj.result as T[])) ||
        null;
      if (wrapped) return { ok: true, data: wrapped };
      if (typeof obj.error === 'string' && obj.error) {
        return { ok: false, reason: `Provider error: ${obj.error}` };
      }
      if (typeof obj.message === 'string' && obj.message) {
        return { ok: false, reason: `Provider error: ${obj.message}` };
      }
    }
    // HTML, stringa o altro: non array, non oggetto wrapper conosciuto.
    return { ok: false, reason: 'Response is not an array (unexpected format)' };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Network error';
    console.warn(`[Xtream] Catalog fetch failed: ${url} → ${message}`);
    return { ok: false, reason: message };
  }
};

/**
 * BUG-1 §2.3 Step 3: una sola ri-emissione con backoff su fetch fallita.
 * Manteniamo *un* tentativo per non saturare provider già sotto carico.
 */
const fetchCatalogWithRetry = async <T = unknown>(
  url: string,
  label: string,
): Promise<FetchResult<T>> => {
  const first = await fetchCatalog<T>(url, DEFAULT_FETCH_TIMEOUT_MS);
  if (first.ok) return first;
  await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));
  console.info(`[Xtream] Retry ${label} after ${RETRY_BACKOFF_MS}ms (reason: ${first.reason})`);
  const second = await fetchCatalog<T>(url, RETRY_FETCH_TIMEOUT_MS);
  if (second.ok) return second;
  return { ok: false, reason: second.reason || first.reason };
};

/** Helper per derivare un `XtreamBlockHealth` da `FetchResult` + categorie processate. */
const deriveHealth = <T>(
  result: FetchResult<T>,
  processedCategories: Category[],
): XtreamBlockHealth => {
  if (!result.ok) {
    return { status: 'error', reason: result.reason };
  }
  const itemCount = result.data.length;
  if (itemCount === 0 || processedCategories.length === 0) {
    return {
      status: 'empty',
      itemCount,
      reason: itemCount === 0
        ? "Il server ha risposto correttamente ma non c'è alcun contenuto. La sezione potrebbe essere disabilitata per il tuo abbonamento."
        : 'Risposta valida ma nessuna categoria con contenuti.',
    };
  }
  return { status: 'ok', itemCount };
};

export const getSeriesInfo = async (creds: XtreamCredentials, seriesId: string | number): Promise<any> => {
    const baseUrl = normalizeBaseUrl(creds.url);
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

  // 1. Read cached content (sempre — serve come fallback "best-of" anche su
  //    forceRefresh per non regredire blocchi sani — BUG-1 §2.3 Step 1).
  const cachedData = (await CacheService.getApiData(cacheKey)) as XtreamContent | null;

  if (!forceRefresh && cachedData) {
    // Hotfix 2026-05-14: la versione precedente forzava un refresh bloccante
    // ogni volta che la cache era "unhealthy" o legacy. In pratica questo
    // significava: utente con cache già usabile (anche solo Live + Series)
    // restava su "Caricamento Libreria…" finché i timeout HTTP non
    // scadevano. Soluzione: usare SEMPRE la cache come instant-start e
    // delegare al chiamante (App.tsx) il refresh in background quando
    // `health.vod` / `health.series` non sono `ok`.
    const hasContent =
      (cachedData.live?.length ?? 0) > 0 ||
      (cachedData.vod?.length ?? 0) > 0 ||
      (cachedData.series?.length ?? 0) > 0;
    const hasLegacyShape = !cachedData.health;

    if (hasContent) {
      if (hasLegacyShape) {
        // Sintetizza un `health` stale per tutti i blocchi così App.tsx può
        // schedulare il refresh in background (vedi `setTimeout` in App).
        const synth = (arr?: { channels?: unknown[] }[]): XtreamBlockHealth => ({
          status: arr && arr.length > 0 ? 'stale' : 'empty',
          itemCount: arr?.reduce((s, c) => s + (c.channels?.length ?? 0), 0) ?? 0,
          reason: 'Cache legacy: aggiornamento programmato in background.',
        });
        console.log('[Xtream] Legacy cache: instant-start + background refresh');
        return {
          ...cachedData,
          health: {
            live:   synth(cachedData.live),
            vod:    synth(cachedData.vod),
            series: synth(cachedData.series),
            fetchedAt: 0, // 0 = mai aggiornato dopo il fix BUG-1
          },
        };
      }
      console.log('[Xtream] Loaded content from Cache (Instant Start)');
      return cachedData;
    }
    // Cache esiste ma totalmente vuota: meglio attendere il server.
    console.warn('[Xtream] Cache empty across all blocks, forcing fresh fetch');
  }

  try {
    // 2. Authenticate
    const authUrl = `${baseUrl}/player_api.php?username=${creds.username}&password=${creds.password}`;
    const authData = await fetchDirect(authUrl);

    if ((authData as { user_info?: { auth?: number } })?.user_info?.auth === 0) {
      throw new Error('Authentication failed. Check credentials.');
    }

    // 3. Parallel fetching con tracking strutturato (BUG-1 §2.3 Step 2-3)
    const [
      liveCatsRes, liveStreamsRes,
      vodCatsRes, vodStreamsRes,
      seriesCatsRes, seriesStreamsRes,
    ] = await Promise.all([
      fetchCatalog(`${baseUrl}/player_api.php?username=${creds.username}&password=${creds.password}&action=get_live_categories`),
      fetchCatalogWithRetry(`${baseUrl}/player_api.php?username=${creds.username}&password=${creds.password}&action=get_live_streams`, 'live_streams'),
      fetchCatalog(`${baseUrl}/player_api.php?username=${creds.username}&password=${creds.password}&action=get_vod_categories`),
      fetchCatalogWithRetry(`${baseUrl}/player_api.php?username=${creds.username}&password=${creds.password}&action=get_vod_streams`, 'vod_streams'),
      fetchCatalog(`${baseUrl}/player_api.php?username=${creds.username}&password=${creds.password}&action=get_series_categories`),
      fetchCatalogWithRetry(`${baseUrl}/player_api.php?username=${creds.username}&password=${creds.password}&action=get_series`, 'series'),
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

          // C.3 Filtri avanzati: timestamp "added" del provider (in secondi
          // su Xtream, normalizzato a ms qui) per il filtro "Nuovi".
          let addedAt: number | undefined;
          if (stream.added && !isNaN(Number(stream.added))) {
            const secs = Number(stream.added);
            // I provider usano UNIX seconds; alcuni mandano già ms — euristica
            // semplice: > 10^12 ⇒ già ms.
            addedAt = secs > 1e12 ? secs : secs * 1000;
          }

          const rawName = stream.name || '';
          const cleanName = MetadataService.cleanTitle(rawName);

          // Bug fix (2026-05-15): alcuni provider Xtream non popolano
          // `stream_icon` nel payload di `get_vod_streams`, mettendo il poster
          // in `cover_big` (o, raramente, in `movie_image`). Le serie usano
          // `cover` (campo standard di `get_series`), i live usano sempre
          // `stream_icon`. Fallback in ordine di preferenza: prima i campi
          // più "alti" (poster grande), poi le icone più piccole.
          const logo: string | undefined =
            stream.stream_icon ||
            stream.cover ||
            stream.cover_big ||
            stream.movie_image ||
            undefined;

          const channel: Channel = {
            id: type === 'series' ? `series-${stream.series_id}` : stream.stream_id.toString(),
            name: rawName,
            cleanName: cleanName,
            logo,
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
            tvgId: type === 'live'
              ? (typeof stream.epg_channel_id === 'string' && stream.epg_channel_id ? stream.epg_channel_id : undefined)
              : undefined,
            addedAt,
          };

          if (categoryMap[catId]) {
            categoryMap[catId].channels.push(channel);
          } else {
             if (!categoryMap['other']) categoryMap['other'] = { name: 'Other', channels: [] };
             categoryMap['other'].channels.push(channel);
          }
        });
      }

      const filtered = Object.values(categoryMap).filter(c => c.channels.length > 0);
      // FIX 2026-05-15: per la sezione Live mantieni l'ordine dei gruppi
      // così come restituito dal server Xtream (l'utente lo configura sul
      // provider in base a importanza/preferenze nazionali). VOD e Serie
      // restano ordinate alfabeticamente per semplificare la ricerca in
      // liste molto lunghe (centinaia di generi).
      return type === 'live'
        ? filtered
        : filtered.sort((a, b) => a.name.localeCompare(b.name));
    };

    // Estrai i dati grezzi (array vuoto su errore: la health structure tiene
    // comunque traccia del fallimento per la UI).
    const liveCats      = liveCatsRes.ok      ? liveCatsRes.data      : [];
    const liveStreams   = liveStreamsRes.ok   ? liveStreamsRes.data   : [];
    const vodCats       = vodCatsRes.ok       ? vodCatsRes.data       : [];
    const vodStreams    = vodStreamsRes.ok    ? vodStreamsRes.data    : [];
    const seriesCats    = seriesCatsRes.ok    ? seriesCatsRes.data    : [];
    const seriesStreams = seriesStreamsRes.ok ? seriesStreamsRes.data : [];

    const liveCategories   = processContent(liveCats,   liveStreams,   'live');
    const vodCategories    = processContent(vodCats,    vodStreams,    'movie');
    const seriesCategories = processContent(seriesCats, seriesStreams, 'series');

    // BUG-1 §2.3 Step 1: deriva health *prima* del merge.
    const fetchedAt = Date.now();
    const liveHealth   = deriveHealth(liveStreamsRes,   liveCategories);
    const vodHealth    = deriveHealth(vodStreamsRes,    vodCategories);
    const seriesHealth = deriveHealth(seriesStreamsRes, seriesCategories);

    // BUG-1 §2.3 Step 1: se il blocco corrente è regredito (errore / vuoto
    // dove prima c'erano contenuti), conserva i dati cached. Previene la
    // cache poisoning da hiccup temporanei del server.
    const mergeBlock = (
      key: 'live' | 'vod' | 'series',
      freshCats: Category[],
      freshHealth: XtreamBlockHealth,
    ): { categories: Category[]; health: XtreamBlockHealth } => {
      const fresh = { categories: freshCats, health: freshHealth };
      if (!cachedData) return fresh;
      const cachedCats = cachedData[key] ?? [];
      const cachedItemCount = cachedCats.reduce((sum, c) => sum + c.channels.length, 0);

      if (freshHealth.status === 'error' && cachedItemCount > 0) {
        console.warn(`[Xtream] ${key} block regressed (error: ${freshHealth.reason}), preserving ${cachedItemCount} cached items`);
        return {
          categories: cachedCats,
          health: {
            status: 'stale',
            itemCount: cachedItemCount,
            reason: `Aggiornamento fallito (${freshHealth.reason}). Mostrati i dati salvati in cache.`,
          },
        };
      }
      // Threshold piccolo: se il server torna 0 ma il cache ne aveva ≥ 50,
      // probabilmente è un hiccup, non una rimozione reale.
      if (freshHealth.status === 'empty' && cachedItemCount >= 50) {
        console.warn(`[Xtream] ${key} block returned 0 items but cache had ${cachedItemCount}, preserving cached`);
        return {
          categories: cachedCats,
          health: {
            status: 'stale',
            itemCount: cachedItemCount,
            reason: `Il server ha risposto con 0 contenuti; mantenuti ${cachedItemCount} elementi dalla cache.`,
          },
        };
      }
      return fresh;
    };

    const mergedLive   = mergeBlock('live',   liveCategories,   liveHealth);
    const mergedVod    = mergeBlock('vod',    vodCategories,    vodHealth);
    const mergedSeries = mergeBlock('series', seriesCategories, seriesHealth);

    const finalResult: XtreamContent = {
      live:   mergedLive.categories,
      vod:    mergedVod.categories,
      series: mergedSeries.categories,
      health: {
        live:   mergedLive.health,
        vod:    mergedVod.health,
        series: mergedSeries.health,
        fetchedAt,
      },
    };

    // BUG-1 §2.3 Step 1: scrivi in cache solo se almeno 2/3 blocchi sono
    // sani (`ok` o `stale`). Previene il caso in cui il provider risponde a
    // tutto con errore e l'utente vede l'app vuota "per sempre".
    const healthyBlocks = [mergedLive.health, mergedVod.health, mergedSeries.health]
      .filter(h => h.status === 'ok' || h.status === 'stale')
      .length;
    if (healthyBlocks >= 2) {
      await CacheService.saveApiData(cacheKey, finalResult);
    } else {
      console.warn('[Xtream] Skipping cache write: only', healthyBlocks, '/3 blocks healthy', finalResult.health);
    }

    return finalResult;

  } catch (error) {
    console.error('Xtream Error:', error);
    // Fallback su cache sana se l'errore è di rete / auth.
    if (cachedData && (cachedData.live?.length || cachedData.vod?.length || cachedData.series?.length)) {
      console.warn('[Xtream] Auth/network error, falling back to cached content');
      return {
        ...cachedData,
        health: {
          live:   cachedData.health?.live   ?? { status: 'stale' },
          vod:    cachedData.health?.vod    ?? { status: 'stale' },
          series: cachedData.health?.series ?? { status: 'stale' },
          fetchedAt: cachedData.health?.fetchedAt ?? Date.now(),
        },
      };
    }
    throw error;
  }
};

/**
 * Lightweight health-check: calls `player_api.php` (no `action`) to retrieve
 * just the `user_info` block. Used by the periodic Xtream health-check
 * (F.3) to surface expiry / connection metrics.
 *
 * Throws on auth failure / network error so callers can mark the badge red.
 */
export const getXtreamAccountInfo = async (
  creds: XtreamCredentials
): Promise<XtreamAccountInfo> => {
  const baseUrl = normalizeBaseUrl(creds.url);
  const url = `${baseUrl}/player_api.php?username=${encodeURIComponent(creds.username)}&password=${encodeURIComponent(creds.password)}`;
  const data = (await fetchDirect(url)) as { user_info?: Record<string, unknown> };

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
    expDate: (ui.exp_date as string | null | undefined) ?? null,
    isTrial: typeof ui.is_trial === 'string' ? ui.is_trial : undefined,
    activeConnections: toNumber(ui.active_cons),
    maxConnections: toNumber(ui.max_connections),
    createdAt: typeof ui.created_at === 'string' ? ui.created_at : undefined,
    allowedOutputFormats: Array.isArray(ui.allowed_output_formats)
      ? (ui.allowed_output_formats as unknown[]).filter((x): x is string => typeof x === 'string')
      : undefined,
    fetchedAt: Date.now(),
  };
};

/** Internal export for tests (BUG-1 §2.3 Step 5). */
export const __testing = {
  fetchCatalog,
  fetchCatalogWithRetry,
  deriveHealth,
};

