import { useCallback, useEffect, useRef, useState } from 'react';

export type SleepTimerPreset =
  | 'off'
  | '15min'
  | '30min'
  | '60min'
  | '90min'
  | 'endOfProgramme';

export interface SleepTimerState {
  /** Currently armed preset, `'off'` when no timer is running. */
  preset: SleepTimerPreset;
  /** Wall-clock timestamp (ms) when the timer will fire, or `null`. */
  expiresAt: number | null;
  /** Seconds remaining until fire (0 when not armed). Updated every second. */
  remainingSeconds: number;
  /** Apply a new preset. `'off'` cancels any running timer. */
  setPreset: (preset: SleepTimerPreset, options?: { endOfProgrammeAt?: number }) => void;
  /** Convenience: cancel the timer. */
  cancel: () => void;
}

interface UseSleepTimerOptions {
  /**
   * Called when the timer reaches zero. The implementer typically pauses
   * playback and may close the player. Volume fade-out is handled here
   * via the optional `fadeOut` helper.
   */
  onFire: () => void;
  /**
   * Optional volume fade-out window (seconds) applied before `onFire`.
   * Set to 0 to disable. Default 5.
   */
  fadeOutSeconds?: number;
  /** Read the current volume (0..1). Required if fade-out is enabled. */
  getVolume?: () => number;
  /** Set the current volume (0..1). Required if fade-out is enabled. */
  setVolume?: (v: number) => void;
}

const PRESET_MINUTES: Record<Exclude<SleepTimerPreset, 'off' | 'endOfProgramme'>, number> = {
  '15min': 15,
  '30min': 30,
  '60min': 60,
  '90min': 90,
};

/**
 * Sleep timer for the player (D.5).
 *
 * Internally drives:
 * - a precise `setTimeout` for the fire moment (survives tab visibility
 *   changes thanks to the absolute `expiresAt`);
 * - a 1Hz interval to refresh `remainingSeconds` for the UI countdown;
 * - an optional volume ramp-down during the last N seconds.
 *
 * The hook never pauses playback itself: it just calls `onFire`. This
 * keeps it decoupled from the player engine (web vs native).
 */
export function useSleepTimer({
  onFire,
  fadeOutSeconds = 5,
  getVolume,
  setVolume,
}: UseSleepTimerOptions): SleepTimerState {
  const [preset, setPresetState] = useState<SleepTimerPreset>('off');
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);

  const fireTimerRef = useRef<number | null>(null);
  const tickIntervalRef = useRef<number | null>(null);
  const fadeIntervalRef = useRef<number | null>(null);
  const preFadeVolumeRef = useRef<number | null>(null);

  const onFireRef = useRef(onFire);
  useEffect(() => { onFireRef.current = onFire; }, [onFire]);

  const clearAll = useCallback(() => {
    if (fireTimerRef.current !== null) {
      window.clearTimeout(fireTimerRef.current);
      fireTimerRef.current = null;
    }
    if (tickIntervalRef.current !== null) {
      window.clearInterval(tickIntervalRef.current);
      tickIntervalRef.current = null;
    }
    if (fadeIntervalRef.current !== null) {
      window.clearInterval(fadeIntervalRef.current);
      fadeIntervalRef.current = null;
    }
    // Restore volume if we were mid-fade.
    if (preFadeVolumeRef.current !== null && setVolume) {
      setVolume(preFadeVolumeRef.current);
    }
    preFadeVolumeRef.current = null;
  }, [setVolume]);

  const cancel = useCallback(() => {
    clearAll();
    setPresetState('off');
    setExpiresAt(null);
    setRemainingSeconds(0);
  }, [clearAll]);

  const setPreset = useCallback((nextPreset: SleepTimerPreset, options?: { endOfProgrammeAt?: number }) => {
    clearAll();

    if (nextPreset === 'off') {
      setPresetState('off');
      setExpiresAt(null);
      setRemainingSeconds(0);
      return;
    }

    let target: number;
    if (nextPreset === 'endOfProgramme') {
      if (!options?.endOfProgrammeAt || options.endOfProgrammeAt <= Date.now() + 5_000) {
        // Refuse silently — caller should hide this option if there's no
        // current programme or it's already nearly over.
        setPresetState('off');
        setExpiresAt(null);
        setRemainingSeconds(0);
        return;
      }
      target = options.endOfProgrammeAt;
    } else {
      const minutes = PRESET_MINUTES[nextPreset];
      target = Date.now() + minutes * 60_000;
    }

    setPresetState(nextPreset);
    setExpiresAt(target);
    setRemainingSeconds(Math.max(0, Math.round((target - Date.now()) / 1000)));
  }, [clearAll]);

  // Tick + fire scheduling.
  useEffect(() => {
    if (preset === 'off' || expiresAt === null) return;

    const remainingMs = expiresAt - Date.now();
    if (remainingMs <= 0) {
      onFireRef.current?.();
      setPresetState('off');
      setExpiresAt(null);
      setRemainingSeconds(0);
      return;
    }

    // 1Hz tick.
    tickIntervalRef.current = window.setInterval(() => {
      const left = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
      setRemainingSeconds(left);
    }, 1000);

    // Absolute fire timer.
    fireTimerRef.current = window.setTimeout(() => {
      onFireRef.current?.();
      setPresetState('off');
      setExpiresAt(null);
      setRemainingSeconds(0);
    }, remainingMs);

    // Volume fade-out: ramp the last `fadeOutSeconds` seconds to zero.
    if (fadeOutSeconds > 0 && getVolume && setVolume) {
      const fadeStartIn = remainingMs - fadeOutSeconds * 1000;
      if (fadeStartIn > 0) {
        const startFadeTimer = window.setTimeout(() => {
          const startVolume = getVolume();
          preFadeVolumeRef.current = startVolume;
          const steps = Math.max(1, fadeOutSeconds * 4); // 4 Hz fade
          let i = 0;
          fadeIntervalRef.current = window.setInterval(() => {
            i++;
            const ratio = Math.max(0, 1 - i / steps);
            setVolume(startVolume * ratio);
            if (i >= steps && fadeIntervalRef.current !== null) {
              window.clearInterval(fadeIntervalRef.current);
              fadeIntervalRef.current = null;
            }
          }, 250);
        }, fadeStartIn);
        return () => {
          window.clearTimeout(startFadeTimer);
          clearAll();
        };
      }
    }

    return () => clearAll();
  }, [preset, expiresAt, fadeOutSeconds, getVolume, setVolume, clearAll]);

  // Final cleanup on unmount.
  useEffect(() => () => clearAll(), [clearAll]);

  return { preset, expiresAt, remainingSeconds, setPreset, cancel };
}

/** Format seconds as `m:ss` (or `h:mm:ss` if needed). */
export function formatSleepRemaining(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

