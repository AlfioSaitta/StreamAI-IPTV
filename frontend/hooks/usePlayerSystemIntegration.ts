import { useEffect, useRef } from 'react';
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

  // 2a. MEDIA KEYS (stato, metadati, capabilities)
  //
  // Il VOLUME è deliberatamente escluso da questo effetto: era nelle stesse
  // dipendenze, quindi ogni singola variazione di volume rifaceva anche
  // SetPlaybackStatus + SetMetadata + SetCapabilities — cioè 3 chiamate IPC e
  // D-Bus inutili per ogni passo dello slider (decine per un singolo drag).
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

    // Aggiorna capabilities
    void MediaKeysService.SetCapabilities({
      canPlay: true,
      canPause: true,
      canGoNext: !!onNext,
      canGoPrevious: !!onPrev,
      canSeek: duration > 0,
      canControl: true,
    });
  }, [isWails, channel, isPlaying, isPaused, duration, onNext, onPrev]);

  // 2b. MEDIA KEYS (solo volume)
  useEffect(() => {
    if (!isWails || !channel) return;
    void MediaKeysService.SetVolume(volume);
  }, [isWails, channel, volume]);

  // 3. MEDIA KEYS EVENTS (Listener eventi hardware/OS)
  //
  // Il listener viene registrato UNA volta per sessione: l'handler reale è
  // tenuto in un ref aggiornato a ogni render. In precedenza l'effect dipendeva
  // da `currentTime`, che durante il playback cambia ~1-4 volte/s, quindi il
  // listener veniva rimosso e ri-registrato alla stessa frequenza: un tasto
  // multimediale premuto nella finestra tra `off()` e `On()` veniva perso, e
  // ogni variazione di volume generava decine di IPC ridondanti.
  const mediaKeyHandlerRef = useRef<(payload: { action?: string; offsetSeconds?: number; positionSeconds?: number }) => void>(
    () => undefined,
  );

  useEffect(() => {
    if (!isWails) return;

    const EVENT_NAME = 'media-key';
    const off = WailsEvents.On(EVENT_NAME, (event: any) => {
      const payload = event?.data;
      if (!payload) return;

      console.log('[usePlayerSystemIntegration] Received media key event:', payload.action);
      mediaKeyHandlerRef.current(payload);
    });

    return () => {
      if (typeof off === 'function') off();
    };
  }, [isWails]);

  // Mantiene l'handler al passo con stato e callback correnti senza
  // ri-registrare il listener (sempre eseguito dopo ogni render).
  useEffect(() => {
    mediaKeyHandlerRef.current = (payload) => {
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
    };
  });
}
