import React, { useEffect, useRef, useState, useCallback, memo } from 'react';
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

interface CodecInfo {
  videoCodec: string | null;
  audioCodec: string | null;
  width: number | null;
  height: number | null;
  bitrate: number | null;
  frameRate: number | null;
  container: string | null;
  protocol: string | null;
}

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

// --- SUB-COMPONENTS (Defined as functions to prevent ReferenceError in prod builds) ---

function CastOverlayComponent({ session, channel }: { session: any, channel: Channel | null }) {
  if (!session.isConnected) return null;
  
  return (
    <div className="absolute inset-0 z-[100] flex flex-col items-center justify-center bg-gradient-to-b from-black/90 via-black/70 to-black/90">
      <div className="relative mb-6">
        <div className="absolute inset-0 bg-blue-500/20 rounded-full animate-ping" style={{ animationDuration: '2s' }}></div>
        <div className="relative bg-gradient-to-br from-blue-500 to-blue-700 p-6 rounded-full shadow-lg shadow-blue-500/30">
          <Tv className="w-16 h-16 text-white" />
        </div>
      </div>
      <h2 className="text-2xl font-semibold text-white mb-2">Trasmissione su {session.device?.name || 'dispositivo'}</h2>
      <p className="text-gray-400 mb-8">{channel?.cleanName || channel?.name}</p>
      
      <div className="flex items-center gap-3 mb-6">
        <span className={`px-3 py-1 rounded-full text-sm font-medium ${
          session.status.playerState === 'PLAYING' ? 'bg-green-500/20 text-green-400' :
          session.status.playerState === 'PAUSED' ? 'bg-yellow-500/20 text-yellow-400' :
          session.status.playerState === 'BUFFERING' ? 'bg-blue-500/20 text-blue-400' :
          'bg-gray-500/20 text-gray-400'
        }`}>
          {session.status.playerState === 'PLAYING' ? '▶ In riproduzione' :
           session.status.playerState === 'PAUSED' ? '⏸ In pausa' :
           session.status.playerState === 'BUFFERING' ? '⏳ Buffering...' : '⏹ Fermo'}
        </span>
      </div>

      {session.status.duration > 0 && (
        <div className="w-full max-w-xl px-8 mb-6">
          <div className="flex items-center gap-4 text-sm text-gray-400 mb-2">
            <span>{formatTime(session.status.currentTime)}</span>
            <div
              className="flex-1 h-2 bg-white/20 rounded-full cursor-pointer relative group"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const percent = (e.clientX - rect.left) / rect.width;
                session.seek(percent * session.status.duration);
              }}
            >
              <div
                className="absolute h-full bg-blue-500 rounded-full transition-all"
                style={{ width: `${(session.status.currentTime / session.status.duration) * 100}%` }}
              />
            </div>
            <span>{formatTime(session.status.duration)}</span>
          </div>
        </div>
      )}

      <div className="flex items-center gap-6 mb-8">
        <button onClick={() => session.seek(Math.max(0, session.status.currentTime - 10))} className="p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors">
          <Rewind className="w-6 h-6" />
        </button>
        <button onClick={async () => { if (session.status.playerState === 'PLAYING') await session.pause(); else await session.play(); }} className="p-5 rounded-full bg-white text-black hover:bg-gray-200 transition-colors shadow-lg">
          {session.status.playerState === 'PLAYING' ? <Pause className="w-8 h-8" /> : <Play className="w-8 h-8 ml-1" />}
        </button>
        <button onClick={() => session.seek(session.status.currentTime + 10)} className="p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors">
          <FastForward className="w-6 h-6" />
        </button>
        <button onClick={() => session.stop()} className="p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors">
          <StopCircle className="w-6 h-6" />
        </button>
      </div>

      <div className="flex items-center gap-4 w-full max-w-xs px-8 mb-8">
        <button onClick={() => session.setMuted(!session.status.muted)} className="p-2 rounded-full hover:bg-white/10 text-white transition-colors">
          {session.status.muted || session.status.volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
        </button>
        <input
          type="range" min="0" max="1" step="0.05"
          value={session.status.muted ? 0 : session.status.volume}
          onChange={(e) => {
            const val = parseFloat(e.target.value);
            session.setVolume(val);
            if (val > 0 && session.status.muted) session.setMuted(false);
          }}
          className="flex-1 h-2 bg-white/20 rounded-full appearance-none cursor-pointer"
        />
      </div>

      <button onClick={() => session.disconnect()} className="px-6 py-2 bg-red-600 hover:bg-red-500 text-white rounded-full font-medium transition-colors flex items-center gap-2">
        <X className="w-4 h-4" /> Disconnetti
      </button>
    </div>
  );
}
const CastOverlay = memo(CastOverlayComponent);

function StreamInfoOverlayComponent({ info, bitrate, networkSpeed, onClose, currentQuality }: any) {
  return (
    <div className="absolute top-16 right-4 w-80 bg-black/90 backdrop-blur border border-white/10 rounded-xl z-40 overflow-hidden max-h-[80vh] overflow-y-auto animate-fade-in">
      <div className="p-4 border-b border-white/10 flex items-center justify-between sticky top-0 bg-black/90">
        <h3 className="font-bold text-white">Info Stream</h3>
        <button onClick={onClose} className="p-1 hover:bg-white/10 rounded"><X className="w-5 h-5 text-white" /></button>
      </div>
      <div className="p-4 space-y-4 text-sm">
        <div className="bg-white/5 rounded-lg p-3">
          <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">Qualità</h4>
          <div className="flex justify-between items-center">
            <span className="text-white font-medium">{currentQuality}</span>
            {bitrate && <span className="text-green-400">{(bitrate / 1000000).toFixed(2)} Mbps</span>}
          </div>
        </div>
        <div className="bg-white/5 rounded-lg p-3 space-y-2">
          <h4 className="text-xs font-semibold text-gray-400 uppercase">Video</h4>
          <div className="flex justify-between"><span className="text-gray-400">Codec</span><span className="text-white">{info?.videoCodec || 'N/A'}</span></div>
          <div className="flex justify-between"><span className="text-gray-400">Res</span><span className="text-white">{info?.width ? `${info.width}×${info.height}` : 'N/A'}</span></div>
          {info?.frameRate && <div className="flex justify-between"><span className="text-gray-400">FPS</span><span className="text-white">{info.frameRate}</span></div>}
        </div>
        <div className="bg-white/5 rounded-lg p-3 space-y-2">
          <h4 className="text-xs font-semibold text-gray-400 uppercase">Audio</h4>
          <div className="flex justify-between"><span className="text-gray-400">Codec</span><span className="text-white">{info?.audioCodec || 'N/A'}</span></div>
        </div>
        <div className="bg-white/5 rounded-lg p-3 space-y-2">
          <h4 className="text-xs font-semibold text-gray-400 uppercase">Rete</h4>
          <div className="flex justify-between"><span className="text-gray-400">Proto</span><span className="text-white">{info?.protocol || 'N/A'}</span></div>
          {networkSpeed && <div className="flex justify-between"><span className="text-gray-400">Speed</span><span className="text-white">{(networkSpeed / 1000000).toFixed(2)} Mbps</span></div>}
        </div>
      </div>
    </div>
  );
}
const StreamInfoOverlay = memo(StreamInfoOverlayComponent);

function PlaylistOverlayComponent({ playlist, currentId, onSelect, onClose }: any) {
  return (
    <div className="absolute top-0 right-0 bottom-0 w-80 bg-black/95 backdrop-blur z-40 flex flex-col animate-fade-in border-l border-white/10">
      <div className="p-4 border-b border-white/10 flex items-center justify-between">
        <h3 className="font-bold text-white">Playlist</h3>
        <button onClick={onClose} className="p-1 hover:bg-white/10 rounded"><X className="w-5 h-5 text-white" /></button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {playlist.map((item: Channel) => (
          <button
            key={item.id}
            onClick={() => { onSelect(item); onClose(); }}
            className={`w-full p-3 flex items-center gap-3 hover:bg-white/10 transition-colors border-b border-white/5 ${item.id === currentId ? 'bg-white/20' : ''}`}
          >
            {item.logo ? <img src={item.logo} alt="" className="w-10 h-10 object-contain rounded bg-black" /> : <div className="w-10 h-10 bg-gray-700 rounded flex items-center justify-center text-xs text-gray-400">TV</div>}
            <span className="text-white text-sm truncate text-left">{item.cleanName || item.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
const PlaylistOverlay = memo(PlaylistOverlayComponent);

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
}) => {
  // Refs
  const videoRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Player | null>(null);
  const nativeVideoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsTimeoutRef = useRef<number | null>(null);
  const lastProgressUpdate = useRef<number>(0);
  const touchStartRef = useRef<{x: number, y: number, time: number} | null>(null);
  const statsIntervalRef = useRef<number | null>(null);

  // Hooks
  const castSession = useCastSession();

  // State
  const [state, setState] = useState({
    isPlaying: false,
    isBuffering: true,
    currentTime: 0,
    duration: 0,
    volume: 1,
    isMuted: false,
    isFullscreen: false,
    buffered: 0,
    error: null as string | null,
  });

  const [uiState, setUiState] = useState({
    showControls: true,
    showPlaylist: false,
    showStreamInfo: false,
    showQualityMenu: false,
    showSpeedMenu: false,
    showNextButton: false,
    showDevicePicker: false,
    isCastLoading: false,
    isUsingNativePlayer: false,
  });

  const [codecInfo, setCodecInfo] = useState<CodecInfo | null>(null);
  const [currentQuality, setCurrentQuality] = useState<string>('Auto');
  const [availableQualities, setAvailableQualities] = useState<{label: string, height: number, bitrate: number}[]>([]);
  const [liveStats, setLiveStats] = useState({ bitrate: null as number | null, networkSpeed: null as number | null });
  const [seekIndicator, setSeekIndicator] = useState<{direction: 'left' | 'right', seconds: number} | null>(null);
  const [playbackRate, setPlaybackRate] = useState(1);

  const playbackRates = [0.5, 0.75, 1, 1.25, 1.5, 2];

  // --- HELPERS ---

  const updateState = useCallback((updates: Partial<typeof state>) => {
    setState(prev => ({ ...prev, ...updates }));
  }, []);

  const updateUi = useCallback((updates: Partial<typeof uiState>) => {
    setUiState(prev => ({ ...prev, ...updates }));
  }, []);

  const openExternalPlayer = async () => {
    if (!channel?.url) return;
    const videoEl = getVideoElement();
    if (videoEl) videoEl.pause();
    if (playerRef.current) playerRef.current.pause();
    updateState({ isPlaying: false });

    try {
      window.open(channel.url, '_system');
    } catch (e) {
      console.error("Errore apertura player esterno", e);
      updateState({ error: "Impossibile aprire il player esterno" });
    }
  };

  const extractCodecInfo = useCallback((videoEl: HTMLVideoElement, player?: Player) => {
    const info: CodecInfo = {
      videoCodec: null, audioCodec: null, width: videoEl.videoWidth || null, height: videoEl.videoHeight || null,
      bitrate: null, frameRate: null, container: null, protocol: 'Progressive'
    };

    const src = videoEl.src || '';
    if (src.includes('.m3u8')) { info.protocol = 'HLS'; info.container = 'MPEG-TS'; }
    else if (src.includes('.mpd')) { info.protocol = 'DASH'; info.container = 'MP4/WebM'; }
    else if (src.match(/\.(mp4|m4v)/i)) { info.container = 'MP4'; }
    else if (src.match(/\.(mkv)/i)) { info.container = 'MKV'; }

    // Video.js specific checks
    if (player) {
      const tech = player.tech({ IWillNotUseThisInPlugins: true }) as any;
      const vhs = tech?.vhs;
      if (vhs?.playlists?.master?.playlists?.[0]) {
        const attrs = vhs.playlists.master.playlists[0].attributes;
        if (attrs?.CODECS) {
          const parts = attrs.CODECS.split(',');
          info.videoCodec = parts.find((c: string) => c.match(/avc1|hev1|hvc1|vp9|av01/i)) || null;
          info.audioCodec = parts.find((c: string) => c.match(/mp4a|ac-3|ec-3|opus/i)) || null;
        }
        if (attrs?.BANDWIDTH) info.bitrate = attrs.BANDWIDTH;
        if (attrs?.['FRAME-RATE']) info.frameRate = parseFloat(attrs['FRAME-RATE']);
      }
    }

    // Native estimation
    if (!info.frameRate && (videoEl as any).getVideoPlaybackQuality) {
      const q = (videoEl as any).getVideoPlaybackQuality();
      if (q?.totalVideoFrames > 0 && videoEl.currentTime > 0) {
        info.frameRate = Math.round(q.totalVideoFrames / videoEl.currentTime);
      }
    }

    setCodecInfo(info);
  }, []);

  const updateLiveStats = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    const tech = player.tech({ IWillNotUseThisInPlugins: true }) as any;
    const vhs = tech?.vhs;

    if (vhs) {
      setLiveStats({
        bitrate: vhs.bandwidth || null,
        networkSpeed: vhs.stats?.bandwidth || null
      });

      const playlists = vhs.playlists?.master?.playlists;
      if (playlists?.length > 0) {
        const qualities = playlists
          .filter((p: any) => p.attributes?.RESOLUTION)
          .map((p: any) => ({
            label: `${p.attributes.RESOLUTION.height}p`,
            height: p.attributes.RESOLUTION.height,
            bitrate: p.attributes.BANDWIDTH || 0,
          }))
          .sort((a: any, b: any) => b.height - a.height);

        if (qualities.length > 0 && availableQualities.length === 0) {
          setAvailableQualities([{ label: 'Auto', height: 0, bitrate: 0 }, ...qualities]);
        }
      }

      const current = vhs.playlists?.media?.();
      if (current?.attributes?.RESOLUTION) {
        setCurrentQuality(`${current.attributes.RESOLUTION.height}p`);
      }
    }
  }, [availableQualities.length]);

  const changeQuality = useCallback((height: number) => {
    const player = playerRef.current;
    if (!player) return;
    const vhs = (player.tech({ IWillNotUseThisInPlugins: true }) as any)?.vhs;

    if (vhs) {
      if (height === 0) {
        vhs.representations().forEach((rep: any) => rep.enabled(true));
        setCurrentQuality('Auto');
      } else {
        vhs.representations().forEach((rep: any) => rep.enabled(rep.height === height));
        setCurrentQuality(`${height}p`);
      }
    }
    updateUi({ showQualityMenu: false });
  }, [updateUi]);

  // --- INITIALIZATION ---

  useEffect(() => {
    if (!channel) return;

    // Reset
    setState({
      isPlaying: false, isBuffering: true, currentTime: 0, duration: 0,
      volume: 1, isMuted: false, isFullscreen: false, buffered: 0, error: null
    });
    updateUi({ isUsingNativePlayer: false, showNextButton: false });
    
    const source = channel.url;
    const isLive = channel.type === 'live';

    // Native Player (Android/iOS)
    if (platformService.isNative) {
      console.log('[VideoPlayer] Piattaforma nativa, uso ExoPlayer/AVPlayer');
      updateUi({ isUsingNativePlayer: true });
      updateState({ isBuffering: false });

      const handlePlayerExit = () => {
        console.log('[NativePlayer] Evento di uscita ricevuto');
        if (onBack) onBack();
        nativeVideoPlayer.off('exit', handlePlayerExit);
      };

      nativeVideoPlayer.on('exit', handlePlayerExit);
      
      nativeVideoPlayer.play({
        url: source,
        title: channel.cleanName || channel.name || 'Video',
        autoplay: true,
        fullscreen: true,
      }).then(success => {
        if (!success) updateState({ error: 'Impossibile avviare il player nativo' });
      });
      
      return () => {
        nativeVideoPlayer.off('exit', handlePlayerExit);
      };
    }

    // Web/Electron Player
    if (!videoRef.current) return;
    const container = videoRef.current;
    container.innerHTML = '';

    const isHLS = source.toLowerCase().includes('.m3u8');
    const useVideoJS = isHLS || source.toLowerCase().includes('.mpd');

    console.log(`[VideoPlayer] Init Web Player: ${useVideoJS ? 'Video.js' : 'Native HTML5'}`);

    const videoEl = document.createElement('video');
    videoEl.className = useVideoJS ? 'video-js vjs-big-play-centered vjs-fill' : 'w-full h-full bg-black';
    videoEl.autoplay = false;
    videoEl.playsInline = true;
    videoEl.preload = 'metadata';
    container.appendChild(videoEl);

    if (useVideoJS) {
      const options: any = {
        autoplay: false, controls: false, responsive: true, fluid: false, fill: true, preload: 'metadata',
        techOrder: ['html5'], playbackRates,
        html5: {
          vhs: { overrideNative: !platformService.isIOS, enableLowInitialPlaylist: isLive, smoothQualityChange: true },
          nativeVideoTracks: platformService.isIOS, nativeAudioTracks: platformService.isIOS
        },
        sources: [{ src: source, type: isHLS ? 'application/x-mpegURL' : 'application/dash+xml' }],
        liveui: isLive
      };

      try {
        const player = videojs(videoEl, options);
        playerRef.current = player;
        player.ready(() => {
          console.log('[VideoJS] Ready');
          bindEvents(player, videoEl, true);
        });
      } catch (err) {
        console.error('[VideoJS] Init Error:', err);
        updateState({ error: 'Errore inizializzazione player', isBuffering: false });
      }
    } else {
      videoEl.src = source;
      nativeVideoRef.current = videoEl;
      bindEvents(null, videoEl, false);
    }

    return () => {
      if (statsIntervalRef.current) clearInterval(statsIntervalRef.current);
      if (playerRef.current) { playerRef.current.dispose(); playerRef.current = null; }
      if (nativeVideoRef.current) { nativeVideoRef.current.pause(); nativeVideoRef.current.src = ''; nativeVideoRef.current = null; }
      setAvailableQualities([]);
      setCurrentQuality('Auto');
    };
  }, [channel]);

  // --- EVENT BINDING ---

  const bindEvents = (player: Player | null, videoEl: HTMLVideoElement, isVJS: boolean) => {
    const onPlay = () => updateState({ isPlaying: true, isBuffering: false });
    const onPause = () => updateState({ isPlaying: false });
    const onWaiting = () => updateState({ isBuffering: true });
    
    const onTimeUpdate = () => {
      const ct = isVJS ? player!.currentTime() : videoEl.currentTime;
      const dur = isVJS ? player!.duration() : videoEl.duration;
      
      // FIX: Forza isBuffering a false se il tempo avanza
      if (ct > 0) {
        updateState({ currentTime: ct || 0, isBuffering: false });
      } else {
        updateState({ currentTime: ct || 0 });
      }
      
      if (onNext && dur > 0 && dur - ct < 45) updateUi({ showNextButton: true });
      else updateUi({ showNextButton: false });

      const now = Date.now();
      if (onProgress && dur > 0 && (now - lastProgressUpdate.current > 5000)) {
        lastProgressUpdate.current = now;
        onProgress(ct / dur, dur);
      }
    };

    const onLoadedMetadata = () => {
      const dur = isVJS ? player!.duration() : videoEl.duration;
      if (isFinite(dur)) updateState({ duration: dur });

      if (initialProgress && initialProgress > 0 && initialProgress < 0.95 && channel?.type !== 'live') {
        const resumeTime = dur * initialProgress;
        if (resumeTime > 30 && resumeTime < dur - 60) {
          console.log(`[Player] Resuming from ${Math.round(resumeTime)}s`);
          if (isVJS) player!.currentTime(resumeTime);
          else videoEl.currentTime = resumeTime;
        }
      }
      
      if (isVJS) player!.play();
      else videoEl.play().catch(e => {
        if (e.name !== 'NotAllowedError') console.warn('Autoplay failed', e);
      });
    };

    const onEnded = () => {
      if (onProgress && state.duration) onProgress(1, state.duration);
      if (onNext) onNext();
    };

    if (isVJS && player) {
      player.on('play', onPlay);
      player.on('pause', onPause);
      player.on('waiting', onWaiting);
      player.on('timeupdate', onTimeUpdate);
      player.on('loadedmetadata', onLoadedMetadata);
      player.on('ended', onEnded);
      player.on('error', () => updateState({ error: 'Errore di riproduzione', isBuffering: false }));
    } else {
      videoEl.onplay = onPlay;
      videoEl.onpause = onPause;
      videoEl.onwaiting = onWaiting;
      videoEl.ontimeupdate = onTimeUpdate;
      videoEl.onloadedmetadata = onLoadedMetadata;
      videoEl.onended = onEnded;
      videoEl.onerror = () => updateState({ error: 'Errore di riproduzione', isBuffering: false });
    }
  };

  // --- CONTROLS LOGIC ---

  const getVideoElement = (): HTMLVideoElement | null => {
    if (nativeVideoRef.current) return nativeVideoRef.current;
    if (playerRef.current) return (playerRef.current.tech({ IWillNotUseThisInPlugins: true }) as any)?.el();
    return null;
  };

  const togglePlay = () => {
    const el = getVideoElement();
    if (el) {
      if (state.isPlaying) el.pause(); else el.play().catch(console.warn);
    } else if (playerRef.current) {
      if (state.isPlaying) playerRef.current.pause(); else playerRef.current.play();
    }
  };

  const skip = (sec: number) => {
    const el = getVideoElement();
    const target = Math.max(0, Math.min(state.currentTime + sec, state.duration));
    if (el) el.currentTime = target;
    else if (playerRef.current) playerRef.current.currentTime(target);
    
    updateState({ currentTime: target });
    setSeekIndicator({ direction: sec > 0 ? 'right' : 'left', seconds: Math.abs(sec) });
    setTimeout(() => setSeekIndicator(null), 1000);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    const el = getVideoElement();
    if (el) el.currentTime = time;
    else if (playerRef.current) playerRef.current.currentTime(time);
    updateState({ currentTime: time });
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else containerRef.current.requestFullscreen();
    updateState({ isFullscreen: !state.isFullscreen });
  };

  // --- UI EFFECTS ---

  useEffect(() => {
    const show = () => {
      updateUi({ showControls: true });
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
      controlsTimeoutRef.current = window.setTimeout(() => {
        if (state.isPlaying && !uiState.showPlaylist && !uiState.showStreamInfo && !uiState.showQualityMenu) {
          updateUi({ showControls: false });
        }
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
  }, [state.isPlaying, uiState]);

  if (!channel) return <div className="w-full h-full flex items-center justify-center bg-black text-gray-400">Seleziona un canale</div>;

  if (uiState.isUsingNativePlayer) {
    return (
      <div className="relative w-full h-full bg-black flex flex-col items-center justify-center p-8 text-center">
        <div className="mb-6 relative">
          <div className="absolute inset-0 bg-blue-500/20 rounded-full animate-ping" style={{ animationDuration: '2s' }}></div>
          <div className="relative bg-gradient-to-br from-blue-600 to-blue-800 p-6 rounded-full shadow-lg shadow-blue-500/30"><Tv className="w-16 h-16 text-white" /></div>
        </div>
        <h2 className="text-2xl font-bold text-white mb-2">Riproduzione in corso...</h2>
        <p className="text-gray-400 mb-8 max-w-md">Il video è in riproduzione nel player nativo. Premi il tasto "Indietro" del dispositivo per tornare all'app.</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative w-full h-full bg-black overflow-hidden select-none" onDoubleClick={toggleFullscreen}>
      <div ref={videoRef} className="w-full h-full bg-black" />

      {/* OVERLAYS */}
      {liveStats.bitrate && state.isPlaying && (
        <div className="absolute top-4 right-4 z-10 bg-black/60 rounded px-2 py-1 text-xs text-white/70 font-mono">
          {currentQuality !== 'Auto' && <span className="mr-2">{currentQuality}</span>}
          <span>{(liveStats.bitrate / 1000000).toFixed(1)} Mbps</span>
        </div>
      )}

      {state.isBuffering && !state.error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-20">
          <Loader2 className="w-16 h-16 text-white animate-spin" />
        </div>
      )}

      {uiState.showNextButton && onNext && (
        <div className="absolute bottom-24 right-8 z-40 animate-fade-in">
          <button onClick={onNext} className="flex items-center gap-3 bg-white text-black px-6 py-3 rounded-lg font-bold shadow-lg hover:scale-105 transition-transform">
            <span>Prossimo episodio</span><SkipForward className="w-5 h-5 fill-black" />
          </button>
        </div>
      )}

      <CastOverlay session={castSession} channel={channel} />

      {uiState.showStreamInfo && <StreamInfoOverlay info={codecInfo} bitrate={liveStats.bitrate} networkSpeed={liveStats.networkSpeed} currentQuality={currentQuality} onClose={() => updateUi({ showStreamInfo: false })} />}
      
      {uiState.showPlaylist && <PlaylistOverlay playlist={playlist} currentId={channel.id} onSelect={onChannelSelect} onClose={() => updateUi({ showPlaylist: false })} />}

      {state.error && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/90">
          <div className="bg-red-900/50 backdrop-blur border border-red-500/50 px-8 py-6 rounded-2xl flex flex-col items-center gap-4 text-center">
            <AlertTriangle className="w-12 h-12 text-red-400" />
            <p className="text-xl font-medium text-white">{state.error}</p>
            <button onClick={() => { updateState({ error: null }); if (onBack) onBack(); }} className="px-6 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-lg">Chiudi</button>
          </div>
        </div>
      )}

      {/* CONTROLS BAR */}
      <div className={`absolute inset-0 z-30 transition-opacity duration-300 ${uiState.showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        <div className="absolute top-0 left-0 right-0 p-4 bg-gradient-to-b from-black/80 to-transparent flex justify-between items-center">
          <div className="flex items-center gap-4">
            <button onClick={onBack} className="p-2 rounded-full bg-white/10 hover:bg-white/20"><X className="w-6 h-6 text-white" /></button>
            <div>
              <h2 className="text-white font-semibold text-lg truncate max-w-md">{channel.cleanName || channel.name}</h2>
              {channel.group && <p className="text-gray-400 text-sm">{channel.group}</p>}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => updateUi({ showStreamInfo: !uiState.showStreamInfo })} className="p-2 rounded-full bg-white/10 hover:bg-white/20"><Info className="w-5 h-5 text-white" /></button>
            {playlist.length > 1 && <button onClick={() => updateUi({ showPlaylist: !uiState.showPlaylist })} className="p-2 rounded-full bg-white/10 hover:bg-white/20"><List className="w-5 h-5 text-white" /></button>}
          </div>
        </div>

        {/* Center Play */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          {!state.isPlaying && !state.isBuffering && (
            <button onClick={togglePlay} className="p-6 rounded-full bg-white/20 hover:bg-white/30 pointer-events-auto"><Play className="w-16 h-16 text-white" fill="white" /></button>
          )}
        </div>

        {/* Bottom Bar */}
        <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent">
          {channel.type !== 'live' && state.duration > 0 && (
            <div className="mb-4">
              <div className="relative h-1 bg-white/20 rounded-full overflow-hidden group cursor-pointer">
                <div className="absolute h-full bg-white/40" style={{ width: `${state.buffered}%` }} />
                <div className="absolute h-full bg-red-500" style={{ width: `${(state.currentTime / state.duration) * 100}%` }} />
                <input type="range" min={0} max={state.duration} value={state.currentTime} onChange={handleSeek} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
              </div>
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>{formatTime(state.currentTime)}</span><span>{formatTime(state.duration)}</span>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {onPrev && <button onClick={onPrev} className="p-2 hover:bg-white/10 rounded-full"><SkipBack className="w-6 h-6 text-white" /></button>}
              <button onClick={() => skip(-10)} className="p-2 hover:bg-white/10 rounded-full"><Rewind className="w-6 h-6 text-white" /></button>
              <button onClick={togglePlay} className="p-3 bg-white/10 hover:bg-white/20 rounded-full">{state.isPlaying ? <Pause className="w-8 h-8 text-white" /> : <Play className="w-8 h-8 text-white" fill="white" />}</button>
              <button onClick={() => skip(10)} className="p-2 hover:bg-white/10 rounded-full"><FastForward className="w-6 h-6 text-white" /></button>
              {onNext && <button onClick={onNext} className="p-2 hover:bg-white/10 rounded-full"><SkipForward className="w-6 h-6 text-white" /></button>}
              
              <div className="flex items-center gap-2 ml-4 group relative">
                <button onClick={() => { const v = state.isMuted ? state.volume : 0; updateState({ isMuted: !state.isMuted }); if(videoRef.current) { const el = getVideoElement(); if(el) el.muted = !state.isMuted; } }} className="p-2 hover:bg-white/10 rounded-full">
                  {state.isMuted || state.volume === 0 ? <VolumeX className="w-6 h-6 text-white" /> : <Volume2 className="w-6 h-6 text-white" />}
                </button>
                <input 
                  type="range" min="0" max="1" step="0.05" value={state.isMuted ? 0 : state.volume} 
                  onChange={(e) => { 
                    const v = parseFloat(e.target.value); 
                    updateState({ volume: v, isMuted: v === 0 }); 
                    const el = getVideoElement(); 
                    if(el) { el.volume = v; el.muted = v === 0; } 
                  }} 
                  className="w-0 group-hover:w-20 transition-all h-1 bg-white/20 rounded-full appearance-none cursor-pointer" 
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              {availableQualities.length > 1 && (
                <div className="relative">
                  <button onClick={() => updateUi({ showQualityMenu: !uiState.showQualityMenu })} className="px-2 py-1 rounded hover:bg-white/10 text-white text-sm font-medium">{currentQuality}</button>
                  {uiState.showQualityMenu && (
                    <div className="absolute bottom-full right-0 mb-2 bg-black/95 rounded-lg border border-white/10 overflow-hidden min-w-[120px]">
                      {availableQualities.map((q) => (
                        <button key={q.label} onClick={() => changeQuality(q.height)} className={`w-full px-4 py-2 text-left text-sm hover:bg-white/10 ${currentQuality === q.label ? 'text-green-400' : 'text-white'}`}>
                          {q.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {!platformService.isNative && (
                <button onClick={openExternalPlayer} className="p-2 hover:bg-white/10 rounded-full" title="Apri player esterno"><ExternalLink className="w-5 h-5 text-white" /></button>
              )}

              <button onClick={() => castSession.isConnected ? null : updateUi({ showDevicePicker: true })} disabled={uiState.isCastLoading || castSession.isConnecting} className={`p-2 hover:bg-white/10 rounded-full ${castSession.isConnected ? 'text-blue-400' : 'text-white'}`}>
                {uiState.isCastLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Cast className="w-5 h-5" />}
              </button>

              <button onClick={toggleFullscreen} className="p-2 hover:bg-white/10 rounded-full">
                {state.isFullscreen ? <Minimize className="w-6 h-6 text-white" /> : <Maximize className="w-6 h-6 text-white" />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {channel && (
        <CastDevicePicker
          isOpen={uiState.showDevicePicker}
          onClose={() => updateUi({ showDevicePicker: false })}
          mediaUrl={channel.url}
          mediaTitle={channel.cleanName || channel.name}
          mediaPoster={channel.logo}
          onDeviceSelect={async (device) => {
            updateUi({ isCastLoading: true });
            const connected = await castSession.connect(device);
            if (connected) {
              const loaded = await castSession.loadMedia(channel.url, channel.cleanName || channel.name);
              if (loaded) { const el = getVideoElement(); if (el) el.pause(); }
            }
            updateUi({ isCastLoading: false });
            return connected;
          }}
        />
      )}
    </div>
  );
};

export default VideoPlayerNew;
