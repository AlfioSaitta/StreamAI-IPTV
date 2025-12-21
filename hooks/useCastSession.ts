import { useState, useEffect, useCallback, useRef } from 'react';
import { DiscoveredDevice } from '../services/deviceDiscovery';
import { platformService } from '../services/platformService';

interface CastStatus {
  connected: boolean;
  playerState: 'IDLE' | 'BUFFERING' | 'PLAYING' | 'PAUSED';
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  mediaTitle: string;
  deviceName?: string;
  deviceIp?: string;
  error?: string;
}

interface UseCastSessionReturn {
  // Connection
  isConnected: boolean;
  isConnecting: boolean;
  device: DiscoveredDevice | null;
  connect: (device: DiscoveredDevice) => Promise<boolean>;
  disconnect: () => Promise<void>;
  
  // Media
  loadMedia: (url: string, title: string) => Promise<boolean>;
  
  // Playback controls
  play: () => void;
  pause: () => void;
  stop: () => void;
  seek: (time: number) => void;
  setVolume: (level: number) => void;
  setMuted: (muted: boolean) => void;
  
  // Status
  status: CastStatus;
  error: string | null;
}

const initialStatus: CastStatus = {
  connected: false,
  playerState: 'IDLE',
  currentTime: 0,
  duration: 0,
  volume: 1,
  muted: false,
  mediaTitle: '',
};

export function useCastSession(): UseCastSessionReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [device, setDevice] = useState<DiscoveredDevice | null>(null);
  const [status, setStatus] = useState<CastStatus>(initialStatus);
  const [error, setError] = useState<string | null>(null);
  
  // Refs
  const statusUnsubscribe = useRef<(() => void) | null>(null);
  const pollIntervalRef = useRef<number | null>(null);
  const isConnectedRef = useRef(false);

  // Electron API check
  const electronAPI = (window as any).electronAPI;
  const isElectron = platformService.isElectron && !!electronAPI;

  // Sync ref
  useEffect(() => {
    isConnectedRef.current = isConnected;
  }, [isConnected]);

  // --- ELECTRON IMPLEMENTATION ---
  
  // Subscribe to status updates (Electron)
  useEffect(() => {
    if (!isElectron) return;

    statusUnsubscribe.current = electronAPI.onCastStatus((newStatus: CastStatus) => {
      setStatus(prev => ({
        ...prev,
        ...newStatus,
        deviceName: device?.name,
        deviceIp: device?.ip,
      }));
      setIsConnected(newStatus.connected);
    });

    return () => {
      if (statusUnsubscribe.current) {
        statusUnsubscribe.current();
      }
    };
  }, [isElectron, device]);

  // Poll for status (Electron)
  useEffect(() => {
    if (!isElectron || !isConnected) {
      if (pollIntervalRef.current) {
        window.clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      return;
    }

    const fetchStatus = async () => {
      try {
        const result = await electronAPI.castControl({ action: 'status' });
        if (result.status) {
          setStatus(prev => ({
            ...prev,
            ...result.status,
            deviceName: device?.name,
            deviceIp: device?.ip,
          }));
          setIsConnected(result.status.connected !== false);
        }
      } catch (err) {
        console.log('[useCastSession] Status poll error:', err);
      }
    };

    fetchStatus();
    pollIntervalRef.current = window.setInterval(fetchStatus, 1500);

    return () => {
      if (pollIntervalRef.current) {
        window.clearInterval(pollIntervalRef.current);
      }
    };
  }, [isElectron, isConnected, device]);

  // --- ACTIONS ---

  const connect = useCallback(async (targetDevice: DiscoveredDevice): Promise<boolean> => {
    setIsConnecting(true);
    setError(null);

    try {
      if (isElectron) {
        // Electron Native Cast
        console.log('[useCastSession] Connecting via Electron to:', targetDevice.ip);
        const result = await electronAPI.castConnect({ ip: targetDevice.ip });
        
        if (result.success) {
          setDevice(targetDevice);
          setIsConnected(true);
          isConnectedRef.current = true;
          setStatus(prev => ({
            ...prev,
            connected: true,
            deviceName: targetDevice.name,
            deviceIp: targetDevice.ip,
          }));
          return true;
        } else {
          setError(result.error || 'Connessione fallita');
          return false;
        }
      } else {
        // TODO: Implementare Capacitor Cast Plugin per Android/iOS
        console.warn('[useCastSession] Casting not supported on this platform yet');
        setError('Casting non disponibile su questa piattaforma');
        return false;
      }
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setIsConnecting(false);
    }
  }, [isElectron]);

  const disconnect = useCallback(async () => {
    console.log('[useCastSession] Disconnecting...');
    isConnectedRef.current = false;

    try {
      if (isElectron) {
        await electronAPI.castDisconnect();
      }
    } catch {}

    setIsConnected(false);
    setDevice(null);
    setStatus(initialStatus);
    setError(null);
  }, [isElectron]);

  const loadMedia = useCallback(async (url: string, title: string): Promise<boolean> => {
    if (!isConnectedRef.current) return false;

    try {
      if (isElectron) {
        const result = await electronAPI.castLoad({ mediaUrl: url, title });
        if (result.success && result.status) {
          setStatus(prev => ({ ...prev, ...result.status }));
          return true;
        } else {
          setError(result.error || 'Caricamento fallito');
          return false;
        }
      }
      return false;
    } catch (err) {
      setError((err as Error).message);
      return false;
    }
  }, [isElectron]);

  const control = useCallback(async (action: string, value?: any) => {
    if (!isConnectedRef.current) return;

    try {
      if (isElectron) {
        const result = await electronAPI.castControl({ action, value });
        if (result.status) {
          setStatus(prev => ({ ...prev, ...result.status }));
        }
      }
    } catch (err) {
      console.error(`[useCastSession] ${action} error:`, err);
    }
  }, [isElectron]);

  // Wrappers
  const play = useCallback(() => control('play'), [control]);
  const pause = useCallback(() => control('pause'), [control]);
  const stop = useCallback(() => control('stop'), [control]);
  const seek = useCallback((time: number) => control('seek', time), [control]);
  const setVolume = useCallback((level: number) => {
    setStatus(prev => ({ ...prev, volume: level }));
    control('volume', level);
  }, [control]);
  const setMuted = useCallback((muted: boolean) => {
    setStatus(prev => ({ ...prev, muted }));
    control('mute', muted);
  }, [control]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        window.clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  return {
    isConnected,
    isConnecting,
    device,
    connect,
    disconnect,
    loadMedia,
    play,
    pause,
    stop,
    seek,
    setVolume,
    setMuted,
    status,
    error,
  };
}

export default useCastSession;
