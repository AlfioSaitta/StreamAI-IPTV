// Electron remote-control bridge for the player.
// Listens to IPC commands forwarded by the main process (mDNS/SSDP companion app)
// and exposes a way to broadcast playback status back to remote clients.
// Extracted from components/VideoPlayerNew.tsx during refactor B.1.

import { useEffect } from 'react';
import type Player from 'video.js/dist/types/player';
import { platformService } from '../services/platformService';
import { host } from '../services/hostBridge';

export interface RemoteControlCommand {
  action: 'play' | 'pause' | 'seek' | 'skip' | 'volume' | 'volumeUp' | 'volumeDown' | 'mute';
  value?: number;
}

export interface UseRemoteControlParams {
  playerRef: React.RefObject<Player | null>;
  setVolume: (v: number) => void;
  setIsMuted: (m: boolean) => void;
  broadcastStatus: (force?: boolean) => void;
}

export function useRemoteControl({ playerRef, setVolume, setIsMuted, broadcastStatus }: UseRemoteControlParams) {
  useEffect(() => {
    if (!platformService.isDesktop) return;
    const api = host;
    if (!api?.onRemoteControlCommand || !api.onRequestStatusBroadcast) return;

    const unsubCommand = api.onRemoteControlCommand((raw: unknown) => {
      const command = (raw ?? {}) as RemoteControlCommand;
      const player = playerRef.current;
      if (!player || player.isDisposed()) return;

      switch (command.action) {
        case 'play':
          player.play();
          break;
        case 'pause':
          player.pause();
          break;
        case 'seek':
          if (typeof command.value === 'number') player.currentTime(command.value);
          break;
        case 'skip':
          if (typeof command.value === 'number') player.currentTime((player.currentTime() || 0) + command.value);
          break;
        case 'volume':
          if (typeof command.value === 'number') {
            const newVol = Math.max(0, Math.min(1, command.value));
            player.volume(newVol);
            setVolume(newVol);
            if (newVol > 0) { player.muted(false); setIsMuted(false); }
            else { player.muted(true); setIsMuted(true); }
          }
          break;
        case 'volumeUp': {
          const upVol = Math.min(1, (player.volume() || 0) + 0.1);
          player.volume(upVol);
          setVolume(upVol);
          if (upVol > 0) { player.muted(false); setIsMuted(false); }
          break;
        }
        case 'volumeDown': {
          const downVol = Math.max(0, (player.volume() || 0) - 0.1);
          player.volume(downVol);
          setVolume(downVol);
          if (downVol === 0) { player.muted(true); setIsMuted(true); }
          break;
        }
        case 'mute': {
          const newMuted = !player.muted();
          player.muted(newMuted);
          setIsMuted(newMuted);
          if (!newMuted && player.volume() === 0) {
            player.volume(0.5);
            setVolume(0.5);
          }
          break;
        }
      }
    });

    const unsubRequest = api.onRequestStatusBroadcast(() => broadcastStatus());

    return () => {
      unsubCommand();
      unsubRequest();
    };
  }, [playerRef, setVolume, setIsMuted, broadcastStatus]);
}

