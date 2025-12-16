import { useState, useEffect, useCallback, useRef } from 'react';
import { DiscoveredDevice } from '../services/deviceDiscovery';

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
  const statusUnsubscribe = useRef<(() => void) | null>(null);
  const pollIntervalRef = useRef<number | null>(null);

  // Ref per tracciare lo stato di connessione in modo sincrono (evita problemi di closure)
  const isConnectedRef = useRef(false);

  // Check if Electron API is available
  const electronAPI = (window as any).electronAPI;
  const isElectron = !!electronAPI?.isElectron;

  // Aggiorna ref quando cambia isConnected
  useEffect(() => {
    isConnectedRef.current = isConnected;
  }, [isConnected]);

  // Subscribe to status updates from main process
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

  // Poll for status updates (richiede attivamente lo stato dal dispositivo)
  useEffect(() => {
    if (!isElectron || !isConnected) {
      if (pollIntervalRef.current) {
        window.clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      return;
    }

    // Richiedi lo stato immediatamente
    const fetchStatus = async () => {
      try {
        // Usa l'azione 'status' per richiedere lo stato attuale
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

    // Prima richiesta immediata
    fetchStatus();

    // Poll ogni 1.5 secondi per aggiornamenti più reattivi
    pollIntervalRef.current = window.setInterval(fetchStatus, 1500);

    return () => {
      if (pollIntervalRef.current) {
        window.clearInterval(pollIntervalRef.current);
      }
    };
  }, [isElectron, isConnected, device]);

  const connect = useCallback(async (targetDevice: DiscoveredDevice): Promise<boolean> => {
    if (!isElectron) {
      setError('Cast non disponibile');
      return false;
    }

    setIsConnecting(true);
    setError(null);

    try {
      console.log('[useCastSession] Connecting to:', targetDevice.ip);
      const result = await electronAPI.castConnect({ ip: targetDevice.ip });
      console.log('[useCastSession] Connect result:', result);

      if (result.success) {
        setDevice(targetDevice);
        setIsConnected(true);
        isConnectedRef.current = true; // Imposta subito il ref
        setStatus(prev => ({
          ...prev,
          connected: true,
          deviceName: targetDevice.name,
          deviceIp: targetDevice.ip,
        }));
        console.log('[useCastSession] Connected! isConnectedRef:', isConnectedRef.current);
        return true;
      } else {
        setError(result.error || 'Connessione fallita');
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
    if (!isElectron) return;

    console.log('[useCastSession] Disconnecting...');
    isConnectedRef.current = false; // Reset ref subito

    try {
      await electronAPI.castDisconnect();
    } catch {}

    setIsConnected(false);
    setDevice(null);
    setStatus(initialStatus);
    setError(null);
  }, [isElectron]);

  const loadMedia = useCallback(async (url: string, title: string): Promise<boolean> => {
    console.log('[useCastSession] loadMedia called, isElectron:', isElectron, 'isConnectedRef:', isConnectedRef.current);
    if (!isElectron || !isConnectedRef.current) {
      console.log('[useCastSession] loadMedia skipped - not connected');
      return false;
    }

    try {
      console.log('[useCastSession] Loading media:', title);
      const result = await electronAPI.castLoad({ mediaUrl: url, title });
      console.log('[useCastSession] Load result:', result);

      if (result.success && result.status) {
        setStatus(prev => ({
          ...prev,
          ...result.status,
        }));
        return true;
      } else {
        setError(result.error || 'Caricamento fallito');
        return false;
      }
    } catch (err) {
      setError((err as Error).message);
      return false;
    }
  }, [isElectron]);

const play = useCallback(async () => {
    console.log('[useCastSession] play() called, isElectron:', isElectron, 'isConnectedRef:', isConnectedRef.current);
    if (!isElectron) {
      console.log('[useCastSession] Not in Electron, skipping');
      return;
    }
    if (!isConnectedRef.current) {
      console.log('[useCastSession] Not connected (ref), skipping');
      return;
    }

    try {
      console.log('[useCastSession] Sending play command via IPC');
      const result = await electronAPI.castControl({ action: 'play' });
      console.log('[useCastSession] Play result:', result);
      if (result.status) {
        setStatus(prev => ({ ...prev, ...result.status }));
      }
      if (!result.success) {
        console.error('[useCastSession] Play failed:', result.error);
      }
    } catch (err) {
      console.error('[useCastSession] Play exception:', err);
    }
  }, [isElectron]);

  const pause = useCallback(async () => {
    console.log('[useCastSession] pause() called, isElectron:', isElectron, 'isConnectedRef:', isConnectedRef.current);
    if (!isElectron) {
      console.log('[useCastSession] Not in Electron, skipping');
      return;
    }
    if (!isConnectedRef.current) {
      console.log('[useCastSession] Not connected (ref), skipping');
      return;
    }

    try {
      console.log('[useCastSession] Sending pause command via IPC');
      const result = await electronAPI.castControl({ action: 'pause' });
      console.log('[useCastSession] Pause result:', result);
      if (result.status) {
        setStatus(prev => ({ ...prev, ...result.status }));
      }
      if (!result.success) {
        console.error('[useCastSession] Pause failed:', result.error);
      }
    } catch (err) {
      console.error('[useCastSession] Pause exception:', err);
    }
  }, [isElectron]);

  const stop = useCallback(async () => {
    if (isElectron && isConnectedRef.current) {
      console.log('[useCastSession] Sending stop command');
      const result = await electronAPI.castControl({ action: 'stop' });
      console.log('[useCastSession] Stop result:', result);
      if (result.status) {
        setStatus(prev => ({ ...prev, ...result.status }));
      }
    }
  }, [isElectron]);

  const seek = useCallback(async (time: number) => {
    if (isElectron && isConnectedRef.current) {
      console.log('[useCastSession] Sending seek command to:', time);
      const result = await electronAPI.castControl({ action: 'seek', value: time });
      console.log('[useCastSession] Seek result:', result);
      if (result.status) {
        setStatus(prev => ({ ...prev, ...result.status }));
      }
    }
  }, [isElectron]);

  const setVolume = useCallback(async (level: number) => {
    if (isElectron && isConnectedRef.current) {
      console.log('[useCastSession] Sending volume command:', level);
      const result = await electronAPI.castControl({ action: 'volume', value: level });
      console.log('[useCastSession] Volume result:', result);
      setStatus(prev => ({ ...prev, volume: level }));
      if (result.status) {
        setStatus(prev => ({ ...prev, ...result.status }));
      }
    }
  }, [isElectron]);

  const setMuted = useCallback(async (muted: boolean) => {
    if (isElectron && isConnectedRef.current) {
      console.log('[useCastSession] Sending mute command:', muted);
      const result = await electronAPI.castControl({ action: 'mute', value: muted });
      console.log('[useCastSession] Mute result:', result);
      setStatus(prev => ({ ...prev, muted }));
      if (result.status) {
        setStatus(prev => ({ ...prev, ...result.status }));
      }
    }
  }, [isElectron]);

  // Cleanup on unmount
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

