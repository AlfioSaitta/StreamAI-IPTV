import { Category, Channel } from '../types.ts';
import { cleanTitle } from './metadataUtils.ts';
import { indexCategories, searchIndexedChannels, IndexedChannel } from './catalogIndex.ts';

// Web Worker per il parsing, l'indicizzazione e la ricerca del catalogo IPTV.
// Mantiene lo stato (il catalogo indicizzato) per ricerche veloci off-thread.

let indexedCatalog: Array<Category & { channels: IndexedChannel[] }> = [];
let allChannels: IndexedChannel[] = [];

self.onmessage = (e: MessageEvent) => {
  const { action } = e.data;

  // --- Azione: Indicizzazione Iniziale ---
  if (action === 'index') {
    const { categories, streams, type, baseUrl, credentials } = e.data;
    
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
          streamUrl = `${baseUrl}/live/${credentials.username}/${credentials.password}/${stream.stream_id}.ts`;
        } else if (type === 'movie') {
          const ext = stream.container_extension || 'mp4';
          streamUrl = `${baseUrl}/movie/${credentials.username}/${credentials.password}/${stream.stream_id}.${ext}`;
        } else if (type === 'series') {
          streamUrl = '';
        }

        let year = undefined;
        if (stream.releaseDate) year = stream.releaseDate.split('-')[0];
        else if (stream.year) year = stream.year;
        else if (stream.added && !isNaN(Number(stream.added))) {
          year = new Date(Number(stream.added) * 1000).getFullYear().toString();
        }

        let addedAt: number | undefined;
        if (stream.added && !isNaN(Number(stream.added))) {
          const secs = Number(stream.added);
          addedAt = secs > 1e12 ? secs : secs * 1000;
        }

        const rawName = stream.name || '';
        const cleanName = cleanTitle(rawName);

        const logo: string | undefined =
          stream.stream_icon ||
          stream.cover ||
          stream.cover_big ||
          stream.movie_image ||
          undefined;

        const tmdbIdValue = stream.tmdb_id || stream.tmdb || stream.custom_sid;
        const parsedTmdbId = tmdbIdValue && !isNaN(Number(tmdbIdValue)) ? Number(tmdbIdValue) : undefined;

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
          tmdbId: parsedTmdbId,
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
    const result = type === 'live'
      ? filtered
      : filtered.sort((a, b) => a.name.localeCompare(b.name));

    indexedCatalog = indexCategories(result);
    allChannels = indexedCatalog.flatMap(c => c.channels);

    self.postMessage({ result: indexedCatalog, action: 'index' });
    return;
  }

  // --- Azione: Ricerca ---
  if (action === 'search') {
    const { query, limit, id } = e.data;
    const searchResults = searchIndexedChannels(allChannels, query, limit);
    self.postMessage({ result: searchResults, action: 'search', query, id });
    return;
  }
};