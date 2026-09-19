/**
 * useTrayBridge — Fase 6.5.3 del plan-go-wails-migration.
 *
 * Listener degli eventi emessi dal system tray (`internal/pkg/tray/tray.go`)
 * verso il frontend:
 *
 *   - `tray:play-pause` → toggle Play/Pause sul `PlayerService` in base allo
 *     stato corrente (se loaded && !paused → Pause(), altrimenti Play()).
 *   - `tray:pip-toggle` → invoca la callback `onPipToggle` passata
 *     dall'host (tipicamente `togglePiP` di `VideoPlayerNew.tsx`, che apre la
 *     finestra PiP dedicata — vedi `internal/services/pip`). Se non è
 *     fornita, log warning (no-op).
 *
 * Solo Wails: nei build web/Capacitor `@wailsio/runtime` non è
 * disponibile, quindi l'hook fa early-return e diventa no-op silenzioso.
 *
 * Uso tipico (App.tsx o VideoPlayerNew.tsx):
 *
 *   useTrayBridge({
 *     onPipToggle: () => togglePip(),
 *   });
 *
 * Il toggle Play/Pause è gestito direttamente dall'hook chiamando le
 * binding `PlayerService.Play/Pause` per minimizzare il churn nei call
 * site (vs. propagare una callback `onPlayPause` esterna).
 */

import { useEffect, useRef } from 'react';
import platformService from '../services/platformService';
import * as PlayerService from '../bindings/github.com/AlfioSaitta/StreamAI-IPTV/internal/services/player/service';

const TRAY_PLAY_PAUSE_EVENT = 'tray:play-pause';
const TRAY_PIP_TOGGLE_EVENT = 'tray:pip-toggle';

export interface UseTrayBridgeOptions {
  /**
   * Callback invocata su `tray:pip-toggle`. Se non fornita, l'evento
   * viene loggato come warning (il tray menu è registrato in main.go
   * ma il consumer PiP non è stato ancora mountato).
   */
  onPipToggle?: () => void;
  /**
   * Override del toggle Play/Pause. Se non fornita, l'hook usa il
   * comportamento di default: legge `PlayerService.State()` e chiama
   * `Play()` o `Pause()` di conseguenza. Override utile per testing
   * o per integrare con uno state machine esterno (es. cast remoto).
   */
  onPlayPause?: () => void;
}

export function useTrayBridge(opts: UseTrayBridgeOptions = {}): void {
  const { onPipToggle, onPlayPause } = opts;

  // Callback lette tramite ref: il chiamante le crea spesso inline, quindi
  // averle nelle deps faceva ripartire l'effetto a ogni render di App — con
  // teardown dei listener e un nuovo import dinamico di `@wailsio/runtime` ogni
  // volta. Un evento tray che arrivava nel gap teardown/re-registrazione andava
  // perso.
  const callbacksRef = useRef({ onPipToggle, onPlayPause });
  useEffect(() => {
    callbacksRef.current = { onPipToggle, onPlayPause };
  });

  useEffect(() => {
    if (!platformService.isWails) return;

    // Import dinamico per evitare di far esplodere il bundle web/Capacitor
    // dove `@wailsio/runtime` non è installato. Lo carichiamo lazily al
    // mount del componente.
    let cancelled = false;
    let offPlayPause: (() => void) | null = null;
    let offPipToggle: (() => void) | null = null;

    (async () => {
      try {
        const mod = await import('@wailsio/runtime');
        if (cancelled) return;
        const { Events } = mod;

        offPlayPause = Events.On(TRAY_PLAY_PAUSE_EVENT, () => {
          const override = callbacksRef.current.onPlayPause;
          if (override) {
            override();
            return;
          }
          // Default: toggle basato sullo stato corrente del player.
          void (async () => {
            try {
              const s = await PlayerService.State();
              if (s.loaded && !s.paused) {
                await PlayerService.Pause();
              } else {
                await PlayerService.Play();
              }
            } catch (err) {
              console.warn('[useTrayBridge] tray:play-pause toggle failed:', err);
            }
          })();
        }) as (() => void) | undefined ?? null;

        offPipToggle = Events.On(TRAY_PIP_TOGGLE_EVENT, () => {
          const handler = callbacksRef.current.onPipToggle;
          if (handler) {
            handler();
          } else {
            console.warn(
              '[useTrayBridge] tray:pip-toggle ricevuto ma nessun handler PiP registrato',
            );
          }
        }) as (() => void) | undefined ?? null;
      } catch (err) {
        console.warn('[useTrayBridge] @wailsio/runtime import failed:', err);
      }
    })();

    return () => {
      cancelled = true;
      if (typeof offPlayPause === 'function') offPlayPause();
      if (typeof offPipToggle === 'function') offPipToggle();
    };
  }, []);
}

export default useTrayBridge;

