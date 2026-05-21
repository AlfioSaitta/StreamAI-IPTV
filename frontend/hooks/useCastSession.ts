import { useState, useEffect, useCallback, useRef } from 'react';
import { DiscoveredDevice } from '../services/deviceDiscovery';
import { platformService } from '../services/platformService';
import { host } from '../services/hostBridge';

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

interface CastIpcResult {
  success?: boolean;
  error?: string;
  status?: Partial<CastStatus>;
}

export type CastConnectionState = 'disconnected' | 'connecting' | 'connected' | 'buffering' | 'error';

interface UseCastSessionReturn {
  // Connection
  isConnected: boolean;
  isConnecting: boolean;
  connectionState: CastConnectionState;
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

const CAST_CONNECT_TIMEOUT_MS = 8000;
const CAST_LOAD_TIMEOUT_MS = 12000;
const CAST_CONTROL_TIMEOUT_MS = 5000;
const CAST_LOAD_RETRIES = 1;

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
  const [connectionState, setConnectionState] = useState<CastConnectionState>('disconnected');

  // Refs
  const statusUnsubscribe = useRef<(() => void) | null>(null);
  const pollIntervalRef = useRef<number | null>(null);
  const isConnectedRef = useRef(false);

  // Desktop bridge (Electron o Wails) — Fase 7.2: l'hook funziona su entrambi
  // i runtime tramite l'unico accessor `host`. `isDesktop` copre Electron + Wails.
  const hostBridge = host;
  const isDesktop = platformService.isDesktop && !!hostBridge;

  const withTimeout = useCallback(async <T,>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> => {
    let timeoutId: number | null = null;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
        })
      ]);
    } finally {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    }
  }, []);

  // Sync ref
  useEffect(() => {
    isConnectedRef.current = isConnected;
  }, [isConnected]);

  // --- ELECTRON IMPLEMENTATION ---
  
  // Subscribe to status updates (Electron)
  useEffect(() => {
    if (!isDesktop) return;

    statusUnsubscribe.current = hostBridge!.onCastStatus((newStatus: CastStatus) => {
      setStatus(prev => ({
        ...prev,
        ...newStatus,
        deviceName: device?.name,
        deviceIp: device?.ip,
      }));
      setIsConnected(newStatus.connected);
      if (newStatus.error) {
        setError(newStatus.error);
        setConnectionState('error');
      } else if (!newStatus.connected) {
        setConnectionState('disconnected');
      } else if (newStatus.playerState === 'BUFFERING') {
        setConnectionState('buffering');
      } else {
        setConnectionState('connected');
      }
    });

    return () => {
      if (statusUnsubscribe.current) {
        statusUnsubscribe.current();
      }
    };
  }, [isDesktop, device]);

  // Poll for status (Electron)
  useEffect(() => {
    if (!isDesktop || !isConnected) {
      if (pollIntervalRef.current) {
        window.clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      return;
    }

    const fetchStatus = async () => {
      try {
        const result = await hostBridge!.castControl({ action: 'status' });
        if (result.status) {
          setStatus(prev => ({
            ...prev,
            ...result.status,
            deviceName: device?.name,
            deviceIp: device?.ip,
          }));
          setIsConnected(result.status.connected !== false);
          setConnectionState(result.status.connected === false ? 'disconnected' : result.status.playerState === 'BUFFERING' ? 'buffering' : 'connected');
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
  }, [isDesktop, isConnected, device]);

  // --- ACTIONS ---

  const connect = useCallback(async (targetDevice: DiscoveredDevice): Promise<boolean> => {
    setIsConnecting(true);
    setConnectionState('connecting');
    setError(null);

    try {
      if (isDesktop) {
        // Electron Native Cast
        console.log('[useCastSession] Connecting via Electron to:', targetDevice.ip);
        const result = await withTimeout<CastIpcResult>(
          hostBridge!.castConnect({ ip: targetDevice.ip, port: targetDevice.services?.find(s => s.protocol === 'castv2')?.port }),
          CAST_CONNECT_TIMEOUT_MS,
          `Timeout connessione a ${targetDevice.name}`
        );

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
          setConnectionState('connected');
          return true;
        } else {
          setError(result.error || 'Connessione fallita: dispositivo offline o protocollo non supportato');
          setConnectionState('error');
          return false;
        }
      } else {
        // TODO: Implementare Capacitor Cast Plugin per Android/iOS
        console.warn('[useCastSession] Casting not supported on this platform yet');
        setError('Casting non disponibile su questa piattaforma');
        setConnectionState('error');
        return false;
      }
    } catch (err) {
      setError((err as Error).message);
      setConnectionState('error');
      return false;
    } finally {
      setIsConnecting(false);
    }
  }, [isDesktop, withTimeout]);

  const disconnect = useCallback(async () => {
    console.log('[useCastSession] Disconnecting...');
    isConnectedRef.current = false;

    try {
      if (isDesktop) {
        await hostBridge!.castDisconnect();
      }
    } catch {}

    setIsConnected(false);
    setDevice(null);
    setStatus(initialStatus);
    setError(null);
    setConnectionState('disconnected');
  }, [isDesktop]);

  const loadMedia = useCallback(async (url: string, title: string): Promise<boolean> => {
    if (!isConnectedRef.current) return false;

    try {
      if (isDesktop) {
        setConnectionState('buffering');
        for (let attempt = 0; attempt <= CAST_LOAD_RETRIES; attempt++) {
          const result = await withTimeout<CastIpcResult>(
            hostBridge!.castLoad({ mediaUrl: url, title }),
            CAST_LOAD_TIMEOUT_MS,
            'Timeout caricamento media sul dispositivo'
          );
          if (result.success && result.status) {
            setStatus(prev => ({ ...prev, ...result.status }));
            setConnectionState(result.status.playerState === 'BUFFERING' ? 'buffering' : 'connected');
            return true;
          }
          if (attempt === CAST_LOAD_RETRIES) {
            const message = result.error || 'Il dispositivo ha rifiutato lo stream o il formato non è supportato';
            setError(message);
            setConnectionState('error');
            return false;
          }
        }
      }
      return false;
    } catch (err) {
      setError((err as Error).message);
      setConnectionState('error');
      return false;
    }
  }, [isDesktop, withTimeout]);

  const control = useCallback(async (action: string, value?: any) => {
    if (!isConnectedRef.current) return;

    try {
      if (isDesktop) {
        const result = await withTimeout<CastIpcResult>(
          hostBridge!.castControl({ action, value }),
          CAST_CONTROL_TIMEOUT_MS,
          `Timeout comando cast: ${action}`
        );
        if (result.status) {
          setStatus(prev => ({ ...prev, ...result.status }));
        }
      }
    } catch (err) {
      console.error(`[useCastSession] ${action} error:`, err);
    }
  }, [isDesktop, withTimeout]);

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
    connectionState,
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
