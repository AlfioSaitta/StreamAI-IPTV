// Xtream health-check hook — F.3 IMPROVEMENT_PLAN_V2.
// Polls the provider every 30 minutes (configurable) and exposes account info
// + status so the UI can show an expiry/connections badge in ProfileSettings.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { XtreamAccountInfo, XtreamCredentials } from '../types';
import { getXtreamAccountInfo } from '../services/xtream';

export type XtreamHealthStatus = 'idle' | 'loading' | 'ok' | 'expiring' | 'expired' | 'error';

export interface XtreamHealthState {
  status: XtreamHealthStatus;
  info: XtreamAccountInfo | null;
  error: string | null;
  /** Days remaining until expiry; `null` for unlimited; `undefined` while loading. */
  daysToExpiry?: number | null;
}

const DEFAULT_INTERVAL_MS = 30 * 60 * 1000; // 30 min
const EXPIRING_THRESHOLD_DAYS = 7;

const computeDaysToExpiry = (expDate: string | null | undefined): number | null => {
  if (!expDate || expDate === '0' || expDate === 'null') return null;
  const epoch = Number(expDate);
  if (!Number.isFinite(epoch) || epoch <= 0) return null;
  const expiryMs = epoch * 1000;
  const diffMs = expiryMs - Date.now();
  return Math.floor(diffMs / (24 * 3600 * 1000));
};

export interface UseXtreamHealthCheckOptions {
  /** Polling interval in milliseconds. Defaults to 30 minutes. */
  intervalMs?: number;
  /** If false, no automatic polling — only manual `refresh()` calls work. */
  enabled?: boolean;
}

/**
 * Periodic health-check for an Xtream account.
 *
 * Returns a `state` snapshot + a manual `refresh()` callback. The hook is
 * inert when `creds` is null or `enabled` is false.
 */
export const useXtreamHealthCheck = (
  creds: XtreamCredentials | null,
  options: UseXtreamHealthCheckOptions = {}
): { state: XtreamHealthState; refresh: () => Promise<void> } => {
  const { intervalMs = DEFAULT_INTERVAL_MS, enabled = true } = options;

  const [state, setState] = useState<XtreamHealthState>({
    status: 'idle',
    info: null,
    error: null,
  });

  // Guard against state updates after unmount.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const runCheck = useCallback(async () => {
    if (!creds) {
      if (mountedRef.current) {
        setState({ status: 'idle', info: null, error: null });
      }
      return;
    }
    if (mountedRef.current) setState(s => ({ ...s, status: 'loading', error: null }));
    try {
      const info = await getXtreamAccountInfo(creds);
      const days = computeDaysToExpiry(info.expDate);
      let status: XtreamHealthStatus = 'ok';
      if (info.status && info.status.toLowerCase().includes('expired')) {
        status = 'expired';
      } else if (days !== null && days <= 0) {
        status = 'expired';
      } else if (days !== null && days <= EXPIRING_THRESHOLD_DAYS) {
        status = 'expiring';
      }
      if (mountedRef.current) {
        setState({ status, info, error: null, daysToExpiry: days });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (mountedRef.current) {
        setState(s => ({ ...s, status: 'error', error: message }));
      }
    }
  }, [creds]);

  // Auto-poll on mount + at interval. Restart when creds or interval change.
  useEffect(() => {
    if (!enabled || !creds) return;
    runCheck();
    const id = window.setInterval(runCheck, intervalMs);
    return () => window.clearInterval(id);
  }, [enabled, creds, intervalMs, runCheck]);

  return { state, refresh: runCheck };
};

