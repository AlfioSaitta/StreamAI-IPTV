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
  PictureInPicture2, Loader2, Info, Cast, Tv, StopCircle, ExternalLink
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
  const [networkSpeed, setNetworkSpeed] = useState<number | null>(null);
  const [bytesReceived, setBytesReceived] = useState(0);

  // Hooks
  const castSession = useCastSession();

  // --- CONTROLS LOGIC ---

  const togglePlay = useCallback(() => {
    if (playerRef.current) {
      if (playerRef.current.paused()) {
        playerRef.current.play();
      } else {
        playerRef.current.pause();
      }
    }
  }, []);

  const skip = useCallback((seconds: number) => {
    if (playerRef.current) {
      const newTime = (playerRef.current.currentTime() || 0) + seconds;
      playerRef.current.currentTime(Math.max(0, newTime));
    }
  }, []);

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (playerRef.current) {
      playerRef.current.currentTime(parseFloat(e.target.value));
    }
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      containerRef.current.requestFullscreen();
    }
  }, []);

  const toggleMute = useCallback(() => {
    if (playerRef.current) {
      playerRef.current.muted(!playerRef.current.muted());
      setIsMuted(playerRef.current.muted());
    }
  }, []);

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseFloat(e.target.value);
    if (playerRef.current) {
      playerRef.current.volume(newVolume);
      setVolume(newVolume);
      if (newVolume > 0 && isMuted) {
        playerRef.current.muted(false);
        setIsMuted(false);
      }
    }
  }, [isMuted]);

  const togglePiP = useCallback(async () => {
    const videoElement = playerRef.current?.el()?.querySelector('video');
    if (!videoElement) return;

    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        setIsPiP(false);
      } else if (document.pictureInPictureEnabled) {
        await videoElement.requestPictureInPicture();
        setIsPiP(true);
      }
    } catch (err) {
      console.error("PiP error:", err);
    }
  }, []);

  const restartFromBeginning = () => {
    if (playerRef.current) {
      playerRef.current.currentTime(0);
      if (onResetProgress) onResetProgress();
    }
  };

  // --- INITIALIZATION & EVENT HANDLING ---

  useEffect(() => {
    if (!channel) return;

    // Reset state for new channel
    setIsPlaying(false);
    setIsBuffering(true);
    setCurrentTime(0);
    setDuration(0);
    setError(null);
    setIsUsingNativePlayer(false);
    setShowPlaylist(false);

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

    player.on('play', () => { setIsPlaying(true); setIsBuffering(false); });
    player.on('pause', () => setIsPlaying(false));
    player.on('waiting', () => setIsBuffering(true));
    player.on('playing', () => setIsBuffering(false));
    player.on('volumechange', () => {
      if (!player.isDisposed()) {
        setVolume(player.volume());
        setIsMuted(player.muted());
      }
    });
    player.on('timeupdate', () => {
      if (!player.isDisposed()) {
        setCurrentTime(player.currentTime() || 0);
        if (onProgress) onProgress(player.currentTime() || 0, player.duration() || 0);
        if (isBuffering && player.currentTime() > 0) setIsBuffering(false);
      }
    });
    player.on('durationchange', () => {
      if (!player.isDisposed()) setDuration(player.duration() || 0);
    });
    player.on('fullscreenchange', () => {
      if (!player.isDisposed()) setIsFullscreen(player.isFullscreen());
    });
    player.on('loadedmetadata', () => {
      if (player.isDisposed()) return;
      const dur = player.duration() || 0;
      setDuration(dur);
      if (initialProgress && initialProgress > 0.05 && initialProgress < 0.95) {
        player.currentTime(dur * initialProgress);
      }
      player.play().catch(e => console.warn("Autoplay bloccato:", e));
    });
    player.on('ended', () => { if (onNext) onNext(); });
    player.on('error', () => {
       const err = player.error();
       console.error("VideoJS Error:", err);
       
       // Fallback logic for common codec/source errors
       if (err?.code === 4 || err?.code === 3) {
          setError('Errore di decodifica o rete. Prova un altro canale.');
       } else {
          setError('Errore di riproduzione');
       }
    });

    // PiP Events
    videoEl.addEventListener('enterpictureinpicture', () => setIsPiP(true));
    videoEl.addEventListener('leavepictureinpicture', () => setIsPiP(false));

    // Broadcast network status
    if (platformService.isElectron && window.electronAPI) {
      networkStatusIntervalRef.current = window.setInterval(() => {
        if (player && !player.isDisposed()) {
          // Monitor network speed
          const stats = (player.tech({ IWillNotUseThisInPlugins: true }) as any)?.vhs?.stats;
          if (stats && stats.bandwidth) {
             setNetworkSpeed(stats.bandwidth / 1024 / 1024); // Mbps
          }

          // Check if player is playing safely
          if (!player.paused()) {
            window.electronAPI.updatePlaybackStatus({
              channelName: channel.name,
              currentTime: player.currentTime(),
              duration: player.duration(),
            });
          }
        }
      }, 2000);
    }

    return () => {
      if (networkStatusIntervalRef.current) clearInterval(networkStatusIntervalRef.current);
      videoEl.removeEventListener('enterpictureinpicture', () => setIsPiP(true));
      videoEl.removeEventListener('leavepictureinpicture', () => setIsPiP(false));
      if (playerRef.current) {
        playerRef.current.dispose();
        playerRef.current = null;
      }
    };
  }, [channel, initialProgress, onBack, onNext, onProgress]);

  // Remote Control Handler
  useEffect(() => {
    if (platformService.isElectron && window.electronAPI) {
      const unsubscribe = window.electronAPI.onRemoteControlCommand((command) => {
        const player = playerRef.current;
        if (!player || player.isDisposed()) return;

        switch (command.action) {
          case 'play': player.play(); break;
          case 'pause': player.pause(); break;
          case 'seek': if (typeof command.value === 'number') player.currentTime(command.value); break;
          case 'skip': if (typeof command.value === 'number') player.currentTime(player.currentTime() + command.value); break;
        }
      });
      return unsubscribe;
    }
  }, []);

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
              <div className="relative h-1 bg-white/20 rounded-full overflow-hidden group cursor-pointer">
                <div className="absolute h-full bg-red-500" style={{ width: `${(currentTime / duration) * 100}%` }} />
                <input type="range" min={0} max={duration} value={currentTime} onChange={handleSeek} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
              </div>
              <div className="flex justify-between text-xs text-gray-400 mt-1">
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
          onDeviceSelect={async (device) => {
            setIsCastLoading(true);
            const connected = await castSession.connect(device);
            if (!connected) {
              setIsCastLoading(false);
              return false;
            }
            const loaded = await castSession.loadMedia(channel.url, channel.cleanName || channel.name, channel.logo);
            setIsCastLoading(false);
            if (loaded) {
              playerRef.current?.pause();
            }
            return loaded;
          }}
        />
      )}
    </div>
  );
};

export default VideoPlayerNew;
