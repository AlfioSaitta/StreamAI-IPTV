import { useEffect } from 'react';
import { Events as WailsEvents } from '@wailsio/runtime';
import { platformService } from '../services/platformService';
import { Channel } from '../types';
import * as PowerSaveService from '../bindings/github.com/AlfioSaitta/StreamAI-IPTV/internal/services/powersave/service';
import * as MediaKeysService from '../bindings/github.com/AlfioSaitta/StreamAI-IPTV/internal/services/mediakeys/service';

export interface PlayerSystemIntegrationParams {
  channel: Channel | null;
  isPlaying: boolean;
  isPaused: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  togglePlay: () => void;
  play: () => void;
  pause: () => void;
  stop: () => void;
  seek: (seconds: number) => void;
  onPrev?: () => void;
  onNext?: () => void;
}

/**
 * usePlayerSystemIntegration — Hook che orchestra le integrazioni di sistema OS (Fase 7-bis).
 * Gestisce:
 *   - Power Save Blocker (Inhibitor)
 *   - Media Keys (MPRIS2 / SMTC) via Wails Service
 *   - Callback dai tasti hardware/OS
 */
export function usePlayerSystemIntegration({
  channel,
  isPlaying,
  isPaused,
  currentTime,
  duration,
  volume,
  togglePlay,
  play,
  pause,
  stop,
  seek,
  onPrev,
  onNext,
}: PlayerSystemIntegrationParams) {
  const isWails = platformService.isWails;

  // 1. POWER SAVE BLOCKER (Display Sleep Prevention)
  useEffect(() => {
    if (!isWails) return;

    if (isPlaying) {
      const reason = channel ? `StreamAI: ${channel.cleanName || channel.name}` : 'StreamAI Playback';
      void PowerSaveService.Start(reason);
    } else {
      void PowerSaveService.Stop();
    }

    return () => {
      if (isWails) void PowerSaveService.Stop();
    };
  }, [isWails, isPlaying, channel]);

  // 2. MEDIA KEYS (Aggiornamento Stato e Metadati)
  useEffect(() => {
    if (!isWails || !channel) return;

    // Aggiorna stato di riproduzione
    const status = isPlaying ? 'playing' : (isPaused ? 'paused' : 'stopped');
    void MediaKeysService.SetPlaybackStatus(status);

    // Aggiorna metadati
    void MediaKeysService.SetMetadata({
      title: channel.cleanName || channel.name,
      artist: channel.group || 'StreamAI IPTV',
      album: channel.type === 'movie' ? 'Film' : (channel.type === 'series' ? 'Serie TV' : 'Live TV'),
      artUrl: channel.logo || '',
      durationSeconds: duration,
      trackId: channel.id,
    });

    // Aggiorna volume
    void MediaKeysService.SetVolume(volume);

    // Aggiorna capabilities
    void MediaKeysService.SetCapabilities({
      canPlay: true,
      canPause: true,
      canGoNext: !!onNext,
      canGoPrevious: !!onPrev,
      canSeek: duration > 0,
      canControl: true,
    });
  }, [isWails, channel, isPlaying, isPaused, duration, volume, onNext, onPrev]);

  // 3. MEDIA KEYS EVENTS (Listener eventi hardware/OS)
  useEffect(() => {
    if (!isWails) return;

    const EVENT_NAME = 'media-key';
    const off = WailsEvents.On(EVENT_NAME, (event: any) => {
      const payload = event?.data;
      if (!payload) return;

      console.log('[usePlayerSystemIntegration] Received media key event:', payload.action);

      switch (payload.action) {
        case 'play':
          play();
          break;
        case 'pause':
          pause();
          break;
        case 'playpause':
          togglePlay();
          break;
        case 'stop':
          stop();
          break;
        case 'next':
          onNext?.();
          break;
        case 'previous':
          onPrev?.();
          break;
        case 'seek':
          if (payload.offsetSeconds) {
            seek(currentTime + payload.offsetSeconds);
          }
          break;
        case 'setposition':
          if (payload.positionSeconds !== undefined) {
            seek(payload.positionSeconds);
          }
          break;
        case 'raise':
          // Wails v3 gestisce Raise internamente se configurato o via binding specifico
          // Per ora focus sulla finestra gestito dal backend single-instance.
          break;
        case 'quit':
          // App gestirà il quit via lifecycle
          break;
      }
    });

    return () => {
      if (typeof off === 'function') off();
    };
  }, [isWails, play, pause, togglePlay, stop, onNext, onPrev, seek, currentTime]);
}
