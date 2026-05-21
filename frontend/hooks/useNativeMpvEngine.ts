/**
 * useNativeMpvEngine — engine player nativo Wails v3 (libmpv backend).
 *
 * Stato (plan rev. 6, Fase 6.1 — pre-SPIKE):
 *   - **Audio + control plane funzionanti**: Load/Play/Pause/Stop/Seek/
 *     SetVolume/SetMuted/SetSpeed/SetAid/SetSid/AddSub via binding TS
 *     (frontend/bindings/.../player/service.ts).
 *   - **Video rendering NON ancora implementato**: il backend cgo monta
 *     `vo=null` finché SPIKE-1 non conferma la pipeline render-API →
 *     canvas WebGL2 (4K@60, ≤14ms/frame). Il `<canvas>` esposto da questo
 *     hook resta vuoto — PiP e fullscreen gestiti dal frontend, ma frame
 *     decodificati non visualizzati. Per testing audio/control è già utile.
 *   - **Polling stato**: lo State() è polled ogni 250ms per UI binding.
 *     Sarà rimpiazzato da `wailsevents.Emit("player-state", ...)` push-based
 *     quando il backend cgo aggiunge l'event loop mpv (Fase 6.1 step 2).
 *
 * Comportamento error: se il binario è stato compilato senza `-tags mpv`,
 * il backend ritorna l'errore `errNotBuilt` ad ogni metodo. L'hook lo
 * propaga via `error` state per permettere alla UI di mostrare il banner
 * "Backend video non disponibile".
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import * as PlayerService from '../bindings/github.com/AlfioSaitta/StreamAI-IPTV/internal/services/player/service';
import type { State as PlayerState } from '../bindings/github.com/AlfioSaitta/StreamAI-IPTV/internal/services/player/models';

const POLL_INTERVAL_MS = 250;
const RESIZE_DEBOUNCE_MS = 100;

export interface UseNativeMpvEngineOptions {
  /** Auto-poll dello State (default: true). Disabilita per test E2E. */
  poll?: boolean;
}

export interface UseNativeMpvEngineResult {
  /** Snapshot più recente dello stato player (null finché non c'è stato un Load). */
  state: PlayerState | null;
  /** Ultimo errore propagato da una call al backend (null = no error). */
  error: Error | null;
  /** Carica uno stream. Headers HTTP custom opzionali. */
  load: (url: string, headers?: Record<string, string>) => Promise<void>;
  play: () => Promise<void>;
  pause: () => Promise<void>;
  stop: () => Promise<void>;
  seek: (seconds: number) => Promise<void>;
  setVolume: (v: number) => Promise<void>;
  setMuted: (m: boolean) => Promise<void>;
  setSpeed: (speed: number) => Promise<void>;
  setAid: (id: number) => Promise<void>;
  setSid: (id: number) => Promise<void>;
  addSub: (path: string) => Promise<void>;
  /** Comunica al backend la dimensione del canvas (debounced 100ms). */
  resize: (width: number, height: number) => void;
  /** Rinfresca State() on-demand (oltre al polling). */
  refresh: () => Promise<void>;
}

/**
 * Wrapper helper: esegue una chiamata al PlayerService catturando errori
 * cgo `errNotBuilt` e altri runtime fail. Aggiorna `setError` se non null.
 */
function callBackend<T>(
  fn: () => Promise<T>,
  setError: (err: Error | null) => void,
): Promise<T | undefined> {
  return fn().then(
    (v) => {
      setError(null);
      return v;
    },
    (err) => {
      const e = err instanceof Error ? err : new Error(String(err));
      console.warn('[useNativeMpvEngine] backend call failed:', e.message);
      setError(e);
      return undefined;
    },
  );
}

export function useNativeMpvEngine(opts: UseNativeMpvEngineOptions = {}): UseNativeMpvEngineResult {
  const { poll = true } = opts;
  const [state, setState] = useState<PlayerState | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const resizeTimerRef = useRef<number | null>(null);

  // Polling State() — sostituirà gli eventi push quando il backend
  // cgo aggiungerà `mpv_wait_event` → `wailsevents.Emit("player-state")`.
  useEffect(() => {
    if (!poll) return;
    let cancelled = false;
    const tick = async () => {
      const s = await callBackend(() => PlayerService.State(), setError);
      if (!cancelled && s) setState(s);
    };
    void tick();
    const interval = window.setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [poll]);

  const load = useCallback(
    async (url: string, headers?: Record<string, string>) => {
      await callBackend(() => PlayerService.Load(url, headers ?? {}), setError);
    },
    [],
  );
  const play = useCallback(() => callBackend(() => PlayerService.Play(), setError).then(() => {}), []);
  const pause = useCallback(() => callBackend(() => PlayerService.Pause(), setError).then(() => {}), []);
  const stop = useCallback(() => callBackend(() => PlayerService.Stop(), setError).then(() => {}), []);
  const seek = useCallback(
    (s: number) => callBackend(() => PlayerService.Seek(s), setError).then(() => {}),
    [],
  );
  const setVolume = useCallback(
    (v: number) => callBackend(() => PlayerService.SetVolume(v), setError).then(() => {}),
    [],
  );
  const setMuted = useCallback(
    (m: boolean) => callBackend(() => PlayerService.SetMuted(m), setError).then(() => {}),
    [],
  );
  const setSpeed = useCallback(
    (s: number) => callBackend(() => PlayerService.SetSpeed(s), setError).then(() => {}),
    [],
  );
  const setAid = useCallback(
    (id: number) => callBackend(() => PlayerService.SetAid(id), setError).then(() => {}),
    [],
  );
  const setSid = useCallback(
    (id: number) => callBackend(() => PlayerService.SetSid(id), setError).then(() => {}),
    [],
  );
  const addSub = useCallback(
    (path: string) => callBackend(() => PlayerService.AddSub(path), setError).then(() => {}),
    [],
  );

  const resize = useCallback((width: number, height: number) => {
    if (resizeTimerRef.current !== null) {
      window.clearTimeout(resizeTimerRef.current);
    }
    resizeTimerRef.current = window.setTimeout(() => {
      void callBackend(() => PlayerService.Resize(width, height), setError);
      resizeTimerRef.current = null;
    }, RESIZE_DEBOUNCE_MS);
  }, []);

  const refresh = useCallback(async () => {
    const s = await callBackend(() => PlayerService.State(), setError);
    if (s) setState(s);
  }, []);

  return {
    state,
    error,
    load,
    play,
    pause,
    stop,
    seek,
    setVolume,
    setMuted,
    setSpeed,
    setAid,
    setSid,
    addSub,
    resize,
    refresh,
  };
}

