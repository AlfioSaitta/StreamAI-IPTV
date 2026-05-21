import { useCallback, useEffect, useRef, useState } from 'react';

const DEFAULT_OVERLAY_WINDOW_SECONDS = 15; // when to show the prompt
const DEFAULT_COUNTDOWN_SECONDS = 10;      // user-visible countdown
const REARM_AFTER_SEEK_SECONDS = 30;       // if user seeks back past this many seconds from end, re-arm

interface UseAutoNextEpisodeOptions {
  enabled: boolean;
  /** True only when there's a meaningful "next" item to jump to. */
  hasNext: boolean;
  /** Current playback position in seconds. */
  currentTime: number;
  /** Total duration in seconds. `0` or non-finite values disable the hook. */
  duration: number;
  /** Live streams must never trigger auto-next. */
  isLive: boolean;
  /** Triggered when the countdown reaches zero or the user clicks "Play now". */
  onTrigger: () => void;
  /** Stable key to reset internal state when the playing item changes. */
  channelId?: string;
  /** Optional overrides (seconds). */
  windowSeconds?: number;
  countdownSeconds?: number;
}

export interface AutoNextState {
  /** Whether the overlay should be visible. */
  isVisible: boolean;
  /** Remaining seconds (integer, 0..countdownSeconds). */
  secondsLeft: number;
  /** Skip the countdown and jump immediately. */
  playNow: () => void;
  /** Dismiss the overlay; will not re-arm until item changes or user seeks back. */
  cancel: () => void;
}

/**
 * Episode auto-advance with a visible 10s countdown.
 *
 * Behaviour:
 * - Arms while `enabled && hasNext && !isLive && duration > 0`.
 * - When `duration - currentTime <= windowSeconds`, starts a real-time
 *   countdown that calls `onTrigger` at zero.
 * - "Play now" fires `onTrigger` immediately and disarms for this item.
 * - "Cancel" disarms until the user seeks back significantly (> 30s from
 *   the end) — useful if the credits aren't where you'd expect.
 * - State resets when `channelId` changes (new episode loaded).
 */
export function useAutoNextEpisode({
  enabled,
  hasNext,
  currentTime,
  duration,
  isLive,
  onTrigger,
  channelId,
  windowSeconds = DEFAULT_OVERLAY_WINDOW_SECONDS,
  countdownSeconds = DEFAULT_COUNTDOWN_SECONDS,
}: UseAutoNextEpisodeOptions): AutoNextState {
  const [isVisible, setIsVisible] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(countdownSeconds);
  const [dismissed, setDismissed] = useState(false);
  const [fired, setFired] = useState(false);
  const intervalRef = useRef<number | null>(null);
  const triggerRef = useRef(onTrigger);

  // Keep latest callback without resetting the interval.
  useEffect(() => { triggerRef.current = onTrigger; }, [onTrigger]);

  // Reset everything on channel change.
  useEffect(() => {
    setIsVisible(false);
    setSecondsLeft(countdownSeconds);
    setDismissed(false);
    setFired(false);
    if (intervalRef.current) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, [channelId, countdownSeconds]);

  // Compute remaining time and decide when to show the prompt.
  const remaining = Number.isFinite(duration) && duration > 0
    ? Math.max(0, duration - currentTime)
    : Infinity;

  // Re-arm if the user seeks back well before the end.
  useEffect(() => {
    if (dismissed && remaining > Math.max(REARM_AFTER_SEEK_SECONDS, windowSeconds + 5)) {
      setDismissed(false);
    }
  }, [remaining, dismissed, windowSeconds]);

  // Show / hide the overlay.
  useEffect(() => {
    if (!enabled || !hasNext || isLive || fired || dismissed) {
      setIsVisible(false);
      return;
    }
    if (!Number.isFinite(duration) || duration <= 0) {
      setIsVisible(false);
      return;
    }
    if (remaining <= windowSeconds) {
      if (!isVisible) {
        setIsVisible(true);
        setSecondsLeft(Math.min(countdownSeconds, Math.ceil(remaining)));
      }
    } else {
      setIsVisible(false);
    }
    // We intentionally exclude `isVisible` from deps to avoid loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, hasNext, isLive, fired, dismissed, duration, remaining, windowSeconds, countdownSeconds]);

  // Tick the countdown while visible.
  useEffect(() => {
    if (!isVisible || fired) {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }
    intervalRef.current = window.setInterval(() => {
      setSecondsLeft(s => Math.max(0, s - 1));
    }, 1000);
    return () => {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isVisible, fired]);

  // Trigger when the countdown completes.
  useEffect(() => {
    if (!isVisible || fired) return;
    if (secondsLeft <= 0) {
      setFired(true);
      setIsVisible(false);
      triggerRef.current?.();
    }
  }, [secondsLeft, isVisible, fired]);

  const playNow = useCallback(() => {
    if (fired) return;
    setFired(true);
    setIsVisible(false);
    triggerRef.current?.();
  }, [fired]);

  const cancel = useCallback(() => {
    setIsVisible(false);
    setDismissed(true);
  }, []);

  return { isVisible, secondsLeft, playNow, cancel };
}

