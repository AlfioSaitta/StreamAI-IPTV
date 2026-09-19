import { Channel } from '../types.ts';
import { MetadataService } from './metadata.ts';

const RATE_LIMIT_DELAY_MS = 250; // 4 requests per second

/**
 * Sotto questa soglia si assume un cache-hit di `MetadataService` (la sua cache
 * è in memoria): non c'è nessuna chiamata di rete da rate-limitare, quindi non
 * ha senso attendere.
 */
const CACHE_HIT_THRESHOLD_MS = 50;

/**
 * Chiavi già processate in questa sessione.
 *
 * `activeProfile` cambia identità a ogni aggiornamento di history, watchlist o
 * progress, e l'effetto in `App.tsx` richiama questo servizio a ogni cambio:
 * senza un registro ogni passata ripartiva da `itemsToEnrich[0]` rifacendo da
 * capo l'intero catalogo — su 40k titoli, con il delay di rate limit, sono ore
 * di loop continuo per lo più su cache-hit.
 */
const processedKeys = new Set<string>();

let isEnriching = false;
let cancelRequested = false;

/** Chiave stabile di un titolo, indipendente dall'id del canale. */
const keyOf = (channel: Channel): string =>
  channel.tmdbId
    ? `tmdb:${channel.tmdbId}`
    : `${channel.type ?? ''}:${channel.name.toLowerCase()}`;

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
    cancelRequested = false;
    console.log('[TMDB Enricher] Starting background enrichment...');

    const itemsToEnrich = channels
      .filter(c => c.type === 'movie' || c.type === 'series')
      .filter(c => !processedKeys.has(keyOf(c)));

    if (itemsToEnrich.length === 0) {
      isEnriching = false;
      console.log('[TMDB Enricher] Nothing new to enrich.');
      return;
    }

    let enrichedCount = 0;

    for (let i = 0; i < itemsToEnrich.length; i++) {
      if (cancelRequested) {
        console.info('[TMDB Enricher] Cancellato su richiesta.');
        break;
      }

      const channel = itemsToEnrich[i];
      const startedAt = performance.now();

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

      // Segnato come processato anche con esito negativo: un titolo assente da
      // TMDB resterebbe altrimenti in coda per sempre, e ogni passata lo
      // ritenterebbe pagando il delay di rate limit.
      processedKeys.add(keyOf(channel));

      onProgress(i + 1, itemsToEnrich.length);

      // Rate limit solo sulle chiamate di rete reali.
      if (performance.now() - startedAt < CACHE_HIT_THRESHOLD_MS) continue;
      await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY_MS));
    }

    isEnriching = false;
    console.log(`[TMDB Enricher] Finished. Enriched ${enrichedCount} new items.`);
  },

  /** Annulla la passata in corso (l'iterazione corrente termina, poi esce). */
  cancel: () => {
    cancelRequested = true;
  },

  isEnriching: () => isEnriching,

  /** Azzera il registro di sessione. Usato dai test. */
  resetSessionCache: () => {
    processedKeys.clear();
  },
};
