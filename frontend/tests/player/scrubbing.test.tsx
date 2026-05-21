// @vitest-environment jsdom
// Tests for useInteractiveTimeline scrubbing state machine — URG-1 L1.
// Verifies that a drag of N pointermove events emits EXACTLY ONE onSeek call
// at the released position, eliminating the seek-storm.

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useInteractiveTimeline } from '../../hooks/useInteractiveTimeline';

const DURATION = 600; // 10 minutes

const mountWithTimelineEl = () => {
  const onSeek = vi.fn();
  const { result } = renderHook(() =>
    useInteractiveTimeline({ duration: DURATION, onSeek }),
  );

  // Attach a real DOM element to the ref so getBoundingClientRect works.
  const div = document.createElement('div');
  Object.defineProperty(div, 'getBoundingClientRect', {
    value: () => ({ left: 0, top: 0, width: 1000, height: 4, right: 1000, bottom: 4, x: 0, y: 0, toJSON: () => ({}) }),
  });
  (div as any).setPointerCapture = vi.fn();
  (div as any).releasePointerCapture = vi.fn();
  // useRef.current is read-only via API, but writable via the ref object.
  (result.current.timelineRef as any).current = div;

  return { result, onSeek, div };
};

const makePointerEvent = (type: string, clientX: number, pointerId = 1): PointerEvent => {
  // jsdom doesn't fully implement PointerEvent; fall back to MouseEvent with extras.
  const ev = new MouseEvent(type, { clientX, button: 0, bubbles: true }) as MouseEvent & {
    pointerId?: number;
    pointerType?: string;
  };
  (ev as any).pointerId = pointerId;
  (ev as any).pointerType = 'mouse';
  return ev as unknown as PointerEvent;
};

describe('useInteractiveTimeline — scrubbing', () => {
  afterEach(() => vi.restoreAllMocks());

  it('emits exactly ONE onSeek for a drag with many pointermove events', () => {
    const { result, onSeek } = mountWithTimelineEl();

    // Pointer down at x=100 (10% → 60s)
    act(() => {
      result.current.onPointerDown({
        pointerId: 1,
        clientX: 100,
        button: 0,
        pointerType: 'mouse',
        preventDefault: () => undefined,
      } as any);
    });

    expect(result.current.isScrubbing).toBe(true);
    expect(onSeek).not.toHaveBeenCalled();

    // 20 pointermove events along the bar
    for (let x = 100; x <= 700; x += 30) {
      act(() => { window.dispatchEvent(makePointerEvent('pointermove', x)); });
    }

    // Still no seek emitted mid-drag
    expect(onSeek).not.toHaveBeenCalled();

    // Pointer up at x=700 (70% → 420s)
    act(() => { window.dispatchEvent(makePointerEvent('pointerup', 700)); });

    // EXACTLY ONE seek, at the released position
    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek.mock.calls[0][0]).toBeCloseTo(420, 0);
    expect(result.current.isScrubbing).toBe(false);
  });

  it('emits ONE onSeek for a simple click (no move)', () => {
    const { result, onSeek } = mountWithTimelineEl();

    act(() => {
      result.current.onPointerDown({
        pointerId: 1,
        clientX: 500, // 50% → 300s
        button: 0,
        pointerType: 'mouse',
        preventDefault: () => undefined,
      } as any);
    });
    act(() => { window.dispatchEvent(makePointerEvent('pointerup', 500)); });

    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek.mock.calls[0][0]).toBeCloseTo(300, 0);
  });

  it('does NOT emit onSeek when the pointer interaction is cancelled', () => {
    const { result, onSeek } = mountWithTimelineEl();

    act(() => {
      result.current.onPointerDown({
        pointerId: 1, clientX: 200, button: 0, pointerType: 'mouse',
        preventDefault: () => undefined,
      } as any);
    });
    act(() => { window.dispatchEvent(makePointerEvent('pointermove', 400)); });
    act(() => { window.dispatchEvent(makePointerEvent('pointercancel', 400)); });

    expect(onSeek).not.toHaveBeenCalled();
    expect(result.current.isScrubbing).toBe(false);
  });

  it('ignores right-click pointerdown', () => {
    const { result, onSeek } = mountWithTimelineEl();

    act(() => {
      result.current.onPointerDown({
        pointerId: 1, clientX: 500, button: 2, pointerType: 'mouse',
        preventDefault: () => undefined,
      } as any);
    });

    expect(result.current.isScrubbing).toBe(false);
    expect(onSeek).not.toHaveBeenCalled();
  });

  it('clamps seek time to [0, duration]', () => {
    const { result, onSeek } = mountWithTimelineEl();

    act(() => {
      result.current.onPointerDown({
        pointerId: 1, clientX: -50, button: 0, pointerType: 'mouse',
        preventDefault: () => undefined,
      } as any);
    });
    act(() => { window.dispatchEvent(makePointerEvent('pointerup', -50)); });

    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek.mock.calls[0][0]).toBe(0);
  });
});

