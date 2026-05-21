// React adapter for EpgService — D.1 IMPROVEMENT_PLAN_V2.
// Loads the XMLTV index for the active Xtream profile and exposes the
// current/upcoming programmes for a given tvgId. The list is re-evaluated
// every minute so the "current" programme stays accurate.

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { EpgProgramme, XtreamCredentials } from '../types';
import { EpgService, type EpgIndex } from '../services/epg';

export interface UseEpgResult {
  /** True while the initial XMLTV fetch/parse is running. */
  isLoading: boolean;
  /** Last fetch error, if any. */
  error: string | null;
  /** True when an EPG index is available in memory. */
  isLoaded: boolean;
  /** Current programme for the requested tvgId, or null. */
  current: EpgProgramme | null;
  /** The next `upcomingCount` programmes (default 3). */
  upcoming: EpgProgramme[];
  /** Manually re-fetch from the provider, bypassing cache. */
  refresh: () => Promise<void>;
}

export interface UseEpgOptions {
  /** Channel tvgId to slice the index for. */
  tvgId?: string;
  /** Number of upcoming programmes to return (default 3). */
  upcomingCount?: number;
  /** When false the hook stays idle (no fetch). Defaults to true. */
  enabled?: boolean;
}

/**
 * Returns the EPG slice for a channel, keeping it fresh through:
 *   1. Initial load from cache or provider on mount.
 *   2. A 60-second tick that re-evaluates the "current" programme.
 *
 * Safe to call with `tvgId` undefined — it will simply return empty data.
 */
export const useEpg = (
  creds: XtreamCredentials | null,
  { tvgId, upcomingCount = 3, enabled = true }: UseEpgOptions = {},
): UseEpgResult => {
  const [index, setIndex] = useState<EpgIndex | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Tick every 60s so `current`/`upcoming` recompute as time passes.
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled || !creds) {
      setIndex(null);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    EpgService.getEpgIndex(creds)
      .then((res) => {
        if (cancelled) return;
        setIndex(res);
        if (!res) setError('Nessun dato EPG disponibile dal provider');
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, creds]);

  // 60s tick — only when we actually have an index loaded (else useless).
  useEffect(() => {
    if (!index) return;
    const id = window.setInterval(() => setTick(t => t + 1), 60_000);
    return () => window.clearInterval(id);
  }, [index]);

  const refresh = useCallback(async () => {
    if (!creds) return;
    setIsLoading(true);
    setError(null);
    try {
      const fresh = await EpgService.getEpgIndex(creds, true);
      setIndex(fresh);
      if (!fresh) setError('Nessun dato EPG disponibile dal provider');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [creds]);

  const { current, upcoming } = useMemo(() => {
    if (!index || !tvgId) {
      return { current: null as EpgProgramme | null, upcoming: [] as EpgProgramme[] };
    }
    const now = Date.now();
    return {
      current: EpgService.getCurrentProgramme(tvgId, now),
      upcoming: EpgService.getUpcomingProgrammes(tvgId, upcomingCount, now),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, tvgId, upcomingCount, tick]);

  return {
    isLoading,
    error,
    isLoaded: !!index,
    current,
    upcoming,
    refresh,
  };
};

