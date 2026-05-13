import { useCallback, useEffect, useMemo, useRef } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { platformService } from '../services/platformService.ts';

/**
 * One layer in the application back-stack (B.4 — Routing dichiarativo).
 *
 * The model is intentionally flat: each "view" the user can open
 * (player, detail panes, modals, secondary tabs) declares whether it is
 * currently active and how to close itself. The hook iterates layers
 * top-down and closes the first active one when the user invokes Back.
 *
 * Centralising the order in one place removes the long-standing
 * duplication between the keyboard Esc handler and the Android hardware
 * Back button handler in App.tsx, and gives us a single source of truth
 * for deep-link reconstruction (P8.1, future).
 */
export interface BackStackLayer {
  /** Stable identifier — also used as future deep-link path segment. */
  id: string;
  /** Whether this layer is currently mounted/visible. */
  isOpen: boolean;
  /** Imperative close handler. Will be invoked when Back resolves here. */
  onClose: () => void;
  /**
   * If true, the layer "absorbs" the Esc key without closing itself:
   * the chain stops at this layer but `onClose` is NOT invoked. Used
   * for the video player, which has its own internal Esc handling
   * (PiP exit, OSD dismiss, …). Defaults to `false`.
   */
  skipEsc?: boolean;
}

export interface UseBackStackOptions {
  /**
   * Fallback when no layer absorbed the Back action. On Android this is
   * usually `CapacitorApp.exitApp`. Has no effect for the keyboard Esc
   * handler (we don't want Esc to close the whole app on desktop).
   */
  onEmpty?: () => void;
  /**
   * When `true`, the keyboard Esc listener is registered. Defaults to
   * `true`. Set to `false` if you want to drive Back manually.
   */
  bindEscKey?: boolean;
  /**
   * When `true`, the Android hardware Back button listener is registered
   * (only effective when running under Capacitor). Defaults to `true`.
   */
  bindAndroidBack?: boolean;
}

/**
 * Source that triggered a Back action. Some layers (e.g. the video
 * player) behave differently for the two: Esc is handled internally,
 * while the Android Back button must close the player.
 */
export type BackSource = 'esc' | 'androidBack' | 'manual';

export interface BackStackApi {
  /**
   * Run the back-stack resolution. Returns `true` if a layer absorbed
   * the action (either by closing or by `skipEsc`), `false` if no layer
   * was open and `onEmpty` was invoked instead.
   */
  back: (source?: BackSource) => boolean;
  /** Returns the id of the topmost open layer, or null. */
  topId: string | null;
  /** Returns the array of currently open layer ids, top-down. */
  openIds: string[];
}

/**
 * useBackStack — declarative back-stack handler for orthogonal modal
 * flags. Pass the layers in the order they should be closed (top-most
 * first). The hook is safe against re-renders: the latest layer array
 * is always read from a ref, so callers don't need to memoize handlers.
 *
 * Example:
 * ```tsx
 * useBackStack([
 *   { id: 'player', isOpen: !!currentChannel, onClose: () => setCurrentChannel(null), skipEsc: true },
 *   { id: 'movieDetail', isOpen: !!selectedMovie, onClose: () => setSelectedMovie(null) },
 *   { id: 'home', isOpen: activeTab !== 'home', onClose: () => setActiveTab('home') },
 * ], { onEmpty: () => CapacitorApp.exitApp() });
 * ```
 */
export function useBackStack(
  layers: BackStackLayer[],
  options: UseBackStackOptions = {}
): BackStackApi {
  const { onEmpty, bindEscKey = true, bindAndroidBack = true } = options;

  // Always read the latest layers from a ref so consumers can rebuild the
  // array on every render without re-binding our event listeners.
  const layersRef = useRef(layers);
  layersRef.current = layers;
  const onEmptyRef = useRef(onEmpty);
  onEmptyRef.current = onEmpty;

  const back = useCallback((source: BackSource = 'manual'): boolean => {
    for (const layer of layersRef.current) {
      if (!layer.isOpen) continue;
      // Layers marked `skipEsc` block the chain for Esc but don't close.
      // For Android Back / manual we always close them.
      if (source === 'esc' && layer.skipEsc) return true;
      try {
        layer.onClose();
      } catch (err) {
        console.error(`[useBackStack] onClose for layer '${layer.id}' threw:`, err);
      }
      return true;
    }
    onEmptyRef.current?.();
    return false;
  }, []);

  // Keyboard Esc.
  useEffect(() => {
    if (!bindEscKey) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Don't hijack Esc while the user is typing in an input/textarea
      // (forms have their own validation/close semantics).
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
      const handled = back('esc');
      if (handled) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [back, bindEscKey]);

  // Android hardware Back button.
  useEffect(() => {
    if (!bindAndroidBack || !platformService.isNative) return;
    const handlePromise = CapacitorApp.addListener('backButton', () => {
      back('androidBack');
    });
    return () => {
      handlePromise.then(handle => handle.remove());
    };
  }, [back, bindAndroidBack]);

  // Cheap derived state for diagnostics / future deep-link plumbing.
  const openIds = useMemo(() => layers.filter(l => l.isOpen).map(l => l.id), [layers]);
  const topId = openIds[0] ?? null;

  return { back, topId, openIds };
}

export default useBackStack;

