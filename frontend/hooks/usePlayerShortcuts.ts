// Centralised keyboard shortcuts for the player.
// Implements the mapping documented in AGENTS.md / copilot-instructions.md.
// Extracted from components/VideoPlayerNew.tsx during refactor B.1.

import { useEffect, useRef } from 'react';
import type { Channel } from '../types';

export interface UsePlayerShortcutsHandlers {
  togglePlay: () => void;
  /**
   * Toggle Picture-in-Picture (tasto `P`).
   *
   * Nota storica: `P` era mappato su Play/Pausa, che però ha già `Spazio` e
   * `Invio`; il PiP non aveva alcuna scorciatoia. La mappatura è stata quindi
   * riallineata a quanto documentato nella sezione Picture-in-Picture di
   * AGENTS.md.
   */
  togglePip?: () => void;
  skip: (seconds: number) => void;
  setVolume: (next: number) => void;
  currentVolume: number;
  toggleMute: () => void;
  toggleFullscreen: () => void;
  openCast: () => void;
  togglePlaylist: () => void;
  onEscape: () => void;
  /** Optional: toggle Mini-EPG overlay (key 'g'), only fires for Live channels. */
  toggleEpg?: () => void;
  /** Optional: toggle Sleep timer menu (key 't'). D.5. */
  toggleSleepTimer?: () => void;
  /** Optional: toggle subtitle visibility / open subtitle menu (key 's'). D.4. */
  toggleSubtitles?: () => void;
}

export interface UsePlayerShortcutsContext {
  channel: Channel | null;
  /** When true, ←/→ keyboard seek shortcuts are no-ops (URG-1 L3). */
  seekDisabled?: boolean;
}

export function usePlayerShortcuts(handlers: UsePlayerShortcutsHandlers, ctx: UsePlayerShortcutsContext) {
  // Il listener viene registrato UNA volta e legge handler e contesto correnti
  // da un ref aggiornato a ogni render.
  //
  // Prima l'effetto dipendeva da tutte le handler, che il chiamante crea inline:
  // durante la riproduzione il player renderizza piu' volte al secondo, quindi
  // il listener globale veniva rimosso e ri-aggiunto alla stessa frequenza. Un
  // tasto premuto nella finestra fra `removeEventListener` e
  // `addEventListener` non veniva gestito (e perdeva il `preventDefault`).
  const latestRef = useRef({ handlers, ctx });
  useEffect(() => {
    latestRef.current = { handlers, ctx };
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const { handlers: h, ctx: c } = latestRef.current;
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;

      const key = e.key.toLowerCase();
      switch (key) {
        case ' ':
        case 'enter':
          e.preventDefault();
          h.togglePlay();
          break;
        case 'p':
          e.preventDefault();
          // Se il consumer non fornisce il PiP (es. player native Android, dove
          // il PiP è gestito dal plugin), il tasto resta senza effetto invece
          // di ricadere su Play/Pausa: una scorciatoia che cambia significato
          // in base alla piattaforma è peggio di una scorciatoia assente.
          h.togglePip?.();
          break;
        case 'arrowleft':
          e.preventDefault();
          if (!c.seekDisabled) h.skip(-10);
          break;
        case 'arrowright':
          e.preventDefault();
          if (!c.seekDisabled) h.skip(10);
          break;
        case 'arrowup':
          e.preventDefault();
          h.setVolume(Math.min(1, h.currentVolume + 0.1));
          break;
        case 'arrowdown':
          e.preventDefault();
          h.setVolume(Math.max(0, h.currentVolume - 0.1));
          break;
        case 'm':
          e.preventDefault();
          h.toggleMute();
          break;
        case 'f':
          e.preventDefault();
          h.toggleFullscreen();
          break;
        case 'c':
          e.preventDefault();
          h.openCast();
          break;
        case 'l':
          e.preventDefault();
          if (c.channel?.type === 'live' || c.channel?.type === 'series') {
            h.togglePlaylist();
          }
          break;
        case 'g':
          // Mini-EPG (Guide) — only for live channels.
          if (h.toggleEpg && c.channel?.type === 'live') {
            e.preventDefault();
            h.toggleEpg();
          }
          break;
        case 't':
          // Sleep timer menu (D.5).
          if (h.toggleSleepTimer) {
            e.preventDefault();
            h.toggleSleepTimer();
          }
          break;
        case 's':
          // Subtitles toggle / menu (D.4).
          if (h.toggleSubtitles) {
            e.preventDefault();
            h.toggleSubtitles();
          }
          break;
        case 'escape':
          e.preventDefault();
          h.onEscape();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}

