// MediaSession API integration: metadata + action handlers + position state.
// Used by VideoPlayerNew so the OS-level media controls work on Desktop/Android.
// Extracted from components/VideoPlayerNew.tsx during refactor B.1.

import { useEffect, useRef } from 'react';
import { platformService } from '../services/platformService';
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
  // Disabilita navigator.mediaSession su Wails in favore dell'integrazione nativa Go (Fase 7-bis)
  const isWails = platformService.isWails;

  // Callback lette tramite ref al momento dell'invocazione.
  //
  // L'effetto che registra gli handler non deve dipendere dalla loro identita':
  // `skip`, in VideoPlayerNew, ha `currentTime` fra le proprie dipendenze e
  // cambia quindi a ogni tick (~1-4 volte al secondo). Con le callback nelle
  // deps, l'effetto azzerava e ri-registrava 6 azioni MediaSession alla stessa
  // frequenza: un comando proveniente dai controlli OS/headset che arrivava nel
  // gap di deregistrazione veniva perso.
  const callbacksRef = useRef({ togglePlay, skip, onPrev, onNext });
  useEffect(() => {
    callbacksRef.current = { togglePlay, skip, onPrev, onNext };
  });

  // Metadata + action handlers
  useEffect(() => {
    if (isWails || !('mediaSession' in navigator) || !channel) return;

    navigator.mediaSession.metadata = new window.MediaMetadata({
      title: channel.cleanName || channel.name,
      artist: channel.group || 'StreamAI IPTV',
      artwork: [
        { src: channel.logo || 'icon.png', sizes: '512x512', type: 'image/png' },
      ],
    });

    const actionHandlers: [MediaSessionAction, () => void][] = [
      ['play', () => callbacksRef.current.togglePlay()],
      ['pause', () => callbacksRef.current.togglePlay()],
      ['previoustrack', () => callbacksRef.current.onPrev?.()],
      ['nexttrack', () => callbacksRef.current.onNext?.()],
      ['seekbackward', () => callbacksRef.current.skip(-10)],
      ['seekforward', () => callbacksRef.current.skip(10)],
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
  }, [channel, isWails]);

  // Position state
  useEffect(() => {
    if (isWails || !('mediaSession' in navigator)) return;
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

