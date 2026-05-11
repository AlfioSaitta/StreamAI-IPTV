import React, { useEffect, useRef, useState, useCallback } from 'react';
import videojs from 'video.js';
import 'video.js/dist/video-js.css';
import Player from 'video.js/dist/types/player';

import { Channel } from '../types';
import { platformService } from '../services/platformService';
import { nativeVideoPlayer } from '../services/nativeVideoPlayer';
import { useCastSession } from '../hooks/useCastSession';
import CastDevicePicker from './CastDevicePicker';
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

interface OsdState {
  icon: React.ReactNode;
  text?: string;
  visible: boolean;
}

// --- UTILS ---

const formatTime = (seconds: number): string => {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0
    ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
    : `${m}:${s.toString().padStart(2, '0')}`;
};

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
  const osdTimeoutRef = useRef<number | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  // State
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
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
  
  // OSD State
  const [osd, setOsd] = useState<OsdState>({ icon: null, visible: false });

  // Timeline Hover State
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverPos, setHoverPos] = useState<number>(0);

  // Hooks
  const castSession = useCastSession();

  // --- OSD HELPER ---
  const showOsd = useCallback((icon: React.ReactNode, text?: string) => {
    setOsd({ icon, text, visible: true });
    
    if (osdTimeoutRef.current) {
      window.clearTimeout(osdTimeoutRef.current);
    }
    
    osdTimeoutRef.current = window.setTimeout(() => {
      setOsd(prev => ({ ...prev, visible: false }));
    }, 2000);
  }, []);

  // --- CONTROLS LOGIC ---

  const togglePlay = useCallback(() => {
    if (playerRef.current) {
      if (playerRef.current.paused()) {
        playerRef.current.play();
        showOsd(<Play className="w-12 h-12 text-white" fill="white" />, "Play");
      } else {
        playerRef.current.pause();
        showOsd(<Pause className="w-12 h-12 text-white" fill="white" />, "Pausa");
      }
    }
  }, [showOsd]);

  const skip = useCallback((seconds: number) => {
    if (playerRef.current) {
      const newTime = (playerRef.current.currentTime() || 0) + seconds;
      playerRef.current.currentTime(Math.max(0, newTime));
      
      if (seconds > 0) {
        showOsd(<FastForward className="w-12 h-12 text-white" />, `+${seconds}s`);
      } else {
        showOsd(<Rewind className="w-12 h-12 text-white" />, `${seconds}s`);
      }
    }
  }, [showOsd]);

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (playerRef.current) {
      playerRef.current.currentTime(time);
      setCurrentTime(time); // Aggiornamento immediato UI
    }
  }, []);

  const handleTimelineMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!timelineRef.current || duration <= 0) return;
    
    const rect = timelineRef.current.getBoundingClientRect();
    const offsetX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const percentage = offsetX / rect.width;
    const time = percentage * duration;
    
    setHoverPos(percentage * 100);
    setHoverTime(time);
  }, [duration]);

  const handleTimelineMouseLeave = useCallback(() => {
    setHoverTime(null);
  }, []);

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
  }, [showOsd]);

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement> | number) => {
    const newVolume = typeof e === 'number' ? e : parseFloat(e.target.value);
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
  }, [showOsd]);

  const togglePiP = useCallback(async () => {
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
    }
  }, [showOsd]);

  const restartFromBeginning = () => {
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

  // --- KEYBOARD SHORTCUTS ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignora se l'utente sta scrivendo in un input
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;

      const key = e.key.toLowerCase();

      switch (key) {
        // Play / Pausa
        case ' ':
        case 'enter':
        case 'p':
          e.preventDefault();
          togglePlay();
          break;

        // Seeking
        case 'arrowleft':
          e.preventDefault();
          skip(-10);
          break;
        case 'arrowright':
          e.preventDefault();
          skip(10);
          break;

        // Volume
        case 'arrowup':
          e.preventDefault();
          handleVolumeChange(Math.min(1, volume + 0.1));
          break;
        case 'arrowdown':
          e.preventDefault();
          handleVolumeChange(Math.max(0, volume - 0.1));
          break;
        case 'm':
          e.preventDefault();
          toggleMute();
          break;

        // Fullscreen
        case 'f':
          e.preventDefault();
          toggleFullscreen();
          break;

        // Cast
        case 'c':
          e.preventDefault();
          setShowDevicePicker(true);
          break;

        // Lista Canali / Episodi
        case 'l':
          e.preventDefault();
          if (channel?.type === 'live' || channel?.type === 'series') {
            setShowPlaylist(prev => !prev);
          }
          break;

        // Indietro / Chiudi menu
        case 'escape':
          e.preventDefault();
          if (showPlaylist) setShowPlaylist(false);
          else if (showDevicePicker) setShowDevicePicker(false);
          else if (showAudioMenu) setShowAudioMenu(false);
          else if (onBack) onBack();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay, skip, volume, handleVolumeChange, toggleMute, toggleFullscreen, channel, showPlaylist, showDevicePicker, showAudioMenu, onBack]);


  // --- INITIALIZATION & EVENT HANDLING ---

  useEffect(() => {
    if (!channel) return;

    // Reset state for a new channel
    setIsPlaying(false);
    setIsBuffering(true);
    setCurrentTime(0);
    setDuration(0);
    setError(null);
    setIsUsingNativePlayer(false);
    setShowPlaylist(false);
    setShowAudioMenu(false);
    setAudioTracks([]);

    const source = channel.url;

    // Native Player (Android/iOS)
    if (platformService.isNative) {
      setIsUsingNativePlayer(true);
      setIsBuffering(false);
      const handlePlayerExit = () => onBack && onBack();
      nativeVideoPlayer.on('exit', handlePlayerExit);
      nativeVideoPlayer.play({ url: source, title: channel.cleanName || channel.name })
        .then(success => { if (!success) setError('Impossibile avviare il player nativo'); });
      return () => nativeVideoPlayer.off('exit', handlePlayerExit);
    }

    // Web/Electron Player
    if (!videoRef.current) return;
    const container = videoRef.current;
    container.innerHTML = '';

    const videoEl = document.createElement('video');
    videoEl.className = 'video-js vjs-big-play-centered vjs-fill';
    videoEl.playsInline = true;
    container.appendChild(videoEl);

    let sourceType = 'video/mp4';
    if (source.includes('.m3u8')) sourceType = 'application/x-mpegURL';
    else if (source.includes('.mpd')) sourceType = 'application/dash+xml';

    const player = videojs(videoEl, {
      autoplay: false,
      controls: false,
      responsive: true,
      fluid: true,
      preload: 'metadata',
      sources: [{ src: source, type: sourceType }],
    });
    playerRef.current = player;
    
    // Initial broadcast to announce existence
    broadcastStatus();

    player.on('play', () => { 
      if (!player.isDisposed()) {
        setIsPlaying(true); 
        setIsBuffering(false); 
        if ('mediaSession' in navigator) {
          navigator.mediaSession.playbackState = 'playing';
        }
        broadcastStatus();
      }
    });
    player.on('pause', () => {
      if (!player.isDisposed()) {
        setIsPlaying(false);
        if ('mediaSession' in navigator) {
          navigator.mediaSession.playbackState = 'paused';
        }
        broadcastStatus();
      }
    });
    player.on('waiting', () => {
      if (!player.isDisposed()) setIsBuffering(true);
    });
    player.on('playing', () => {
      if (!player.isDisposed()) {
        setIsBuffering(false);
        broadcastStatus();
      }
    });
    player.on('seeked', () => {
      if (!player.isDisposed()) broadcastStatus();
    });
    player.on('volumechange', () => {
      if (!player.isDisposed()) {
        setVolume(player.volume() || 0);
        setIsMuted(player.muted() || false);
        broadcastStatus();
      }
    });
    player.on('timeupdate', () => {
      if (!player.isDisposed()) {
        const cTime = player.currentTime() || 0;
        setCurrentTime(cTime);
        if (onProgress) onProgress(cTime, player.duration() || 0);
        if (isBuffering && cTime > 0) setIsBuffering(false);
      }
    });
    player.on('durationchange', () => {
      if (!player.isDisposed()) {
        setDuration(player.duration() || 0);
        broadcastStatus();
      }
    });
    player.on('fullscreenchange', () => {
      if (!player.isDisposed()) setIsFullscreen(player.isFullscreen() || false);
    });
    player.on('loadedmetadata', () => {
      if (player.isDisposed()) return;
      
      updateAudioTracksList();

      const dur = player.duration() || 0;
      setDuration(dur);
      if (initialProgress && initialProgress > 0.05 && initialProgress < 0.95) {
        player.currentTime(dur * initialProgress);
      }
      player.play()?.catch(e => console.warn("Autoplay bloccato:", e));
      broadcastStatus();
    });
    player.on('ended', () => { 
      if (onNext) onNext(); 
      broadcastStatus();
    });
    player.on('error', () => {
       const err = player.error();
       console.error("VideoJS Error:", err);
       
       // Fallback logic for common codec/source errors
       if (err?.code === 4 || err?.code === 3) {
          setError('Errore di decodifica o rete. Prova un altro canale.');
       } else {
          setError('Errore di riproduzione');
       }
       broadcastStatus();
    });

    // PiP Events
    const handleEnterPiP = () => setIsPiP(true);
    const handleLeavePiP = () => setIsPiP(false);
    videoEl.addEventListener('enterpictureinpicture', handleEnterPiP);
    videoEl.addEventListener('leavepictureinpicture', handleLeavePiP);

    // Audio Track Change Event
    const tracks = player.audioTracks() as any;
    const updateAudioTracksList = () => {
      const tracksList = [];
      for (let i = 0; i < tracks.length; i++) {
        tracksList.push({
          id: tracks[i].id,
          label: tracks[i].label,
          language: tracks[i].language,
          enabled: tracks[i].enabled
        });
      }
      setAudioTracks(tracksList);
    };
    
    tracks.addEventListener('change', updateAudioTracksList);

    // Broadcast network status
    if (platformService.isElectron && window.electronAPI) {
      networkStatusIntervalRef.current = window.setInterval(() => {
        if (player && !player.isDisposed()) {
          // Monitor network speed
          const stats = (player.tech({ IWillNotUseThisInPlugins: true }) as any)?.vhs?.stats;
          if (stats && stats.bandwidth) {
             setNetworkSpeed(stats.bandwidth / 1024 / 1024); // Mbps
          }

          // Periodic broadcast (meno frequente per risparmiare risorse)
          broadcastStatus();
        }
      }, 5000);
    }

    return () => {
      if (networkStatusIntervalRef.current) clearInterval(networkStatusIntervalRef.current);
      videoEl.removeEventListener('enterpictureinpicture', handleEnterPiP);
      videoEl.removeEventListener('leavepictureinpicture', handleLeavePiP);
      tracks.removeEventListener('change', updateAudioTracksList);
      if (playerRef.current) {
        playerRef.current.dispose();
        playerRef.current = null;
      }
    };
  }, [channel, initialProgress, onBack, onNext, onProgress, broadcastStatus]);

  // Media Session API integration
  useEffect(() => {
    if (!('mediaSession' in navigator) || !channel) return;

    navigator.mediaSession.metadata = new window.MediaMetadata({
      title: channel.cleanName || channel.name,
      artist: channel.group || 'StreamAI IPTV',
      artwork: [
        { src: channel.logo || 'icon.png', sizes: '512x512', type: 'image/png' }
      ]
    });

    const actionHandlers: [MediaSessionAction, () => void][] = [
      ['play', togglePlay],
      ['pause', togglePlay],
      ['previoustrack', () => onPrev?.()],
      ['nexttrack', () => onNext?.()],
      ['seekbackward', () => skip(-10)],
      ['seekforward', () => skip(10)],
    ];

    for (const [action, handler] of actionHandlers) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch (error) {
        console.warn(`MediaSession action ${action} non supportata.`);
      }
    }

    return () => {
      actionHandlers.forEach(([action]) => {
        try {
          navigator.mediaSession.setActionHandler(action, null);
        } catch (error) {}
      });
    };
  }, [channel, togglePlay, skip, onPrev, onNext]);

  // Update Media Session position state
  useEffect(() => {
    if (!('mediaSession' in navigator) || !playerRef.current) return;
    
    try {
      if (duration > 0) {
        navigator.mediaSession.setPositionState({
          duration: duration,
          playbackRate: 1,
          position: currentTime
        });
      }
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    } catch (error) {
      console.warn("Errore aggiornamento MediaSession position state:", error);
    }
  }, [currentTime, duration, isPlaying]);

  // Remote Control Handler
  useEffect(() => {
    if (platformService.isElectron && window.electronAPI?.onRemoteControlCommand && window.electronAPI.onRequestStatusBroadcast) {
      const unsubCommand = window.electronAPI.onRemoteControlCommand((command: any) => {
        const player = playerRef.current;
        if (!player || player.isDisposed()) return;

        switch (command.action) {
          case 'play': player.play(); break;
          case 'pause': player.pause(); break;
          case 'seek': if (typeof command.value === 'number') player.currentTime(command.value); break;
          case 'skip': if (typeof command.value === 'number') player.currentTime((player.currentTime() || 0) + command.value); break;
          case 'volume': 
            if (typeof command.value === 'number') {
              const newVol = Math.max(0, Math.min(1, command.value));
              player.volume(newVol);
              setVolume(newVol);
              if (newVol > 0) {
                player.muted(false);
                setIsMuted(false);
              } else {
                player.muted(true);
                setIsMuted(true);
              }
            }
            break;
          case 'volumeUp': {
            const upVol = Math.min(1, (player.volume() || 0) + 0.1);
            player.volume(upVol);
            setVolume(upVol);
            if (upVol > 0) {
              player.muted(false);
              setIsMuted(false);
            }
            break;
          }
          case 'volumeDown': {
            const downVol = Math.max(0, (player.volume() || 0) - 0.1);
            player.volume(downVol);
            setVolume(downVol);
            if (downVol === 0) {
              player.muted(true);
              setIsMuted(true);
            }
            break;
          }
          case 'mute':
            const newMuted = !player.muted();
            player.muted(newMuted);
            setIsMuted(newMuted);
            if (!newMuted && player.volume() === 0) {
              player.volume(0.5);
              setVolume(0.5);
            }
            break;
        }
      });

      const unsubRequest = window.electronAPI.onRequestStatusBroadcast(() => {
        broadcastStatus();
      });

      return () => {
        unsubCommand();
        unsubRequest();
      };
    }
  }, [broadcastStatus]);

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
      <div className="relative w-full h-full bg-black flex flex-col items-center justify-center p-8 text-center">
        <div className="mb-6 relative">
          <div className="absolute inset-0 bg-blue-500/20 rounded-full animate-ping" style={{ animationDuration: '2s' }}></div>
          <div className="relative bg-gradient-to-br from-blue-600 to-blue-800 p-6 rounded-full shadow-lg shadow-blue-500/30"><Tv className="w-16 h-16 text-white" /></div>
        </div>
        <h2 className="text-2xl font-bold text-white mb-2">Riproduzione in corso...</h2>
        <p className="text-gray-400 mb-8 max-w-md">Il video è in riproduzione nel player nativo.</p>
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
          <div className="bg-red-900/50 backdrop-blur border border-red-500/50 px-8 py-6 rounded-2xl flex flex-col items-center gap-4 text-center">
            <AlertTriangle className="w-12 h-12 text-red-400" />
            <p className="text-xl font-medium text-white">{error}</p>
            <button onClick={() => { setError(null); if (onBack) onBack(); }} className="px-6 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-lg">Chiudi</button>
          </div>
        </div>
      )}

      {/* PLAYLIST OVERLAY */}
      {channel.type !== 'movie' && (
        <div className={`absolute top-0 right-0 bottom-0 w-80 bg-black/90 backdrop-blur-xl border-l border-white/10 z-[60] transform transition-transform duration-300 flex flex-col ${showPlaylist ? 'translate-x-0' : 'translate-x-full'}`}>
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
                <h3 className="font-bold text-white">Canali ({playlist.length})</h3>
                <button onClick={() => setShowPlaylist(false)} className="p-2 rounded-full hover:bg-white/10"><X className="w-5 h-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {playlist.map(c => (
                    <button 
                      key={c.id}
                      onClick={() => onChannelSelect && onChannelSelect(c)}
                      className={`w-full text-left p-3 rounded-lg flex items-center gap-3 transition-colors ${c.id === channel.id ? 'bg-red-600 text-white' : 'hover:bg-white/10 text-gray-300'}`}
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
            <button onClick={() => setShowAudioMenu(false)} className="p-1 rounded-full hover:bg-white/10"><X className="w-4 h-4 text-gray-400" /></button>
          </div>
          <div className="space-y-1">
            {audioTracks.map((track) => (
              <button
                key={track.id}
                onClick={() => handleAudioTrackChange(track.id)}
                className={`w-full text-left p-3 rounded-xl flex items-center justify-between transition-all ${
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
            <button onClick={onBack} className="p-2 rounded-full bg-white/10 hover:bg-white/20"><X className="w-6 h-6 text-white" /></button>
            <div>
              <h2 className="text-white font-semibold text-lg truncate max-w-md">{channel.cleanName || channel.name}</h2>
              {channel.group && <p className="text-gray-400 text-sm">{channel.group}</p>}
            </div>
          </div>
        </div>
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          {!isPlaying && !isBuffering && (
            <button onClick={togglePlay} className="p-6 rounded-full bg-white/20 hover:bg-white/30 pointer-events-auto"><Play className="w-16 h-16 text-white" fill="white" /></button>
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
                <button onClick={toggleMute} className="p-2 hover:bg-white/10 rounded-full">
                  {isMuted || volume === 0 ? <VolumeX className="w-6 h-6 text-white" /> : <Volume2 className="w-6 h-6 text-white" />}
                </button>
                <div className="w-0 group-hover/vol:w-24 overflow-hidden transition-all duration-300">
                  <input
                    type="range" min="0" max="1" step="0.05" value={isMuted ? 0 : volume}
                    onChange={handleVolumeChange}
                    className="w-full h-1 bg-white/30 rounded-full appearance-none cursor-pointer"
                  />
                </div>
              </div>
              {(channel.type === 'movie' || channel.type === 'series') && currentTime > 30 && (
                <button onClick={restartFromBeginning} className="p-2 hover:bg-white/10 rounded-full" title="Riparti dall'inizio">
                  <RotateCcw className="w-6 h-6 text-white" />
                </button>
              )}
            </div>

            {/* Center Controls */}
            <div className="flex items-center gap-2">
              {onPrev && <button onClick={onPrev} className="p-2 hover:bg-white/10 rounded-full"><SkipBack className="w-6 h-6 text-white" /></button>}
              <button onClick={() => skip(-10)} className="p-2 hover:bg-white/10 rounded-full"><Rewind className="w-6 h-6 text-white" /></button>
              <button onClick={togglePlay} className="p-3 bg-white/10 hover:bg-white/20 rounded-full">{isPlaying ? <Pause className="w-8 h-8 text-white" /> : <Play className="w-8 h-8 text-white" fill="white" />}</button>
              <button onClick={() => skip(10)} className="p-2 hover:bg-white/10 rounded-full"><FastForward className="w-6 h-6 text-white" /></button>
              {onNext && <button onClick={onNext} className="p-2 hover:bg-white/10 rounded-full"><SkipForward className="w-6 h-6 text-white" /></button>}
            </div>

            {/* Right Controls */}
            <div className="flex items-center gap-2">
              {channel.type === 'series' && (
                <button onClick={() => setShowPlaylist(true)} className="p-2 hover:bg-white/10 rounded-full" title="Lista episodi">
                  <List className="w-6 h-6 text-white" />
                </button>
              )}
              {audioTracks.length > 1 && (
                <button 
                  onClick={() => setShowAudioMenu(!showAudioMenu)} 
                  className={`p-2 hover:bg-white/10 rounded-full transition-colors ${showAudioMenu ? 'text-red-500 bg-white/10' : 'text-white'}`}
                  title="Lingue Audio"
                >
                  <Headphones className="w-6 h-6" />
                </button>
              )}
              <button onClick={() => {}} className="p-2 hover:bg-white/10 rounded-full" title="Info Codec">
                <Info className="w-6 h-6 text-white" />
              </button>
              <button
                onClick={() => setShowDevicePicker(true)}
                disabled={isCastLoading || castSession.isConnecting}
                className={`p-2 hover:bg-white/10 rounded-full transition-all ${castSession.isConnected ? 'text-blue-400' : 'text-white'}`}
                title={castSession.isConnected ? `Casting su ${castSession.device?.name}` : 'Trasmetti'}
              >
                {isCastLoading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Cast className="w-6 h-6" />}
              </button>
              {document.pictureInPictureEnabled && (
                <button onClick={togglePiP} className={`p-2 hover:bg-white/10 rounded-full ${isPiP ? 'text-purple-400' : 'text-white'}`} title="Picture-in-Picture">
                  <PictureInPicture2 className="w-6 h-6" />
                </button>
              )}
              <button onClick={toggleFullscreen} className="p-2 hover:bg-white/10 rounded-full">
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
