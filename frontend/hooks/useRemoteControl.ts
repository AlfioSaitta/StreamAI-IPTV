// Bridge di controllo remoto per il player.
// Riceve i comandi inoltrati dal backend (companion app via mDNS/SSDP) e
// espone la trasmissione dello stato di riproduzione verso i client remoti.
// Extracted from components/VideoPlayerNew.tsx during refactor B.1.
//
// NB: la versione precedente era scritta contro l'API di video.js
// (`player.currentTime()`, `player.volume()`, `player.muted()`, ...). video.js
// è stato rimosso dal progetto (Stage B), quindi il hook parla ora con un
// adapter fornito dal player attivo — libmpv su desktop, player nativo su
// Android — restando indipendente dall'engine.

import { useEffect, useRef } from 'react';
import { platformService } from '../services/platformService';
import { host } from '../services/hostBridge';

export interface RemoteControlCommand {
  action: 'play' | 'pause' | 'seek' | 'skip' | 'volume' | 'volumeUp' | 'volumeDown' | 'mute';
  value?: number;
}

/**
 * Operazioni che un engine del player deve esporre per il controllo remoto.
 * I getter servono ai comandi relativi (volumeUp/volumeDown/mute), che devono
 * leggere lo stato corrente al momento del comando e non quello del render in
 * cui il listener è stato registrato.
 */
export interface RemotePlayerAdapter {
  play: () => void;
  pause: () => void;
  seek: (seconds: number) => void;
  skip: (deltaSeconds: number) => void;
  /** Imposta il volume in [0,1]; il player deriva da sé il mute quando è 0. */
  setVolume: (v: number) => void;
  toggleMute: () => void;
  getVolume: () => number;
}

export interface UseRemoteControlParams {
  player: RemotePlayerAdapter;
  broadcastStatus: (force?: boolean) => void;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

export function useRemoteControl({ player, broadcastStatus }: UseRemoteControlParams) {
  // Latest-ref: il listener viene registrato una volta per sessione e legge
  // sempre l'adapter e la callback correnti, senza ri-sottoscrivere gli eventi
  // a ogni render del player.
  const playerRef = useRef(player);
  const broadcastRef = useRef(broadcastStatus);
  useEffect(() => {
    playerRef.current = player;
    broadcastRef.current = broadcastStatus;
  });

  useEffect(() => {
    if (!platformService.isDesktop) return;
    const api = host;
    if (!api?.onRemoteControlCommand || !api?.onRequestStatusBroadcast) return;

    const unsubCommand = api.onRemoteControlCommand((raw: unknown) => {
      const command = (raw ?? {}) as RemoteControlCommand;
      const p = playerRef.current;

      switch (command.action) {
        case 'play':
          p.play();
          break;
        case 'pause':
          p.pause();
          break;
        case 'seek':
          if (typeof command.value === 'number') p.seek(command.value);
          break;
        case 'skip':
          if (typeof command.value === 'number') p.skip(command.value);
          break;
        case 'volume':
          // Non tocchiamo il mute qui: il player lo deriva già dal volume
          // (0 ⇒ muto), e un secondo set esplicito nella stessa sequenza
          // sincrona lavorerebbe su uno stato non ancora aggiornato.
          if (typeof command.value === 'number') p.setVolume(clamp01(command.value));
          break;
        case 'volumeUp':
          p.setVolume(clamp01(p.getVolume() + 0.1));
          break;
        case 'volumeDown':
          p.setVolume(clamp01(p.getVolume() - 0.1));
          break;
        case 'mute':
          p.toggleMute();
          break;
      }
    });

    const unsubRequest = api.onRequestStatusBroadcast(() => broadcastRef.current());

    return () => {
      unsubCommand();
      unsubRequest();
    };
  }, []);
}
