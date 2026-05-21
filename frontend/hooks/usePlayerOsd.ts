// On-Screen Display hook for the video player.
// Manages a transient overlay (icon + optional text) that auto-hides after `duration` ms.
// Extracted from components/VideoPlayerNew.tsx during refactor B.1.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { OsdState } from '../components/player/playerTypes';

const DEFAULT_OSD_TIMEOUT_MS = 2000;

export interface UsePlayerOsdResult {
  osd: OsdState;
  showOsd: (icon: ReactNode, text?: string) => void;
}

export function usePlayerOsd(timeoutMs: number = DEFAULT_OSD_TIMEOUT_MS): UsePlayerOsdResult {
  const [osd, setOsd] = useState<OsdState>({ icon: null, visible: false });
  const osdTimeoutRef = useRef<number | null>(null);

  const showOsd = useCallback((icon: ReactNode, text?: string) => {
    setOsd({ icon, text, visible: true });
    if (osdTimeoutRef.current) window.clearTimeout(osdTimeoutRef.current);
    osdTimeoutRef.current = window.setTimeout(() => {
      setOsd(prev => ({ ...prev, visible: false }));
    }, timeoutMs);
  }, [timeoutMs]);

  useEffect(() => () => {
    if (osdTimeoutRef.current) window.clearTimeout(osdTimeoutRef.current);
  }, []);

  return { osd, showOsd };
}

