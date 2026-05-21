// MediaSession API integration: metadata + action handlers + position state.
// Used by VideoPlayerNew so the OS-level media controls work on Desktop/Android.
// Extracted from components/VideoPlayerNew.tsx during refactor B.1.

import { useEffect } from 'react';
import type { Channel } from '../types';

export interface UsePlayerMediaSessionParams {
  channel: Channel | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  togglePlay: () => void;
  skip: (seconds: number) => void;
  onPrev?: () => void;
  onNext?: () => void;
}

export function usePlayerMediaSession({
  channel,
  isPlaying,
  currentTime,
  duration,
  togglePlay,
  skip,
  onPrev,
  onNext,
}: UsePlayerMediaSessionParams) {
  // Metadata + action handlers
  useEffect(() => {
    if (!('mediaSession' in navigator) || !channel) return;

    navigator.mediaSession.metadata = new window.MediaMetadata({
      title: channel.cleanName || channel.name,
      artist: channel.group || 'StreamAI IPTV',
      artwork: [
        { src: channel.logo || 'icon.png', sizes: '512x512', type: 'image/png' },
      ],
    });

    const actionHandlers: [MediaSessionAction, () => void][] = [
      ['play', togglePlay],
      ['pause', togglePlay],
      ['previoustrack', () => onPrev?.()],
      ['nexttrack', () => onNext?.()],
      ['seekbackward', () => skip(-10)],
      ['seekforward', () => skip(10)],
    ];

    for (const [action, handler] of actionHandlers) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // Some platforms don't support all actions; ignore.
      }
    }

    return () => {
      actionHandlers.forEach(([action]) => {
        try { navigator.mediaSession.setActionHandler(action, null); } catch { /* noop */ }
      });
    };
  }, [channel, togglePlay, skip, onPrev, onNext]);

  // Position state
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    try {
      if (duration > 0) {
        navigator.mediaSession.setPositionState({ duration, playbackRate: 1, position: currentTime });
      }
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    } catch (error) {
      console.warn('Errore aggiornamento MediaSession position state:', error);
    }
  }, [currentTime, duration, isPlaying]);
}

