/**
 * useNativeMpvEngine — engine player nativo Wails v3 (libmpv backend).
 *
 * Stato (plan rev. 7.1, Fase 6.5.3):
 *   - **Audio + control plane funzionanti**: Load/Play/Pause/Stop/Seek/
 *     SetVolume/SetMuted/SetSpeed/SetAid/SetSid/AddSub via binding TS
 *     (frontend/bindings/.../player/service.ts).
 *   - **Video rendering NON ancora implementato**: il backend cgo monta
 *     `vo=null` finché SPIKE-1 non conferma la pipeline render-API →
 *     canvas WebGL2 (4K@60, ≤14ms/frame). Il `<canvas>` esposto da questo
 *     hook resta vuoto — PiP e fullscreen gestiti dal frontend, ma frame
 *     decodificati non visualizzati. Per testing audio/control è già utile.
 *   - **State updates push-based**: dalla Fase 6.5.3 lo state arriva via
 *     evento Wails `player-state` (emesso dal subscriber pattern del
 *     `internal/services/player/events.go`). Un polling 1 s resta attivo
 *     come safety net per missed events (es. webview riattivata da
 *     suspend, runtime Wails non ancora pronto al mount).
 *
 * Comportamento error: se il binario è stato compilato senza `-tags mpv`,
 * il backend ritorna l'errore `errNotBuilt` ad ogni metodo. L'hook lo
 * propaga via `error` state per permettere alla UI di mostrare il banner
 * "Backend video non disponibile".
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Events as WailsEvents } from '@wailsio/runtime';
import * as PlayerService from '../bindings/github.com/AlfioSaitta/StreamAI-IPTV/internal/services/player/service';
import type { State as PlayerState, Track as PlayerTrack, HwAccelInfo as PlayerHwAccelInfo } from '../bindings/github.com/AlfioSaitta/StreamAI-IPTV/internal/services/player/models';

/**
 * Nome evento Wails emesso dal `PlayerService.emitState()` — deve
 * combaciare con la costante `EventName` in `internal/services/player/events.go`.
 */
const PLAYER_STATE_EVENT = 'player-state';

/**
 * Intervallo del polling di safety-net. Più lasco del vecchio 250 ms
 * push-only (la fonte primaria sono gli eventi): serve solo a recuperare
 * stato se la subscription viene persa (es. devtools, sleep/resume).
 */
const FALLBACK_POLL_INTERVAL_MS = 1000;
const RESIZE_DEBOUNCE_MS = 100;

/**
 * Payload dell'evento `player-state`. Allinea i campi pubblici della
 * `PlayerStateEvent` Go (events.go). Non c'è binding TS generato
 * perché Wails v3 non bind-a il `Subscribe(func)` method.
 */
interface PlayerStateEventPayload extends PlayerState {
  sourceUrl?: string;
  trackTitle?: string;
  trackArtist?: string;
  trackArtUrl?: string;
}

export interface UseNativeMpvEngineOptions {
  /** Auto-poll dello State (default: true). Disabilita per test E2E. */
  poll?: boolean;
}

export interface UseNativeMpvEngineResult {
  /** Snapshot più recente dello stato player (null finché non c'è stato un Load). */
  state: PlayerState | null;
  /** Elenco delle tracce audio/video/sottotitoli disponibili. */
  tracks: PlayerTrack[];
  /** Info sull'accelerazione hardware (hwdec-current, ecc). */
  hwInfo: PlayerHwAccelInfo | null;
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
  const [tracks, setTracks] = useState<PlayerTrack[]>([]);
  const [hwInfo, setHwInfo] = useState<PlayerHwAccelInfo | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const resizeTimerRef = useRef<number | null>(null);

  // Push-based state updates: il PlayerService Go fa fanout di un
  // `PlayerStateEvent` a ogni mutazione + watcher 1 s lazy. Sostituisce
  // il vecchio polling 250 ms (rev. 7.1, Fase 6.5.3 del plan).
  // Il fallback polling 1 s sotto resta come safety net.
  useEffect(() => {
    if (!poll) return;
    const off = WailsEvents.On(PLAYER_STATE_EVENT, (event: unknown) => {
      const data = (event as { data?: PlayerStateEventPayload } | null | undefined)?.data;
      if (data) {
        // Estrae solo i campi di `State` (i metadati track-level sono
        // consumati altrove via hook dedicato, qui ci interessa lo stato
        // di playback). Il cast funziona perché PlayerStateEvent embed-a
        // State direttamente in Go (JSON inline).
        setState({
          loaded: data.loaded,
          playing: data.playing,
          paused: data.paused,
          position: data.position,
          duration: data.duration,
          volume: data.volume,
          muted: data.muted,
          speed: data.speed,
          bitrateKbps: data.bitrateKbps,
        });
        setError(null);
      }
    });
    return () => {
      if (typeof off === 'function') off();
    };
  }, [poll]);

  // Fallback polling 1 s: cattura stato se per qualche motivo l'evento
  // push non arriva (runtime Wails non ancora pronto, suspend/resume
  // del DE, devtools che mette in pausa lo script). Frequenza bassa
  // perché la fonte primaria sono gli eventi push.
  useEffect(() => {
    if (!poll) return;
    let cancelled = false;
    const tick = async () => {
      const s = await callBackend(() => PlayerService.State(), setError);
      if (!cancelled && s) setState(s);
    };
    // Primo tick immediato per popolare lo state al mount (l'evento
    // potrebbe non arrivare se nessuno chiama Load/Play prima).
    void tick();
    const interval = window.setInterval(tick, FALLBACK_POLL_INTERVAL_MS);
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
  const play = useCallback(() => {
    setState(prev => prev ? { ...prev, playing: true, paused: false } : prev);
    return callBackend(() => PlayerService.Play(), setError).then(() => {});
  }, []);
  const pause = useCallback(() => {
    setState(prev => prev ? { ...prev, playing: false, paused: true } : prev);
    return callBackend(() => PlayerService.Pause(), setError).then(() => {});
  }, []);
  const stop = useCallback(() => {
    setState(null);
    return callBackend(() => PlayerService.Stop(), setError).then(() => {});
  }, []);
  const seek = useCallback(
    (s: number) => {
      setState(prev => prev ? { ...prev, position: s } : prev);
      return callBackend(() => PlayerService.Seek(s), setError).then(() => {});
    },
    [],
  );
  const setVolume = useCallback(
    (v: number) => {
      setState(prev => prev ? { ...prev, volume: v } : prev);
      return callBackend(() => PlayerService.SetVolume(v), setError).then(() => {});
    },
    [],
  );
  const setMuted = useCallback(
    (m: boolean) => {
      setState(prev => prev ? { ...prev, muted: m } : prev);
      return callBackend(() => PlayerService.SetMuted(m), setError).then(() => {});
    },
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

  const refreshTracks = useCallback(async () => {
    const t = await callBackend(() => PlayerService.Tracks(), setError);
    if (t) setTracks(t);
  }, []);

  const refreshHwInfo = useCallback(async () => {
    const h = await callBackend(() => PlayerService.HwAccelInfo(), setError);
    if (h) setHwInfo(h);
  }, []);

  const refresh = useCallback(async () => {
    const s = await callBackend(() => PlayerService.State(), setError);
    if (s) setState(s);
    await refreshTracks();
    await refreshHwInfo();
  }, [refreshTracks, refreshHwInfo]);

  return {
    state,
    tracks,
    hwInfo,
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

