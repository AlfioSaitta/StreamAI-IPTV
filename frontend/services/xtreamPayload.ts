/**
 * Normalizza il payload `FullPlaylist` emesso dal backend Go (evento
 * `playlist:success`) nella shape `XtreamContent` consumata dal frontend.
 *
 * Perché serve: `internal/services/playlist` restituisce le strutture grezze
 * dell'API Xtream (`stream_id`, `stream_icon`, `container_extension`, ...),
 * mentre il resto dell'app consuma `Channel` con `id`, `url`, `cleanName`,
 * `group` e `type` già derivati. Nel path TypeScript quella derivazione avviene
 * in `xtream.ts → processContent()` (e in `catalogWorker.ts`); sul path Wails
 * non avveniva affatto, quindi i canali arrivavano con `url` e `id`
 * `undefined`: playback impossibile, key React instabili, history/preferiti/
 * reminder EPG orfani e ricerca degradata.
 *
 * La logica di mapping qui replica deliberatamente quella di
 * `xtream.ts → processContent()` per non introdurre divergenze di
 * comportamento tra i due path.
 */
import type {
  Category,
  Channel,
  StreamType,
  XtreamBlockHealth,
  XtreamContent,
  XtreamCredentials,
} from '../types.ts';
import { cleanTitle } from './metadataUtils.ts';
import { normalizeBaseUrl } from './xtream.ts';

/** `internal/services/playlist.Stream` serializzato. */
interface GoStream {
  stream_id?: number;
  series_id?: number;
  name?: string;
  stream_icon?: string;
  cover?: string;
  cover_big?: string;
  movie_image?: string;
  epg_channel_id?: string;
  added?: string | number;
  rating?: string;
  rating_5based?: number;
  container_extension?: string;
  plot?: string;
  description?: string;
  genre?: string;
  cast?: string;
  director?: string;
  releaseDate?: string;
  year?: string;
  tmdb_id?: string | number;
}

interface GoCategory {
  category_id?: string;
  category_name?: string;
  channels?: GoStream[];
}

/** `internal/services/playlist.FullPlaylist` serializzato. */
export interface GoFullPlaylist {
  live?: GoCategory[];
  vod?: GoCategory[];
  series?: GoCategory[];
  /**
   * Blocchi la cui fetch è fallita lato backend (es. risposta troncata dal
   * provider). Un blocco vuoto elencato qui NON significa "il provider non ha
   * contenuti": significa che non siamo riusciti a scaricarli.
   */
  failedBlocks?: Array<'live' | 'vod' | 'series'>;
}

const buildStreamUrl = (
  type: StreamType,
  baseUrl: string,
  creds: XtreamCredentials,
  stream: GoStream,
): string => {
  if (stream.stream_id === undefined) return '';
  const auth = `${creds.username}/${creds.password}`;
  if (type === 'live') return `${baseUrl}/live/${auth}/${stream.stream_id}.ts`;
  if (type === 'movie') {
    return `${baseUrl}/movie/${auth}/${stream.stream_id}.${stream.container_extension || 'mp4'}`;
  }
  // Le serie non hanno un URL per-serie: l'URL è per-episodio e viene
  // risolto quando si apre il dettaglio.
  return '';
};

const extractAddedAt = (added?: string | number): number | undefined => {
  if (added === undefined || added === '' || isNaN(Number(added))) return undefined;
  const secs = Number(added);
  // I provider usano UNIX seconds; alcuni mandano già ms — euristica: > 10^12 ⇒ ms.
  return secs > 1e12 ? secs : secs * 1000;
};

const extractYear = (stream: GoStream, addedAt?: number): string | undefined => {
  if (stream.year) return String(stream.year);
  if (stream.releaseDate) return String(stream.releaseDate).split('-')[0];
  if (addedAt) return new Date(addedAt).getFullYear().toString();
  return undefined;
};

const toChannel = (
  stream: GoStream,
  type: StreamType,
  categoryName: string,
  baseUrl: string,
  creds: XtreamCredentials,
): Channel => {
  const rawName = stream.name || '';
  const addedAt = extractAddedAt(stream.added);

  // Stessa catena di fallback del path TS: alcuni provider popolano il poster
  // in `cover`/`cover_big`/`movie_image` invece che in `stream_icon`.
  const logo = stream.stream_icon || stream.cover || stream.cover_big || stream.movie_image || undefined;
  const tmdbIdValue = stream.tmdb_id;
  const parsedTmdbId = tmdbIdValue && !isNaN(Number(tmdbIdValue)) ? Number(tmdbIdValue) : undefined;

  return {
    id: type === 'series' ? `series-${stream.series_id}` : String(stream.stream_id),
    name: rawName,
    cleanName: cleanTitle(rawName),
    logo,
    group: categoryName,
    url: buildStreamUrl(type, baseUrl, creds, stream),
    type,
    seriesId: type === 'series' ? stream.series_id : undefined,
    description: stream.plot || stream.description,
    rating: stream.rating || (stream.rating_5based !== undefined ? String(stream.rating_5based) : undefined),
    year: extractYear(stream, addedAt),
    genre: stream.genre,
    cast: stream.cast,
    director: stream.director,
    tmdbId: parsedTmdbId,
    tvgId: type === 'live' && stream.epg_channel_id ? stream.epg_channel_id : undefined,
    addedAt,
  };
};

const normalizeBlock = (
  raw: GoCategory[] | undefined,
  type: StreamType,
  baseUrl: string,
  creds: XtreamCredentials,
): Category[] => {
  const categories = (raw ?? []).map((cat) => {
    const categoryName = cat.category_name || 'Uncategorized';
    return {
      name: categoryName,
      channels: (cat.channels ?? [])
        .filter((s) => type === 'series' || s.stream_id !== undefined)
        .map((s) => toChannel(s, type, categoryName, baseUrl, creds)),
    };
  });

  const nonEmpty = categories.filter((c) => c.channels.length > 0);

  // Stessa regola del path TS (AGENTS.md gotcha #6): i gruppi Live mantengono
  // l'ordine configurato sul provider, VOD e Serie vanno ordinati per nome.
  return type === 'live' ? nonEmpty : nonEmpty.sort((a, b) => a.name.localeCompare(b.name));
};

const deriveHealth = (categories: Category[], fetchFailed = false): XtreamBlockHealth => {
  const itemCount = categories.reduce((sum, c) => sum + c.channels.length, 0);
  if (itemCount > 0) {
    return { status: 'ok', itemCount };
  }
  // Blocco vuoto: dire *perché*. "Il server non ha elementi" era falso quando
  // la fetch era fallita (provider che tronca la risposta, vedi
  // internal/services/playlist/service.go) e mandava l'utente a cercare il
  // problema dalla parte sbagliata.
  return {
    status: fetchFailed ? 'error' : 'empty',
    itemCount,
    reason: fetchFailed
      ? 'Download del blocco non riuscito (risposta incompleta dal provider): i contenuti restano quelli dell’ultimo caricamento riuscito, se presente.'
      : 'Il server non ha restituito elementi per questo blocco.',
  };
};

/**
 * Converte il payload del backend Go in `XtreamContent`.
 *
 * Il backend Go non calcola un blocco `health`: lo deriviamo dai conteggi, così
 * il badge di salute catalogo e il riepilogo "Ultimo stato" in
 * `ProfileSettings` mostrano dati reali anche su desktop (dove prima
 * `catalogHealth` restava sempre `null`).
 */
export const normalizeGoPlaylist = (
  raw: GoFullPlaylist | null | undefined,
  creds: XtreamCredentials,
): XtreamContent => {
  const baseUrl = normalizeBaseUrl(creds.url);
  const live = normalizeBlock(raw?.live, 'live', baseUrl, creds);
  const vod = normalizeBlock(raw?.vod, 'movie', baseUrl, creds);
  const series = normalizeBlock(raw?.series, 'series', baseUrl, creds);
  const failedBlocks = raw?.failedBlocks ?? [];

  // Diagnostica esplicita: se un blocco risulta vuoto a valle (tab VOD/serie
  // senza contenuti), questo log distingue "il payload del backend era vuoto"
  // da "il mapping ha scartato dei canali" — distinzione che altrimenti
  // richiede di indovinare.
  const countChannels = (categories: Category[]): number =>
    categories.reduce((sum, c) => sum + c.channels.length, 0);
  console.info('[Xtream][GoPayload] normalizzazione completata', {
    live: { categories: live.length, channels: countChannels(live) },
    vod: { categories: vod.length, channels: countChannels(vod) },
    series: { categories: series.length, channels: countChannels(series) },
    raw: {
      liveCategories: raw?.live?.length ?? 0,
      vodCategories: raw?.vod?.length ?? 0,
      seriesCategories: raw?.series?.length ?? 0,
    },
  });

  return {
    live,
    vod,
    series,
    // `fetchedAt` non-zero: il payload viene da una fetch appena completata,
    // non da una cache legacy (quel sentinella è `0`, vedi `xtream.ts`).
    health: {
      live: deriveHealth(live, failedBlocks.includes('live')),
      vod: deriveHealth(vod, failedBlocks.includes('vod')),
      series: deriveHealth(series, failedBlocks.includes('series')),
      fetchedAt: Date.now(),
    },
  };
};
