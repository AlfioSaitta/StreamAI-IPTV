// EPG service — D.1 IMPROVEMENT_PLAN_V2.
// Fetches XMLTV from Xtream (xmltv.php), indexes programmes by tvgId and
// caches the result in IndexedDB with a 6h TTL. Past programmes (> 24h ago)
// are purged on every load to keep memory bounded.

import type { EpgProgramme, XtreamCredentials } from '../../types.ts';
import { CacheService } from '../cacheService.ts';
import { parseXmltvAsync } from '../workers/index.ts';
import { proxyFetch } from '../proxyFetch.ts';

const EPG_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const PAST_PROGRAMME_RETENTION_MS = 24 * 60 * 60 * 1000; // keep 24h backlog
const FUTURE_PROGRAMME_HORIZON_MS = 14 * 24 * 60 * 60 * 1000; // drop > 14d ahead

const cacheKey = (creds: XtreamCredentials) =>
  `epg_${creds.url}_${creds.username}`;

const normalizeBaseUrl = (url: string): string => {
  let baseUrl = url.trim().replace(/\/$/, '');
  if (!/^https?:\/\//i.test(baseUrl)) baseUrl = `http://${baseUrl}`;
  return baseUrl;
};

/**
 * In-memory index built from a flat programme list. Maps `tvgId` to the
 * list of programmes for that channel, sorted by start time.
 */
export interface EpgIndex {
  byChannel: Map<string, EpgProgramme[]>;
  fetchedAt: number;
  /** Number of programmes after pruning. */
  totalProgrammes: number;
}

const pruneProgrammes = (programmes: EpgProgramme[]): EpgProgramme[] => {
  const now = Date.now();
  const minStart = now - PAST_PROGRAMME_RETENTION_MS;
  const maxStart = now + FUTURE_PROGRAMME_HORIZON_MS;
  return programmes.filter(p => p.stop >= minStart && p.start <= maxStart);
};

const buildIndex = (programmes: EpgProgramme[], fetchedAt: number): EpgIndex => {
  const byChannel = new Map<string, EpgProgramme[]>();
  for (const p of programmes) {
    if (!p.channelId) continue;
    const list = byChannel.get(p.channelId);
    if (list) list.push(p);
    else byChannel.set(p.channelId, [p]);
  }
  for (const list of byChannel.values()) {
    list.sort((a, b) => a.start - b.start);
  }
  return { byChannel, fetchedAt, totalProgrammes: programmes.length };
};

/**
 * Singleton EPG service. Each Xtream credential set is cached separately;
 * switching profile is automatic via `getEpgIndex(creds)`.
 */
class EpgServiceClass {
  private currentKey: string | null = null;
  private currentIndex: EpgIndex | null = null;
  private inFlight: Map<string, Promise<EpgIndex | null>> = new Map();

  /**
   * Returns the cached EPG index for the given credentials, fetching it from
   * the provider on a cache miss or when stale (> 6h).
   *
   * @param forceRefresh if true, ignore the cache and re-fetch.
   */
  async getEpgIndex(
    creds: XtreamCredentials | null,
    forceRefresh = false,
  ): Promise<EpgIndex | null> {
    if (!creds) {
      this.currentKey = null;
      this.currentIndex = null;
      return null;
    }
    const key = cacheKey(creds);

    // Same creds + fresh in-memory copy
    if (!forceRefresh && this.currentKey === key && this.currentIndex) {
      return this.currentIndex;
    }

    // Deduplicate concurrent calls for the same key
    const existing = this.inFlight.get(key);
    if (existing && !forceRefresh) return existing;

    const promise = this.loadInternal(creds, key, forceRefresh)
      .finally(() => {
        this.inFlight.delete(key);
      });
    this.inFlight.set(key, promise);
    return promise;
  }

  private async loadInternal(
    creds: XtreamCredentials,
    key: string,
    forceRefresh: boolean,
  ): Promise<EpgIndex | null> {
    // 1. Try cache first (skip if forceRefresh)
    if (!forceRefresh) {
      const cached = await CacheService.getApiData(key, { maxAgeMs: EPG_CACHE_TTL_MS });
      if (cached && Array.isArray(cached.programmes)) {
        const pruned = pruneProgrammes(cached.programmes as EpgProgramme[]);
        const index = buildIndex(pruned, Number(cached.fetchedAt) || Date.now());
        this.currentKey = key;
        this.currentIndex = index;
        return index;
      }
    }

    // 2. Fetch from provider
    try {
      const xml = await this.fetchXmltv(creds);
      // E.3 — parse + prune in worker se il payload è grande, altrimenti in
      // main thread. La facciata `parseXmltvAsync` decide in base alla soglia
      // e fa fallback sincrono in ambienti senza Worker (Node/tests).
      const { programmes } = await parseXmltvAsync(
        xml,
        PAST_PROGRAMME_RETENTION_MS,
        FUTURE_PROGRAMME_HORIZON_MS,
      );
      const fetchedAt = Date.now();
      const index = buildIndex(programmes, fetchedAt);

      // 3. Persist
      await CacheService.saveApiData(key, { programmes, fetchedAt });
      this.currentKey = key;
      this.currentIndex = index;
      return index;
    } catch (err) {
      console.warn('[EPG] fetch failed:', err);
      // Fall back to whatever stale data we have, even if older than TTL,
      // so the UI keeps showing something useful when the provider is down.
      const stale = await CacheService.getApiData(key);
      if (stale && Array.isArray(stale.programmes)) {
        const pruned = pruneProgrammes(stale.programmes as EpgProgramme[]);
        const index = buildIndex(pruned, Number(stale.fetchedAt) || 0);
        this.currentKey = key;
        this.currentIndex = index;
        return index;
      }
      return null;
    }
  }

  private async fetchXmltv(creds: XtreamCredentials): Promise<string> {
    const baseUrl = normalizeBaseUrl(creds.url);
    const url = `${baseUrl}/xmltv.php?username=${encodeURIComponent(creds.username)}&password=${encodeURIComponent(creds.password)}`;
    const res = await proxyFetch(url, {
      headers: {
        'Accept': 'application/xml, text/xml, */*',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching XMLTV`);
    return await res.text();
  }

  /**
   * Returns the full, time-sorted programme list for the given tvgId, or an
   * empty array if none is loaded. The returned array MUST be treated as
   * read-only by callers.
   */
  getProgrammesForChannel(tvgId: string | undefined): EpgProgramme[] {
    if (!tvgId || !this.currentIndex) return [];
    return this.currentIndex.byChannel.get(tvgId) ?? [];
  }

  /** Get the programme airing right now on the given tvgId, or null. */
  getCurrentProgramme(tvgId: string | undefined, now: number = Date.now()): EpgProgramme | null {
    if (!tvgId || !this.currentIndex) return null;
    const list = this.currentIndex.byChannel.get(tvgId);
    if (!list || list.length === 0) return null;
    // Binary search would be ideal; the per-channel list is small (a few hundred
    // entries) so linear scan is fine and zero-dep.
    for (const p of list) {
      if (p.start <= now && now < p.stop) return p;
      if (p.start > now) break; // sorted: future-only from here on
    }
    return null;
  }

  /** Get the next `count` programmes starting after `now`. */
  getUpcomingProgrammes(
    tvgId: string | undefined,
    count: number,
    now: number = Date.now(),
  ): EpgProgramme[] {
    if (!tvgId || !this.currentIndex) return [];
    const list = this.currentIndex.byChannel.get(tvgId);
    if (!list || list.length === 0) return [];
    const result: EpgProgramme[] = [];
    for (const p of list) {
      if (p.start <= now) continue;
      result.push(p);
      if (result.length >= count) break;
    }
    return result;
  }

  /** Returns true when an EPG index has been loaded in memory. */
  get isLoaded(): boolean {
    return this.currentIndex !== null;
  }

  /** Total programmes currently indexed (after pruning). */
  get size(): number {
    return this.currentIndex?.totalProgrammes ?? 0;
  }
}

export const EpgService = new EpgServiceClass();

