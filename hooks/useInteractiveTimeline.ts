// Interactive timeline hook: manages hover-time / hover-position state for the
// scrubber with ghost bar + tooltip, plus a custom pointer-based scrubbing
// state machine that emits a SINGLE seek on pointer-up (instead of one seek
// per pixel like a native <input type="range"> would do).
//
// Extracted from components/VideoPlayerNew.tsx during refactor B.1 and
// extended on 2026-05-13 for URG-1 (seek-storm fix).

import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseInteractiveTimelineOptions {
  duration: number;
  /**
   * Called once when the user finalizes a seek (pointer up after a drag, or a
   * simple click on the bar). Implementation is expected to call the player's
   * `currentTime(time)` exactly once. The hook NEVER calls this during the
   * drag — only at the end.
   */
  onSeek: (time: number) => void;
}

export interface UseInteractiveTimelineResult {
  timelineRef: React.RefObject<HTMLDivElement>;
  /** Hover-only (mouse hovering without pressing). null when no hover. */
  hoverTime: number | null;
  /** Hover-only horizontal position in percent (0-100). */
  hoverPos: number;
  /** True while the user is actively dragging (pointer down). */
  isScrubbing: boolean;
  /** Position (in seconds) the user is targeting during the drag. */
  scrubTime: number | null;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onMouseMove: (e: React.MouseEvent<HTMLDivElement>) => void;
  onMouseLeave: () => void;
}

const clampPercent = (offsetX: number, width: number): number => {
  if (width <= 0) return 0;
  return Math.max(0, Math.min(offsetX, width)) / width;
};

export function useInteractiveTimeline(
  optionsOrDuration: UseInteractiveTimelineOptions | number,
  legacyOnSeek?: (time: number) => void,
): UseInteractiveTimelineResult {
  // Backward-compat: previous signature was `useInteractiveTimeline(duration)`.
  const options: UseInteractiveTimelineOptions = typeof optionsOrDuration === 'number'
    ? { duration: optionsOrDuration, onSeek: legacyOnSeek ?? (() => undefined) }
    : optionsOrDuration;
  const { duration, onSeek } = options;

  const timelineRef = useRef<HTMLDivElement>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverPos, setHoverPos] = useState<number>(0);
  const [isScrubbing, setIsScrubbing] = useState<boolean>(false);
  const [scrubTime, setScrubTime] = useState<number | null>(null);

  const scrubbingRef = useRef<{ pointerId: number; lastTime: number } | null>(null);

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!timelineRef.current || duration <= 0) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const percentage = clampPercent(e.clientX - rect.left, rect.width);
    setHoverPos(percentage * 100);
    setHoverTime(percentage * duration);
  }, [duration]);

  const onMouseLeave = useCallback(() => {
    // Don't clear hover while actively scrubbing — the ghost bar should keep
    // tracking the pointer even when it leaves the timeline element.
    if (scrubbingRef.current) return;
    setHoverTime(null);
  }, []);

  const finalizeSeek = useCallback((time: number) => {
    if (!isFinite(time)) return;
    const clamped = Math.max(0, Math.min(time, duration));
    onSeek(clamped);
  }, [duration, onSeek]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!timelineRef.current || duration <= 0) return;
    // Only react to primary button / touch / pen — ignore right-click etc.
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const percentage = clampPercent(e.clientX - rect.left, rect.width);
    const time = percentage * duration;
    scrubbingRef.current = { pointerId: e.pointerId, lastTime: time };
    setIsScrubbing(true);
    setScrubTime(time);
    setHoverPos(percentage * 100);
    setHoverTime(time);
    // Capture so we keep receiving move/up even if the pointer leaves the bar.
    try { timelineRef.current.setPointerCapture(e.pointerId); } catch { /* noop */ }
    e.preventDefault();
  }, [duration]);

  // Global pointermove/up listeners while scrubbing. We attach them on window
  // so the drag continues smoothly even if the pointer exits the timeline div.
  useEffect(() => {
    if (!isScrubbing) return;

    const handleMove = (e: PointerEvent) => {
      const state = scrubbingRef.current;
      if (!state || state.pointerId !== e.pointerId) return;
      if (!timelineRef.current || duration <= 0) return;
      const rect = timelineRef.current.getBoundingClientRect();
      const percentage = clampPercent(e.clientX - rect.left, rect.width);
      const time = percentage * duration;
      state.lastTime = time;
      setScrubTime(time);
      setHoverPos(percentage * 100);
      setHoverTime(time);
    };

    const handleUp = (e: PointerEvent) => {
      const state = scrubbingRef.current;
      if (!state || state.pointerId !== e.pointerId) return;
      const finalTime = state.lastTime;
      scrubbingRef.current = null;
      setIsScrubbing(false);
      setScrubTime(null);
      try { timelineRef.current?.releasePointerCapture(e.pointerId); } catch { /* noop */ }
      // Single seek at the released position — no seek-storm.
      finalizeSeek(finalTime);
    };

    const handleCancel = (e: PointerEvent) => {
      const state = scrubbingRef.current;
      if (!state || state.pointerId !== e.pointerId) return;
      scrubbingRef.current = null;
      setIsScrubbing(false);
      setScrubTime(null);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleCancel);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleCancel);
    };
  }, [isScrubbing, duration, finalizeSeek]);

  return {
    timelineRef,
    hoverTime,
    hoverPos,
    isScrubbing,
    scrubTime,
    onPointerDown,
    onMouseMove,
    onMouseLeave,
  };
}
