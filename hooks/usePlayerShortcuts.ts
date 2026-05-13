// Centralised keyboard shortcuts for the player.
// Implements the mapping documented in AGENTS.md / copilot-instructions.md.
// Extracted from components/VideoPlayerNew.tsx during refactor B.1.

import { useEffect } from 'react';
import type { Channel } from '../types';

export interface UsePlayerShortcutsHandlers {
  togglePlay: () => void;
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
  const {
    togglePlay,
    skip,
    setVolume,
    currentVolume,
    toggleMute,
    toggleFullscreen,
    openCast,
    togglePlaylist,
    onEscape,
    toggleEpg,
    toggleSleepTimer,
    toggleSubtitles,
  } = handlers;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;

      const key = e.key.toLowerCase();
      switch (key) {
        case ' ':
        case 'enter':
        case 'p':
          e.preventDefault();
          togglePlay();
          break;
        case 'arrowleft':
          e.preventDefault();
          if (!ctx.seekDisabled) skip(-10);
          break;
        case 'arrowright':
          e.preventDefault();
          if (!ctx.seekDisabled) skip(10);
          break;
        case 'arrowup':
          e.preventDefault();
          setVolume(Math.min(1, currentVolume + 0.1));
          break;
        case 'arrowdown':
          e.preventDefault();
          setVolume(Math.max(0, currentVolume - 0.1));
          break;
        case 'm':
          e.preventDefault();
          toggleMute();
          break;
        case 'f':
          e.preventDefault();
          toggleFullscreen();
          break;
        case 'c':
          e.preventDefault();
          openCast();
          break;
        case 'l':
          e.preventDefault();
          if (ctx.channel?.type === 'live' || ctx.channel?.type === 'series') {
            togglePlaylist();
          }
          break;
        case 'g':
          // Mini-EPG (Guide) — only for live channels.
          if (toggleEpg && ctx.channel?.type === 'live') {
            e.preventDefault();
            toggleEpg();
          }
          break;
        case 't':
          // Sleep timer menu (D.5).
          if (toggleSleepTimer) {
            e.preventDefault();
            toggleSleepTimer();
          }
          break;
        case 's':
          // Subtitles toggle / menu (D.4).
          if (toggleSubtitles) {
            e.preventDefault();
            toggleSubtitles();
          }
          break;
        case 'escape':
          e.preventDefault();
          onEscape();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay, skip, setVolume, currentVolume, toggleMute, toggleFullscreen, openCast, togglePlaylist, onEscape, toggleEpg, toggleSleepTimer, toggleSubtitles, ctx.channel, ctx.seekDisabled]);
}

