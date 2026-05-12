// Native player engine hook (Capacitor / ExoPlayer on Android).
// Extracted from components/VideoPlayerNew.tsx — refactor B.1 (engine pluggable).
// Behavior preserved 1:1: same events, same retry strategy, same OSD calls.

import { useEffect } from 'react';
import type { MutableRefObject, ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { createElement } from 'react';

import type { Channel } from '../types';
import { platformService } from '../services/platformService';
import { nativeVideoPlayer } from '../services/nativeVideoPlayer';
import {
  MAX_PLAYBACK_RETRIES,
  type PlaybackErrorState,
  type StreamSourceInfo,
} from '../components/player/playerTypes';
import {
  classifyPlaybackError,
  sanitizeStreamUrl,
} from '../components/player/playerUtils';

export interface NativePlayerEngineOptions {
  channel: Channel | null;
  detectedSource: StreamSourceInfo | null;
  initialProgress?: number;
  retryNonce: number;
  onBack?: () => void;
  onNext?: () => void;
  onProgress?: (currentTime: number, duration: number) => void;
  setIsPlaying: (v: boolean) => void;
  setIsBuffering: (v: boolean) => void;
  setCurrentTime: (v: number) => void;
  setDuration: (v: number) => void;
  setPlaybackError: (v: PlaybackErrorState | null) => void;
  setError: (v: string | null) => void;
  setNativePiPSupported: (v: boolean) => void;
  showOsd: (icon: ReactNode, text?: string) => void;
  scheduleRetry: (err: PlaybackErrorState) => void;
  nativeProgressIntervalRef: MutableRefObject<number | null>;
  retryCountRef: MutableRefObject<number>;
}

/**
 * Sets up the native (Capacitor Video Player / ExoPlayer) playback for the
 * given channel. No-op when `platformService.isNative` is false or channel
 * is null / detectedSource is missing.
 */
export const useNativePlayerEngine = (opts: NativePlayerEngineOptions): void => {
  const {
    channel,
    detectedSource,
    initialProgress,
    retryNonce,
    onBack,
    onNext,
    onProgress,
    setIsPlaying,
    setIsBuffering,
    setCurrentTime,
    setDuration,
    setPlaybackError,
    setError,
    setNativePiPSupported,
    showOsd,
    scheduleRetry,
    nativeProgressIntervalRef,
    retryCountRef,
  } = opts;

  useEffect(() => {
    if (!platformService.isNative) return;
    if (!channel || !detectedSource) return;

    const source = channel.url;

    const handlePlayerExit = () => onBack && onBack();
    const syncNativeProgress = async () => {
      const [nativeCurrentTime, nativeDuration, nativeIsPlaying] = await Promise.all([
        nativeVideoPlayer.getCurrentTime(),
        nativeVideoPlayer.getDuration(),
        nativeVideoPlayer.isPlaying(),
      ]);
      if (Number.isFinite(nativeCurrentTime)) setCurrentTime(nativeCurrentTime);
      if (Number.isFinite(nativeDuration) && nativeDuration > 0) setDuration(nativeDuration);
      setIsPlaying(nativeIsPlaying);
      if (onProgress && nativeDuration > 0) onProgress(nativeCurrentTime, nativeDuration);
    };
    const handleNativeReady = async () => {
      setIsBuffering(false);
      const nativeDuration = await nativeVideoPlayer.getDuration();
      if (nativeDuration > 0) {
        setDuration(nativeDuration);
        if (initialProgress && initialProgress > 0.05 && initialProgress < 0.95) {
          await nativeVideoPlayer.seekTo(nativeDuration * initialProgress);
        }
      }
      await syncNativeProgress();
    };
    const handleNativePlay = () => { setIsPlaying(true); setIsBuffering(false); };
    const handleNativePause = () => setIsPlaying(false);
    const handleNativeEnded = () => { setIsPlaying(false); onNext?.(); };
    const handleNativeTimeUpdate = (data: any) => {
      const nativeCurrentTime = Number(data?.currentTime ?? data?.current_time ?? data?.value ?? data?.currentTimeSeconds ?? 0);
      const nativeDuration = Number(data?.duration ?? data?.durationSeconds ?? data?.totalTime ?? 0);
      if (Number.isFinite(nativeCurrentTime)) setCurrentTime(nativeCurrentTime);
      if (Number.isFinite(nativeDuration) && nativeDuration > 0) setDuration(nativeDuration);
      if (onProgress && nativeDuration > 0) onProgress(nativeCurrentTime, nativeDuration);
    };
    const handleNativeError = (data: any) => {
      const nativeError: PlaybackErrorState = {
        title: 'Errore player nativo',
        message: 'ExoPlayer non è riuscito ad avviare o mantenere la riproduzione dello stream.',
        category: 'native',
        canRetry: retryCountRef.current < MAX_PLAYBACK_RETRIES,
        retryCount: retryCountRef.current,
        technicalDetails: [
          `Motore: native`,
          `Protocollo: ${detectedSource.label}`,
          `URL: ${sanitizeStreamUrl(source)}`,
          `Dettaglio: ${JSON.stringify(data)}`,
        ],
      };
      setPlaybackError(nativeError);
      setError(nativeError.message);
      showOsd(createElement(AlertTriangle, { className: 'w-12 h-12 text-white' }), nativeError.title);
      scheduleRetry(nativeError);
    };

    nativeVideoPlayer.on('exit', handlePlayerExit);
    nativeVideoPlayer.on('ready', handleNativeReady);
    nativeVideoPlayer.on('play', handleNativePlay);
    nativeVideoPlayer.on('pause', handleNativePause);
    nativeVideoPlayer.on('ended', handleNativeEnded);
    nativeVideoPlayer.on('timeupdate', handleNativeTimeUpdate);
    nativeVideoPlayer.on('error', handleNativeError);

    nativeVideoPlayer
      .play({
        url: source,
        title: channel.cleanName || channel.name,
        poster: channel.logo,
        pipEnabled: platformService.isAndroid,
      })
      .then(success => {
        setNativePiPSupported(nativeVideoPlayer.supportsPiP);
        if (!success) {
          const nativeError = classifyPlaybackError(null, detectedSource, source, retryCountRef.current, 'native', 'initPlayer returned false');
          setPlaybackError(nativeError);
          setError(nativeError.message);
          showOsd(createElement(AlertTriangle, { className: 'w-12 h-12 text-white' }), nativeError.title);
          scheduleRetry(nativeError);
        }
      })
      .catch(err => {
        const nativeError = classifyPlaybackError(null, detectedSource, source, retryCountRef.current, 'native', err);
        setPlaybackError(nativeError);
        setError(nativeError.message);
        showOsd(createElement(AlertTriangle, { className: 'w-12 h-12 text-white' }), nativeError.title);
        scheduleRetry(nativeError);
      });

    nativeProgressIntervalRef.current = window.setInterval(syncNativeProgress, 2000);

    return () => {
      nativeVideoPlayer.off('exit', handlePlayerExit);
      nativeVideoPlayer.off('ready', handleNativeReady);
      nativeVideoPlayer.off('play', handleNativePlay);
      nativeVideoPlayer.off('pause', handleNativePause);
      nativeVideoPlayer.off('ended', handleNativeEnded);
      nativeVideoPlayer.off('timeupdate', handleNativeTimeUpdate);
      nativeVideoPlayer.off('error', handleNativeError);
      if (nativeProgressIntervalRef.current) {
        window.clearInterval(nativeProgressIntervalRef.current);
        nativeProgressIntervalRef.current = null;
      }
      nativeVideoPlayer.stop().catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, detectedSource, initialProgress, retryNonce, onBack, onNext, onProgress]);
};

