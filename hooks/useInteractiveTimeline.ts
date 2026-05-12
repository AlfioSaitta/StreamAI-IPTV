// Interactive timeline hook: manages hover-time / hover-position state for the
// scrubber with ghost bar + tooltip. Pure UI: no playback side effects.
// Extracted from components/VideoPlayerNew.tsx during refactor B.1.

import { useCallback, useRef, useState } from 'react';

export interface UseInteractiveTimelineResult {
  timelineRef: React.RefObject<HTMLDivElement>;
  hoverTime: number | null;
  hoverPos: number;
  onMouseMove: (e: React.MouseEvent<HTMLDivElement>) => void;
  onMouseLeave: () => void;
}

export function useInteractiveTimeline(duration: number): UseInteractiveTimelineResult {
  const timelineRef = useRef<HTMLDivElement>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverPos, setHoverPos] = useState<number>(0);

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!timelineRef.current || duration <= 0) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const offsetX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const percentage = offsetX / rect.width;
    setHoverPos(percentage * 100);
    setHoverTime(percentage * duration);
  }, [duration]);

  const onMouseLeave = useCallback(() => setHoverTime(null), []);

  return { timelineRef, hoverTime, hoverPos, onMouseMove, onMouseLeave };
}

