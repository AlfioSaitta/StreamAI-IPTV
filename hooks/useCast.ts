import { useState, useEffect, useCallback } from 'react';
import { CastService, CastState, CastMethod, CastMediaInfo } from '../services/castService.ts';

export interface UseCastReturn {
  // State
  isAvailable: boolean;
  isConnected: boolean;
  isPaused: boolean;
  currentTime: number;
  duration: number;
  deviceName: string | null;
  activeMethod: CastMethod | null;
  availableMethods: CastMethod[];

  // Actions
  castMedia: (url: string, title: string, poster?: string, startTime?: number, method?: CastMethod) => Promise<boolean>;
  castWithMethod: (method: CastMethod, url: string, title: string, poster?: string) => Promise<boolean>;
  requestSession: () => Promise<boolean>;
  endSession: () => void;
  play: () => void;
  pause: () => void;
  togglePlayPause: () => void;
  seek: (time: number) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  stop: () => void;
  openExternal: (url: string, title: string) => Promise<boolean>;
  shareUrl: (url: string, title: string) => Promise<boolean>;
  copyUrl: (url: string) => Promise<boolean>;

  // Debug
  getDebugInfo: () => object;
  isChromecastAvailable: () => boolean;
}

export function useCast(): UseCastReturn {
  const [state, setState] = useState<CastState>(CastService.getState());

  useEffect(() => {
    const unsubscribe = CastService.subscribe((newState) => {
      setState(newState);
    });
    return unsubscribe;
  }, []);

  const castMedia = useCallback(async (
    url: string,
    title: string,
    poster?: string,
    startTime?: number,
    method?: CastMethod
  ) => {
    const media: CastMediaInfo = { url, title, poster, startTime };
    return CastService.castMedia(media, method);
  }, []);

  const castWithMethod = useCallback(async (
    method: CastMethod,
    url: string,
    title: string,
    poster?: string
  ) => {
    const media: CastMediaInfo = { url, title, poster };
    return CastService.castMedia(media, method);
  }, []);

  const requestSession = useCallback(async () => {
    return CastService.requestChromecastSession();
  }, []);

  const endSession = useCallback(() => {
    CastService.endSession();
  }, []);

  const play = useCallback(() => {
    CastService.play();
  }, []);

  const pause = useCallback(() => {
    CastService.pause();
  }, []);

  const togglePlayPause = useCallback(() => {
    CastService.togglePlayPause();
  }, []);

  const seek = useCallback((time: number) => {
    CastService.seek(time);
  }, []);

  const setVolume = useCallback((volume: number) => {
    CastService.setVolume(volume);
  }, []);

  const toggleMute = useCallback(() => {
    CastService.toggleMute();
  }, []);

  const stop = useCallback(() => {
    CastService.stop();
  }, []);

  const openExternal = useCallback(async (url: string, title: string) => {
    return CastService.openInExternalPlayer({ url, title });
  }, []);

  const shareUrl = useCallback(async (url: string, title: string) => {
    return CastService.shareMedia({ url, title });
  }, []);

  const copyUrl = useCallback(async (url: string) => {
    return CastService.copyToClipboard({ url, title: '' });
  }, []);

return {
    // State
    isAvailable: state.isAvailable,
    isConnected: state.isConnected,
    isPaused: state.isPaused,
    currentTime: state.currentTime,
    duration: state.duration,
    deviceName: state.deviceName,
    activeMethod: state.activeMethod,
    availableMethods: state.availableMethods,

    // Actions
    castMedia,
    castWithMethod,
    requestSession,
    endSession,
    play,
    pause,
    togglePlayPause,
    seek,
    setVolume,
    toggleMute,
    stop,
    openExternal,
    shareUrl,
    copyUrl,

    // Debug
    getDebugInfo: () => CastService.getDebugInfo(),
    isChromecastAvailable: () => CastService.isChromecastAvailable(),
  };
}

export default useCast;

