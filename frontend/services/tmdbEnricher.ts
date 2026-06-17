import { Channel } from '../types.ts';
import { MetadataService } from './metadata.ts';

const RATE_LIMIT_DELAY_MS = 250; // 4 requests per second

let isEnriching = false;

export const TmdbEnricherService = {
  startBackgroundEnrichment: async (
    channels: Channel[],
    apiKey: string,
    language: string,
    onProgress: (progress: number, total: number) => void
  ) => {
    if (isEnriching) {
      console.warn('[TMDB Enricher] Enrichment process is already running.');
      return;
    }
    isEnriching = true;
    console.log('[TMDB Enricher] Starting background enrichment...');

    const itemsToEnrich = channels.filter(c => c.type === 'movie' || c.type === 'series');
    let enrichedCount = 0;

    for (let i = 0; i < itemsToEnrich.length; i++) {
      const channel = itemsToEnrich[i];
      try {
        // This will fetch and cache the data inside MetadataService
        let tmdbData = null;
        if (channel.tmdbId) {
            tmdbData = await MetadataService.getDetails(channel.tmdbId, channel.type as 'movie' | 'series', language, apiKey);
        } else {
            tmdbData = await MetadataService.getDetailsByTitle(
              channel.name,
              channel.type as 'movie' | 'series',
              channel.year,
              language,
              apiKey
            );
        }
        if (tmdbData) {
          enrichedCount++;
        }
      } catch (error) {
        console.error(`[TMDB Enricher] Failed to enrich ${channel.name}:`, error);
      }
      
      onProgress(i + 1, itemsToEnrich.length);

      // Rate limit to avoid TMDB API limits
      await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY_MS));
    }

    isEnriching = false;
    console.log(`[TMDB Enricher] Finished. Enriched ${enrichedCount} new items.`);
  },

  isEnriching: () => isEnriching,
};