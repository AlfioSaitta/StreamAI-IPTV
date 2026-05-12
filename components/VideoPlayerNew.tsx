import React, { useEffect, useRef, useState, useCallback } from 'react';
import type Player from 'video.js/dist/types/player';
import type Hls from 'hls.js';
import 'video.js/dist/video-js.css';

import { Channel } from '../types';
import { platformService } from '../services/platformService';
import { nativeVideoPlayer } from '../services/nativeVideoPlayer';
import { streamInfoService } from '../services/streamInfoService';
import { useCastSession } from '../hooks/useCastSession';
import { usePlayerOsd } from '../hooks/usePlayerOsd';
import { useInteractiveTimeline } from '../hooks/useInteractiveTimeline';
import { usePlayerShortcuts } from '../hooks/usePlayerShortcuts';
import { usePlayerMediaSession } from '../hooks/usePlayerMediaSession';
import { useRemoteControl } from '../hooks/useRemoteControl';
import { useNativePlayerEngine } from '../hooks/useNativePlayerEngine';
import { useWebPlayerEngine } from '../hooks/useWebPlayerEngine';
import CastDevicePicker from './CastDevicePicker';
import {
  MAX_PLAYBACK_RETRIES,
  type PlayerEngine,
  type PlaybackErrorState,
  type StreamSourceInfo,
} from './player/playerTypes';
import {
  detectStreamSource,
  formatTime,
  sanitizeStreamUrl,
} from './player/playerUtils';
import {
  AlertTriangle, Play, Pause, Volume2, VolumeX, Maximize, Minimize,
  SkipForward, SkipBack, List, X, FastForward, Rewind, RotateCcw,
  PictureInPicture2, Loader2, Info, Cast, Tv, Headphones, Volume1
} from 'lucide-react';

// --- TYPES ---

interface VideoPlayerProps {
  channel: Channel | null;
  playlist?: Channel[];
  onChannelSelect?: (channel: Channel) => void;
  onNext?: () => void;
  onPrev?: () => void;
  onBack?: () => void;
  onProgress?: (progress: number, duration: number) => void;
  initialProgress?: number;
  onResetProgress?: () => void;
  debugOverlay?: boolean;
}


// --- MAIN COMPONENT ---

const VideoPlayerNew: React.FC<VideoPlayerProps> = ({
  channel,
  playlist = [],
  onChannelSelect,
  onNext,
  onPrev,
  onBack,
  onProgress,
  initialProgress,
  onResetProgress,
  debugOverlay = false,
}) => {
  // Refs
  const videoRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Player | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsTimeoutRef = useRef<number | null>(null);
  const networkStatusIntervalRef = useRef<number | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const mpegtsRef = useRef<any>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);
  const loadTimeoutRef = useRef<number | null>(null);
  const nativeProgressIntervalRef = useRef<number | null>(null);
  const playerEngineRef = useRef<PlayerEngine>('videojs');
  const lastSourceRef = useRef<string | null>(null);

  // State
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState<PlaybackErrorState | null>(null);
  const [isUsingNativePlayer, setIsUsingNativePlayer] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showDevicePicker, setShowDevicePicker] = useState(false);
  const [isCastLoading, setIsCastLoading] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isPiP, setIsPiP] = useState(false);
  const [showPlaylist, setShowPlaylist] = useState(false);
  const [showAudioMenu, setShowAudioMenu] = useState(false);
  const [audioTracks, setAudioTracks] = useState<any[]>([]);
  const [networkSpeed, setNetworkSpeed] = useState<number | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [showInfoPanel, setShowInfoPanel] = useState(false);
  const [streamInfoLines, setStreamInfoLines] = useState<string[]>([]);
  const [streamSourceInfo, setStreamSourceInfo] = useState<StreamSourceInfo | null>(null);
  const [nativePiPSupported, setNativePiPSupported] = useState(false);

  // OSD (extracted hook)
  const { osd, showOsd } = usePlayerOsd();

  // Interactive timeline (hover ghost bar + tooltip)
  const {
    timelineRef,
    hoverTime,
    hoverPos,
    onMouseMove: handleTimelineMouseMove,
    onMouseLeave: handleTimelineMouseLeave,
  } = useInteractiveTimeline(duration);

  // Hooks
  const castSession = useCastSession();


  const cleanupPlaybackEngines = useCallback(() => {
    if (retryTimerRef.current) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (loadTimeoutRef.current) {
      window.clearTimeout(loadTimeoutRef.current);
      loadTimeoutRef.current = null;
    }
    if (nativeProgressIntervalRef.current) {
      window.clearInterval(nativeProgressIntervalRef.current);
      nativeProgressIntervalRef.current = null;
    }
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    if (mpegtsRef.current) {
      try {
        mpegtsRef.current.unload?.();
        mpegtsRef.current.detachMediaElement?.();
        mpegtsRef.current.destroy?.();
      } catch (e) {
        console.warn('[Player] Errore cleanup mpegts:', e);
      }
      mpegtsRef.current = null;
    }
  }, []);

  const scheduleRetry = useCallback((reason: PlaybackErrorState) => {
    if (!reason.canRetry || retryTimerRef.current) return;
    const nextRetry = retryCountRef.current + 1;
    const delay = Math.min(6000, 1200 * nextRetry);
    retryTimerRef.current = window.setTimeout(() => {
      retryTimerRef.current = null;
      retryCountRef.current = nextRetry;
      setPlaybackError(null);
      setError(null);
      setIsBuffering(true);
      showOsd(<RotateCcw className="w-12 h-12 text-white" />, `Riprovo (${nextRetry}/${MAX_PLAYBACK_RETRIES})`);
      setRetryNonce(n => n + 1);
    }, delay);
  }, [showOsd]);

  const retryPlaybackNow = useCallback(() => {
    if (retryTimerRef.current) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    retryCountRef.current = Math.min(retryCountRef.current + 1, MAX_PLAYBACK_RETRIES);
    setPlaybackError(null);
    setError(null);
    setIsBuffering(true);
    showOsd(<RotateCcw className="w-12 h-12 text-white" />, 'Riprovo');
    setRetryNonce(n => n + 1);
  }, [showOsd]);

  const updateStreamInfo = useCallback(async () => {
    if (!channel) return;
    const videoElement = playerRef.current?.el()?.querySelector('video') as HTMLVideoElement | null;
    try {
      const info = await streamInfoService.collectInfoAsync(videoElement, hlsRef.current, mpegtsRef.current, channel.url);
      setStreamInfoLines([
        ...streamInfoService.formatInfoForDisplay(info),
        '',
        '🔒 URL',
        `   ${sanitizeStreamUrl(channel.url)}`,
        '',
        '🧩 PLAYER',
        `   Motore: ${playerEngineRef.current}`,
        streamSourceInfo ? `   Rilevamento URL: ${streamSourceInfo.label}` : '   Rilevamento URL: N/D',
      ]);
      setShowInfoPanel(true);
    } catch (e) {
      setStreamInfoLines([
        'Errore durante la raccolta informazioni stream.',
        String(e),
        `URL: ${sanitizeStreamUrl(channel.url)}`,
      ]);
      setShowInfoPanel(true);
    }
  }, [channel, streamSourceInfo]);

  // --- CONTROLS LOGIC ---

  const togglePlay = useCallback(() => {
    if (isUsingNativePlayer) {
      const action = isPlaying ? nativeVideoPlayer.pause() : nativeVideoPlayer.resume();
      action
        .then(() => {
          setIsPlaying(prev => !prev);
          showOsd(isPlaying
            ? <Pause className="w-12 h-12 text-white" fill="white" />
            : <Play className="w-12 h-12 text-white" fill="white" />,
            isPlaying ? 'Pausa' : 'Play'
          );
        })
        .catch(err => {
          console.warn('[Player] Native play/pause failed:', err);
          showOsd(<AlertTriangle className="w-12 h-12 text-white" />, 'Controllo nativo non disponibile');
        });
      return;
    }

    if (playerRef.current) {
      if (playerRef.current.paused()) {
        playerRef.current.play();
        showOsd(<Play className="w-12 h-12 text-white" fill="white" />, "Play");
      } else {
        playerRef.current.pause();
        showOsd(<Pause className="w-12 h-12 text-white" fill="white" />, "Pausa");
      }
    }
  }, [isPlaying, isUsingNativePlayer, showOsd]);

  const skip = useCallback((seconds: number) => {
    if (isUsingNativePlayer) {
      const newTime = Math.max(0, currentTime + seconds);
      nativeVideoPlayer.seekTo(newTime)
        .then(() => setCurrentTime(newTime))
        .catch(err => console.warn('[Player] Native seek failed:', err));

      if (seconds > 0) {
        showOsd(<FastForward className="w-12 h-12 text-white" />, `+${seconds}s`);
      } else {
        showOsd(<Rewind className="w-12 h-12 text-white" />, `${seconds}s`);
      }
      return;
    }

    if (playerRef.current) {
      const newTime = (playerRef.current.currentTime() || 0) + seconds;
      playerRef.current.currentTime(Math.max(0, newTime));
      
      if (seconds > 0) {
        showOsd(<FastForward className="w-12 h-12 text-white" />, `+${seconds}s`);
      } else {
        showOsd(<Rewind className="w-12 h-12 text-white" />, `${seconds}s`);
      }
    }
  }, [currentTime, isUsingNativePlayer, showOsd]);

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (isUsingNativePlayer) {
      nativeVideoPlayer.seekTo(time)
        .then(() => setCurrentTime(time))
        .catch(err => console.warn('[Player] Native timeline seek failed:', err));
      return;
    }

    if (playerRef.current) {
      playerRef.current.currentTime(time);
      setCurrentTime(time); // Aggiornamento immediato UI
    }
  }, [isUsingNativePlayer]);


  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(console.error);
      showOsd(<Minimize className="w-12 h-12 text-white" />, "Esci da Fullscreen");
    } else {
      containerRef.current.requestFullscreen().catch(console.error);
      showOsd(<Maximize className="w-12 h-12 text-white" />, "Fullscreen");
    }
  }, [showOsd]);

  const toggleMute = useCallback(() => {
    if (isUsingNativePlayer) {
      const newMuted = !isMuted;
      nativeVideoPlayer.setMuted(newMuted)
        .then(() => {
          setIsMuted(newMuted);
          showOsd(newMuted
            ? <VolumeX className="w-12 h-12 text-white" />
            : <Volume2 className="w-12 h-12 text-white" />,
            newMuted ? 'Muto' : 'Audio Attivo'
          );
        })
        .catch(err => console.warn('[Player] Native mute failed:', err));
      return;
    }

    if (playerRef.current) {
      const newMuted = !playerRef.current.muted();
      playerRef.current.muted(newMuted);
      setIsMuted(newMuted);
      
      if (newMuted) {
        showOsd(<VolumeX className="w-12 h-12 text-white" />, "Muto");
      } else {
        showOsd(<Volume2 className="w-12 h-12 text-white" />, "Audio Attivo");
        // Se stiamo riattivando l'audio e il volume è a 0, impostiamolo a un valore minimo
        if (playerRef.current.volume() === 0) {
          playerRef.current.volume(0.5);
          setVolume(0.5);
        }
      }
    }
  }, [isMuted, isUsingNativePlayer, showOsd]);

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement> | number) => {
    const newVolume = typeof e === 'number' ? e : parseFloat(e.target.value);
    if (isUsingNativePlayer) {
      nativeVideoPlayer.setVolume(newVolume)
        .then(() => {
          setVolume(newVolume);
          const nextMuted = newVolume === 0;
          setIsMuted(nextMuted);
          return nativeVideoPlayer.setMuted(nextMuted);
        })
        .catch(err => console.warn('[Player] Native volume failed:', err));

      let Icon = Volume2;
      if (newVolume === 0) Icon = VolumeX;
      else if (newVolume < 0.5) Icon = Volume1;
      if (typeof e === 'number') {
        showOsd(<Icon className="w-12 h-12 text-white" />, `${Math.round(newVolume * 100)}%`);
      }
      return;
    }

    if (playerRef.current) {
      playerRef.current.volume(newVolume);
      setVolume(newVolume);
      
      let Icon = Volume2;
      if (newVolume === 0) Icon = VolumeX;
      else if (newVolume < 0.5) Icon = Volume1;
      
      if (newVolume > 0) {
        playerRef.current.muted(false);
        setIsMuted(false);
      } else {
        playerRef.current.muted(true);
        setIsMuted(true);
      }
      
      // Mostra OSD solo se cambiato via tastiera (quando è un numero)
      if (typeof e === 'number') {
        showOsd(<Icon className="w-12 h-12 text-white" />, `${Math.round(newVolume * 100)}%`);
      }
    }
  }, [isUsingNativePlayer, showOsd]);

  const togglePiP = useCallback(async () => {
    if (isUsingNativePlayer) {
      if (!nativePiPSupported) {
        showOsd(<PictureInPicture2 className="w-12 h-12 text-white" />, 'PiP non supportato su questo device');
        return;
      }
      const ok = await nativeVideoPlayer.enterPictureInPicture();
      showOsd(<PictureInPicture2 className="w-12 h-12 text-white" />, ok ? 'PiP Android richiesto' : 'PiP non disponibile');
      return;
    }

    const videoElement = playerRef.current?.el()?.querySelector('video');
    if (!videoElement) return;

    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        setIsPiP(false);
        showOsd(<PictureInPicture2 className="w-12 h-12 text-white" />, "PiP Disattivato");
      } else if (document.pictureInPictureEnabled) {
        await videoElement.requestPictureInPicture();
        setIsPiP(true);
        showOsd(<PictureInPicture2 className="w-12 h-12 text-white" />, "PiP Attivo");
      }
    } catch (err) {
      console.error("PiP error:", err);
      showOsd(<AlertTriangle className="w-12 h-12 text-white" />, 'PiP non disponibile');
    }
  }, [isUsingNativePlayer, nativePiPSupported, showOsd]);

  const restartFromBeginning = () => {
    if (isUsingNativePlayer) {
      nativeVideoPlayer.seekTo(0)
        .then(() => {
          setCurrentTime(0);
          onResetProgress?.();
          showOsd(<RotateCcw className="w-12 h-12 text-white" />, 'Riavvia');
        })
        .catch(err => console.warn('[Player] Native restart failed:', err));
      return;
    }

    if (playerRef.current) {
      playerRef.current.currentTime(0);
      if (onResetProgress) onResetProgress();
      showOsd(<RotateCcw className="w-12 h-12 text-white" />, "Riavvia");
    }
  };

  const handleAudioTrackChange = (trackId: string) => {
    if (playerRef.current) {
      const tracks = playerRef.current.audioTracks() as any;
      for (let i = 0; i < tracks.length; i++) {
        const track = tracks[i];
        track.enabled = track.id === trackId;
      }
      // Lo stato locale verrà aggiornato automaticamente dall'event listener 'change' aggiunto nel useEffect
    }
  };

  // Ref per debouncing broadcast
  const lastBroadcastRef = useRef<number>(0);

  // Broadcast status to remote devices
  const broadcastStatus = useCallback((force = false) => {
    if (!platformService.isElectron || !window.electronAPI?.updatePlaybackStatus || !playerRef.current || playerRef.current.isDisposed()) return;
    
    // Throttle broadcast: non più di una volta ogni 500ms, a meno che non sia forzato
    const now = Date.now();
    if (!force && now - lastBroadcastRef.current < 500) return;
    lastBroadcastRef.current = now;

    const player = playerRef.current;
    
    // Extract series info if possible
    let seriesInfo = {};
    if (channel?.type === 'series') {
      const name = channel.name;
      const sMatch = name.match(/S(\d+)/i);
      const eMatch = name.match(/E(\d+)/i);
      if (sMatch || eMatch) {
        seriesInfo = {
          season: sMatch ? parseInt(sMatch[1]) : undefined,
          episode: eMatch ? parseInt(eMatch[1]) : undefined
        };
      }
    }

    window.electronAPI.updatePlaybackStatus({
      channelName: channel?.name,
      cleanName: channel?.cleanName,
      logo: channel?.logo,
      group: channel?.group,
      currentTime: player.currentTime() || 0,
      duration: player.duration() || 0,
      isPlaying: !player.paused(),
      type: channel?.type,
      ...seriesInfo
    });
  }, [channel]);

  // --- KEYBOARD SHORTCUTS (extracted hook) ---
  usePlayerShortcuts(
    {
      togglePlay,
      skip,
      setVolume: (v) => handleVolumeChange(v),
      currentVolume: volume,
      toggleMute,
      toggleFullscreen,
      openCast: () => setShowDevicePicker(true),
      togglePlaylist: () => setShowPlaylist(prev => !prev),
      onEscape: () => {
        if (showPlaylist) setShowPlaylist(false);
        else if (showDevicePicker) setShowDevicePicker(false);
        else if (showAudioMenu) setShowAudioMenu(false);
        else if (onBack) onBack();
      },
    },
    { channel }
  );


  // --- INITIALIZATION & EVENT HANDLING ---

  // Reset state + detect engine on channel change.
  useEffect(() => {
    if (!channel) return;

    setIsPlaying(false);
    setIsBuffering(true);
    setCurrentTime(0);
    setDuration(0);
    setError(null);
    setPlaybackError(null);
    setShowPlaylist(false);
    setShowAudioMenu(false);
    setShowInfoPanel(false);
    setStreamInfoLines([]);
    setAudioTracks([]);
    setNativePiPSupported(false);
    cleanupPlaybackEngines();

    const source = channel.url;
    if (lastSourceRef.current !== source) {
      retryCountRef.current = 0;
      lastSourceRef.current = source;
    }
    const detectedSource = detectStreamSource(source, channel.type);
    setStreamSourceInfo(detectedSource);
    playerEngineRef.current = platformService.isNative ? 'native' : detectedSource.engine;
    setIsUsingNativePlayer(platformService.isNative);
    if (platformService.isNative) {
      setIsBuffering(false);
    }
  }, [channel, retryNonce, cleanupPlaybackEngines]);

  // Native (Capacitor/ExoPlayer) engine — no-op on web/Electron.
  useNativePlayerEngine({
    channel,
    detectedSource: streamSourceInfo,
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
  });

  // Web (Video.js + hls.js + mpegts.js) engine — no-op on native.
  useWebPlayerEngine({
    channel,
    detectedSource: streamSourceInfo,
    initialProgress,
    retryNonce,
    onNext,
    onProgress,
    videoRef,
    playerRef,
    hlsRef,
    mpegtsRef,
    loadTimeoutRef,
    networkStatusIntervalRef,
    retryCountRef,
    setIsPlaying,
    setIsBuffering,
    setCurrentTime,
    setDuration,
    setVolume,
    setIsMuted,
    setIsFullscreen,
    setNetworkSpeed,
    setAudioTracks,
    setError,
    setPlaybackError,
    setIsPiP,
    showOsd,
    scheduleRetry,
    cleanupPlaybackEngines,
    broadcastStatus,
    isBuffering,
  });

  // Media Session API integration (extracted hook)
  usePlayerMediaSession({
    channel,
    isPlaying,
    currentTime,
    duration,
    togglePlay,
    skip,
    onPrev,
    onNext,
  });

  // Remote Control Handler (extracted hook)
  useRemoteControl({ playerRef, setVolume, setIsMuted, broadcastStatus });

  // --- UI EFFECTS ---

  useEffect(() => {
    const show = () => {
      setShowControls(true);
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
      controlsTimeoutRef.current = window.setTimeout(() => {
        if (isPlaying) setShowControls(false);
      }, 3000);
    };
    
    const el = containerRef.current;
    if (el) {
      el.addEventListener('mousemove', show);
      el.addEventListener('touchstart', show);
    }
    return () => {
      if (el) {
        el.removeEventListener('mousemove', show);
        el.removeEventListener('touchstart', show);
      }
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    };
  }, [isPlaying]);

  if (!channel) return <div className="w-full h-full flex items-center justify-center bg-black text-gray-400">Seleziona un canale</div>;

  if (isUsingNativePlayer) {
    return (
      <div className="native-player-shell relative w-full h-full bg-black flex flex-col items-center justify-center p-8 text-center safe-area-screen android-tv-surface">
        <div className="mb-6 relative">
          <div className="absolute inset-0 bg-blue-500/20 rounded-full animate-ping" style={{ animationDuration: '2s' }}></div>
          <div className="relative bg-gradient-to-br from-blue-600 to-blue-800 p-6 rounded-full shadow-lg shadow-blue-500/30"><Tv className="w-16 h-16 text-white" /></div>
        </div>
        <h2 className="text-2xl font-bold text-white mb-2">Riproduzione in corso...</h2>
        <p className="text-gray-400 mb-8 max-w-md">Il video è in riproduzione nel player nativo.</p>
        {playbackError && (
          <div className="max-w-xl bg-red-950/60 border border-red-500/40 rounded-2xl p-5 text-left mb-6">
            <div className="flex items-center gap-3 mb-2 text-red-200">
              <AlertTriangle className="w-5 h-5" />
              <span className="font-semibold">{playbackError.title}</span>
            </div>
            <p className="text-sm text-red-100 mb-4">{playbackError.message}</p>
            <div className="flex flex-wrap gap-3">
              {playbackError.canRetry && (
                <button onClick={retryPlaybackNow} className="tv-focus touch-target px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white font-medium">
                  Riprova ({playbackError.retryCount}/{MAX_PLAYBACK_RETRIES})
                </button>
              )}
              <button onClick={onBack} className="tv-focus touch-target px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white">Indietro</button>
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-center gap-3 rounded-2xl border border-white/10 bg-black/35 px-4 py-3">
          <button onClick={onBack} className="tv-focus touch-target px-5 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white">
            Indietro
          </button>
          <button
            onClick={togglePiP}
            disabled={!nativePiPSupported}
            className={`tv-focus touch-target px-5 py-2 rounded-lg flex items-center gap-2 ${nativePiPSupported ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-white/5 text-gray-500 cursor-not-allowed'}`}
          >
            <PictureInPicture2 className="w-5 h-5" /> {nativePiPSupported ? 'PiP' : 'PiP non disponibile'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative w-full h-full bg-black overflow-hidden select-none">
      <div ref={videoRef} className="w-full h-full bg-black" />

      {/* OSD Overlay */}
      {osd.visible && (
        <div className="absolute inset-0 z-40 flex items-center justify-center pointer-events-none animate-in fade-in zoom-in duration-200">
          <div className="bg-black/60 backdrop-blur-md p-6 rounded-3xl flex flex-col items-center gap-3 shadow-2xl border border-white/10">
            {osd.icon}
            {osd.text && <span className="text-white font-medium text-lg">{osd.text}</span>}
          </div>
        </div>
      )}

      {/* Network Debug Overlay */}
      {networkSpeed && (debugOverlay || isBuffering) && !error && (
        <div className={`absolute ${isBuffering ? 'inset-0 bg-black/50' : 'top-20 right-6'} flex flex-col items-center justify-center z-20 gap-4 transition-all`}>
          {isBuffering && <Loader2 className="w-16 h-16 text-white animate-spin" />}
          <div className="bg-black/40 backdrop-blur-md px-4 py-1.5 rounded-full border border-white/10 text-white text-xs font-mono shadow-xl flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${networkSpeed > 5 ? 'bg-green-500' : networkSpeed > 2 ? 'bg-yellow-500' : 'bg-red-500'} animate-pulse`} />
            {networkSpeed.toFixed(2)} Mbps
          </div>
        </div>
      )}
      
      {error && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/90">
          <div className="bg-red-950/70 backdrop-blur border border-red-500/50 px-8 py-6 rounded-2xl flex flex-col items-center gap-4 text-center max-w-2xl mx-4 shadow-2xl">
            <AlertTriangle className="w-12 h-12 text-red-400" />
            <div>
              <h3 className="text-2xl font-bold text-white mb-2">{playbackError?.title || 'Errore di riproduzione'}</h3>
              <p className="text-base text-red-100">{error}</p>
            </div>

            {playbackError && (
              <div className="w-full bg-black/30 border border-white/10 rounded-xl p-4 text-left">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-gray-300 mb-3">
                  <span>Categoria: <strong className="text-white">{playbackError.category}</strong></span>
                  <span>Retry: <strong className="text-white">{playbackError.retryCount}/{MAX_PLAYBACK_RETRIES}</strong></span>
                  {streamSourceInfo && <span>Formato: <strong className="text-white">{streamSourceInfo.label}</strong></span>}
                  <span>Motore: <strong className="text-white">{playerEngineRef.current}</strong></span>
                </div>
                <details className="text-xs text-gray-300">
                  <summary className="cursor-pointer text-gray-100 font-semibold mb-2">Dettagli tecnici</summary>
                  <pre className="whitespace-pre-wrap break-words max-h-40 overflow-auto bg-black/40 rounded-lg p-3">{playbackError.technicalDetails.join('\n')}</pre>
                </details>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-center gap-3">
              {playbackError?.canRetry && (
                <button onClick={retryPlaybackNow} className="tv-focus px-6 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg font-semibold flex items-center gap-2">
                  <RotateCcw className="w-4 h-4" /> Riprova
                </button>
              )}
              <button onClick={updateStreamInfo} className="tv-focus px-6 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg flex items-center gap-2">
                <Info className="w-4 h-4" /> Info stream
              </button>
              <button onClick={() => { setError(null); setPlaybackError(null); if (onBack) onBack(); }} className="tv-focus px-6 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-lg">Chiudi</button>
            </div>
          </div>
        </div>
      )}

      {showInfoPanel && (
        <div className="absolute inset-y-0 right-0 z-[80] w-full max-w-xl bg-black/95 backdrop-blur-xl border-l border-white/10 shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
          <div className="p-4 border-b border-white/10 flex items-center justify-between">
            <div>
              <h3 className="text-white font-bold flex items-center gap-2"><Info className="w-5 h-5" /> Info stream</h3>
              <p className="text-xs text-gray-400 truncate max-w-md">{channel.cleanName || channel.name}</p>
            </div>
            <button onClick={() => setShowInfoPanel(false)} aria-label="Chiudi info stream" className="tv-focus p-2 rounded-full hover:bg-white/10"><X className="w-5 h-5 text-gray-300" /></button>
          </div>
          <pre className="flex-1 overflow-auto p-4 text-xs leading-relaxed text-gray-200 whitespace-pre-wrap font-mono">
            {streamInfoLines.length > 0 ? streamInfoLines.join('\n') : 'Nessuna informazione disponibile.'}
          </pre>
        </div>
      )}

      {/* PLAYLIST OVERLAY */}
      {channel.type !== 'movie' && (
        <div className={`absolute top-0 right-0 bottom-0 w-80 bg-black/90 backdrop-blur-xl border-l border-white/10 z-[60] transform transition-transform duration-300 flex flex-col ${showPlaylist ? 'translate-x-0' : 'translate-x-full'}`}>
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
                <h3 className="font-bold text-white">Canali ({playlist.length})</h3>
                <button onClick={() => setShowPlaylist(false)} aria-label="Chiudi lista canali" className="tv-focus touch-target p-2 rounded-full hover:bg-white/10"><X className="w-5 h-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {playlist.map(c => (
                    <button 
                      key={c.id}
                      onClick={() => onChannelSelect && onChannelSelect(c)}
                      className={`tv-focus w-full text-left p-3 rounded-lg flex items-center gap-3 transition-colors ${c.id === channel.id ? 'bg-red-600 text-white' : 'hover:bg-white/10 text-gray-300'}`}
                    >
                        {c.logo && <img src={c.logo} alt={c.name} className="w-8 h-8 object-contain bg-black rounded" loading="lazy" />}
                        <span className="truncate text-sm font-medium">{c.cleanName || c.name}</span>
                    </button>
                ))}
            </div>
        </div>
      )}

      {/* AUDIO TRACKS MENU */}
      {showAudioMenu && audioTracks.length > 1 && (
        <div className="absolute bottom-20 right-4 w-64 bg-black/90 backdrop-blur-xl border border-white/10 rounded-2xl p-2 z-[70] shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-200">
          <div className="p-3 border-b border-white/10 flex items-center justify-between mb-2">
            <h3 className="font-bold text-white text-sm">Tracce Audio</h3>
            <button onClick={() => setShowAudioMenu(false)} aria-label="Chiudi menu tracce audio" className="tv-focus touch-target p-1 rounded-full hover:bg-white/10"><X className="w-4 h-4 text-gray-400" /></button>
          </div>
          <div className="space-y-1">
            {audioTracks.map((track) => (
              <button
                key={track.id}
                onClick={() => handleAudioTrackChange(track.id)}
                className={`tv-focus w-full text-left p-3 rounded-xl flex items-center justify-between transition-all ${
                  track.enabled 
                    ? 'bg-red-600/20 text-red-500 border border-red-500/30' 
                    : 'hover:bg-white/10 text-gray-300 border border-transparent'
                }`}
              >
                <div className="flex flex-col">
                  <span className="text-sm font-bold capitalize">{track.label || `Traccia ${track.id}`}</span>
                  {track.language && <span className="text-[10px] opacity-60 uppercase tracking-widest">{track.language}</span>}
                </div>
                {track.enabled && <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* CONTROLS BAR */}
      <div className={`absolute inset-0 z-30 transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        <div className="absolute top-0 left-0 right-0 p-4 bg-gradient-to-b from-black/80 to-transparent flex justify-between items-center">
          <div className="flex items-center gap-4">
            <button onClick={onBack} aria-label="Indietro" title="Indietro (Esc)" className="tv-focus touch-target p-2 rounded-full bg-white/10 hover:bg-white/20"><X className="w-6 h-6 text-white" /></button>
            <div>
              <h2 className="text-white font-semibold text-lg truncate max-w-md">{channel.cleanName || channel.name}</h2>
              {channel.group && <p className="text-gray-400 text-sm">{channel.group}</p>}
            </div>
          </div>
        </div>
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          {!isPlaying && !isBuffering && (
            <button onClick={togglePlay} aria-label="Play" title="Play (Spazio)" className="tv-focus p-6 rounded-full bg-white/20 hover:bg-white/30 pointer-events-auto"><Play className="w-16 h-16 text-white" fill="white" /></button>
          )}
        </div>
        <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent">
          {channel.type !== 'live' && duration > 0 && (
            <div className="mb-4">
              <div 
                ref={timelineRef}
                className="relative h-2 bg-white/20 rounded-full cursor-pointer group/timeline hover:h-3 transition-all duration-200"
                onMouseMove={handleTimelineMouseMove}
                onMouseLeave={handleTimelineMouseLeave}
                onClick={(e) => {
                  if (!timelineRef.current) return;
                  const rect = timelineRef.current.getBoundingClientRect();
                  const offsetX = e.clientX - rect.left;
                  const percentage = offsetX / rect.width;
                  const time = percentage * duration;
                  if (playerRef.current) {
                    playerRef.current.currentTime(time);
                    setCurrentTime(time);
                  }
                }}
              >
                {/* Buffered Bar */}
                <div className="absolute h-full bg-white/30 rounded-full" style={{ width: '0%' }} />
                
                {/* Played Bar */}
                <div className="absolute h-full bg-red-600 rounded-full" style={{ width: `${(currentTime / duration) * 100}%` }} />
                
                {/* Hover Ghost Bar */}
                {hoverTime !== null && (
                  <div className="absolute h-full bg-white/20 rounded-full" style={{ width: `${hoverPos}%` }} />
                )}

                {/* Thumb (visible on hover) */}
                <div 
                  className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-red-600 rounded-full shadow-lg scale-0 group-hover/timeline:scale-100 transition-transform duration-200"
                  style={{ left: `${(currentTime / duration) * 100}%`, transform: 'translate(-50%, -50%) scale(var(--tw-scale-x))' }}
                />

                {/* Tooltip */}
                {hoverTime !== null && (
                  <div 
                    className="absolute bottom-5 -translate-x-1/2 bg-black/80 text-white text-xs px-2 py-1 rounded border border-white/10 whitespace-nowrap pointer-events-none"
                    style={{ left: `${hoverPos}%` }}
                  >
                    {formatTime(hoverTime)}
                  </div>
                )}

                {/* Input Range (Invisible but functional for dragging) */}
                <input 
                  type="range" 
                  min={0} 
                  max={duration} 
                  value={currentTime} 
                  onChange={handleSeek} 
                  aria-label="Posizione di riproduzione"
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                />
              </div>
              <div className="flex justify-between text-xs text-gray-400 mt-2 font-medium">
                <span>{formatTime(currentTime)}</span><span>{formatTime(duration)}</span>
              </div>
            </div>
          )}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {/* Left Controls */}
              <div className="flex items-center gap-2 group/vol">
                <button onClick={toggleMute} aria-label={isMuted || volume === 0 ? 'Riattiva audio' : 'Disattiva audio'} title={`${isMuted || volume === 0 ? 'Riattiva audio' : 'Muto'} (M)`} className="tv-focus touch-target p-2 hover:bg-white/10 rounded-full">
                  {isMuted || volume === 0 ? <VolumeX className="w-6 h-6 text-white" /> : <Volume2 className="w-6 h-6 text-white" />}
                </button>
                <div className="w-0 group-hover/vol:w-24 overflow-hidden transition-all duration-300">
                  <input
                    type="range" min="0" max="1" step="0.05" value={isMuted ? 0 : volume}
                    onChange={handleVolumeChange}
                    aria-label="Volume"
                    className="w-full h-1 bg-white/30 rounded-full appearance-none cursor-pointer"
                  />
                </div>
              </div>
              {(channel.type === 'movie' || channel.type === 'series') && currentTime > 30 && (
                <button onClick={restartFromBeginning} aria-label="Riparti dall'inizio" className="tv-focus touch-target p-2 hover:bg-white/10 rounded-full" title="Riparti dall'inizio">
                  <RotateCcw className="w-6 h-6 text-white" />
                </button>
              )}
            </div>

            {/* Center Controls */}
            <div className="flex items-center gap-2">
              {onPrev && <button onClick={onPrev} aria-label="Precedente" title="Precedente" className="tv-focus touch-target p-2 hover:bg-white/10 rounded-full"><SkipBack className="w-6 h-6 text-white" /></button>}
              <button onClick={() => skip(-10)} aria-label="Indietro 10 secondi" title="Indietro 10s (←)" className="tv-focus touch-target p-2 hover:bg-white/10 rounded-full"><Rewind className="w-6 h-6 text-white" /></button>
              <button onClick={togglePlay} aria-label={isPlaying ? 'Pausa' : 'Play'} title={`${isPlaying ? 'Pausa' : 'Play'} (Spazio)`} className="tv-focus touch-target p-3 bg-white/10 hover:bg-white/20 rounded-full">{isPlaying ? <Pause className="w-8 h-8 text-white" /> : <Play className="w-8 h-8 text-white" fill="white" />}</button>
              <button onClick={() => skip(10)} aria-label="Avanti 10 secondi" title="Avanti 10s (→)" className="tv-focus touch-target p-2 hover:bg-white/10 rounded-full"><FastForward className="w-6 h-6 text-white" /></button>
              {onNext && <button onClick={onNext} aria-label="Successivo" title="Successivo" className="tv-focus touch-target p-2 hover:bg-white/10 rounded-full"><SkipForward className="w-6 h-6 text-white" /></button>}
            </div>

            {/* Right Controls */}
            <div className="flex items-center gap-2">
              {channel.type === 'series' && (
                <button onClick={() => setShowPlaylist(true)} aria-label="Lista episodi" className="tv-focus touch-target p-2 hover:bg-white/10 rounded-full" title="Lista episodi (L)">
                  <List className="w-6 h-6 text-white" />
                </button>
              )}
              {audioTracks.length > 1 && (
                <button 
                  onClick={() => setShowAudioMenu(!showAudioMenu)} 
                  aria-label="Tracce audio"
                  aria-pressed={showAudioMenu}
                  className={`tv-focus touch-target p-2 hover:bg-white/10 rounded-full transition-colors ${showAudioMenu ? 'text-red-500 bg-white/10' : 'text-white'}`}
                  title="Lingue Audio"
                >
                  <Headphones className="w-6 h-6" />
                </button>
              )}
              <button onClick={updateStreamInfo} aria-label="Info stream/codec" className="tv-focus touch-target p-2 hover:bg-white/10 rounded-full" title="Info Codec">
                <Info className="w-6 h-6 text-white" />
              </button>
              <button
                onClick={() => setShowDevicePicker(true)}
                disabled={isCastLoading || castSession.isConnecting}
                aria-label={castSession.isConnected ? `Casting attivo su ${castSession.device?.name}` : 'Trasmetti su dispositivo'}
                className={`tv-focus touch-target p-2 hover:bg-white/10 rounded-full transition-all ${castSession.isConnected ? 'text-blue-400' : 'text-white'}`}
                title={castSession.isConnected ? `Casting su ${castSession.device?.name}` : 'Trasmetti (C)'}
              >
                {isCastLoading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Cast className="w-6 h-6" />}
              </button>
              {document.pictureInPictureEnabled && (
                <button onClick={togglePiP} aria-label="Picture-in-Picture" aria-pressed={isPiP} className={`tv-focus touch-target p-2 hover:bg-white/10 rounded-full ${isPiP ? 'text-purple-400' : 'text-white'}`} title="Picture-in-Picture (P)">
                  <PictureInPicture2 className="w-6 h-6" />
                </button>
              )}
              <button onClick={toggleFullscreen} aria-label={isFullscreen ? 'Esci da fullscreen' : 'Fullscreen'} title={`${isFullscreen ? 'Esci da fullscreen' : 'Fullscreen'} (F)`} className="tv-focus touch-target p-2 hover:bg-white/10 rounded-full">
                {isFullscreen ? <Minimize className="w-6 h-6 text-white" /> : <Maximize className="w-6 h-6 text-white" />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Cast Device Picker */}
      {channel && (
        <CastDevicePicker
          isOpen={showDevicePicker}
          onClose={() => setShowDevicePicker(false)}
          mediaUrl={channel.url}
          mediaTitle={channel.cleanName || channel.name}
          mediaPoster={channel.logo}
          onDeviceSelect={async (device) => {
            setIsCastLoading(true);
            const connected = await castSession.connect(device);
            if (!connected) {
              setIsCastLoading(false);
              return false;
            }
            const loaded = await castSession.loadMedia(channel.url, channel.cleanName || channel.name);
            setIsCastLoading(false);
            if (loaded && playerRef.current && !playerRef.current.isDisposed()) {
              playerRef.current.pause();
            }
            return loaded;
          }}
        />
      )}
    </div>
  );
};

export default VideoPlayerNew;
