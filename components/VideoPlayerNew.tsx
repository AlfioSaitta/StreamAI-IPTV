import React, { useEffect, useRef, useState, useCallback } from 'react';
import videojs from 'video.js';
import 'video.js/dist/video-js.css';
// import { AppLauncher } from '@capacitor/app-launcher'; // Rimosso perché non usato e causa errore di build


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
import Player from 'video.js/dist/types/player';

// Tipo per le informazioni del codec
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

  // Cast hooks
  const castSession = useCastSession();

  // State
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPlaylist, setShowPlaylist] = useState(false);
  const [showStreamInfo, setShowStreamInfo] = useState(false);
  const [codecInfo, setCodecInfo] = useState<CodecInfo | null>(null);
  const [buffered, setBuffered] = useState(0);
  const [currentQuality, setCurrentQuality] = useState<string>('Auto');
  const [availableQualities, setAvailableQualities] = useState<{label: string, height: number, bitrate: number}[]>([]);
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [liveBitrate, setLiveBitrate] = useState<number | null>(null);
  const [networkSpeed, setNetworkSpeed] = useState<number | null>(null);
  const [seekIndicator, setSeekIndicator] = useState<{direction: 'left' | 'right', seconds: number} | null>(null);
  const [isUsingNativePlayer, setIsUsingNativePlayer] = useState(false);
  const [showNextButton, setShowNextButton] = useState(false);

  // Cast state
  const [isCastLoading, setIsCastLoading] = useState(false);
  const [showDevicePicker, setShowDevicePicker] = useState(false);

  // Playback speed state
  const [playbackRate, setPlaybackRate] = useState(1);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const playbackRates = [0.5, 0.75, 1, 1.25, 1.5, 2];

  // Refs per timeout
  const controlsTimeoutRef = useRef<number | null>(null);
  const lastProgressUpdate = useRef<number>(0);
  const touchStartRef = useRef<{x: number, y: number, time: number} | null>(null);
  const statsIntervalRef = useRef<number | null>(null);

  // Formatta il tempo in mm:ss o hh:mm:ss
  const formatTime = (seconds: number): string => {
    if (!isFinite(seconds) || seconds < 0) return '0:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // Funzione per aprire il player esterno (VLC/MX Player)
  const openExternalPlayer = async () => {
    if (!channel?.url) return;
    
    // Mette in pausa il player interno
    const videoEl = getVideoElement();
    if (videoEl) videoEl.pause();
    if (playerRef.current) playerRef.current.pause();
    setIsPlaying(false);

    try {
      // Fallback a window.open se AppLauncher non è disponibile
      window.open(channel.url, '_system');
    } catch (e) {
      console.error("Errore apertura player esterno", e);
      setError("Impossibile aprire il player esterno");
    }
  };

  // Rileva informazioni sul codec
  const detectCodecInfo = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;

    const tech = player.tech({ IWillNotUseThisInPlugins: true }) as any;
    const videoEl = tech?.el() as HTMLVideoElement | undefined;

    const info: CodecInfo = {
      videoCodec: null,
      audioCodec: null,
      width: videoEl?.videoWidth || null,
      height: videoEl?.videoHeight || null,
      bitrate: null,
      frameRate: null,
      container: null,
      protocol: null,
    };

    // Rileva protocollo dall'URL
    const src = player.currentSrc() || '';
    if (src.includes('.m3u8')) {
      info.protocol = 'HLS';
      info.container = 'MPEG-TS';
    } else if (src.includes('.mpd')) {
      info.protocol = 'DASH';
      info.container = 'MP4/WebM';
    } else if (src.match(/\.(mp4|m4v)/i)) {
      info.protocol = 'Progressive';
      info.container = 'MP4';
    } else if (src.match(/\.(mkv)/i)) {
      info.protocol = 'Progressive';
      info.container = 'MKV';
    } else if (src.match(/\.(webm)/i)) {
      info.protocol = 'Progressive';
      info.container = 'WebM';
    } else if (src.match(/\.(ts|mpeg)/i)) {
      info.protocol = 'MPEG-TS';
      info.container = 'MPEG-TS';
    }

    // Prova a rilevare codec da VHS (Video.js HTTP Streaming)
    const vhs = tech?.vhs;
    if (vhs) {
      const master = vhs.playlists?.master;
      if (master?.playlists?.[0]) {
        const playlist = master.playlists[0];
        const codecs = playlist.attributes?.CODECS;
        if (codecs) {
          const codecParts = codecs.split(',');
          for (const codec of codecParts) {
            const c = codec.trim().toLowerCase();
            if (c.startsWith('avc1')) {
              info.videoCodec = 'H.264/AVC';
            } else if (c.startsWith('hev1') || c.startsWith('hvc1')) {
              info.videoCodec = 'H.265/HEVC';
            } else if (c.startsWith('av01')) {
              info.videoCodec = 'AV1';
            } else if (c.startsWith('vp9') || c.startsWith('vp09')) {
              info.videoCodec = 'VP9';
            } else if (c.startsWith('mp4a')) {
              info.audioCodec = 'AAC';
            } else if (c.startsWith('ac-3')) {
              info.audioCodec = 'AC-3';
            } else if (c.startsWith('ec-3')) {
              info.audioCodec = 'E-AC-3';
            } else if (c.startsWith('opus')) {
              info.audioCodec = 'Opus';
            }
          }
        }
        if (playlist.attributes?.BANDWIDTH) {
          info.bitrate = playlist.attributes.BANDWIDTH;
        }
        if (playlist.attributes?.['FRAME-RATE']) {
          info.frameRate = parseFloat(playlist.attributes['FRAME-RATE']);
        }
      }
    }

    // Stima frame rate dal video element
    if (!info.frameRate && videoEl) {
      const quality = (videoEl as any).getVideoPlaybackQuality?.();
      if (quality && quality.totalVideoFrames > 0 && videoEl.currentTime > 0) {
        info.frameRate = Math.round(quality.totalVideoFrames / videoEl.currentTime);
      }
    }

    setCodecInfo(info);
    console.log('[VideoJS] Codec info:', info);
  }, []);

  // Rileva codec per player nativo
  const detectNativeCodecInfo = useCallback((videoEl: HTMLVideoElement, source: string) => {
    const info: CodecInfo = {
      videoCodec: null,
      audioCodec: null,
      width: videoEl.videoWidth || null,
      height: videoEl.videoHeight || null,
      bitrate: null,
      frameRate: null,
      container: source.match(/\.(\w+)(\?|$)/)?.[1]?.toUpperCase() || null,
      protocol: 'Progressive',
    };

    // Stima frame rate
    const quality = (videoEl as any).getVideoPlaybackQuality?.();
    if (quality && quality.totalVideoFrames > 0 && videoEl.currentTime > 1) {
      info.frameRate = Math.round(quality.totalVideoFrames / videoEl.currentTime);
    }

    setCodecInfo(info);
  }, []);

  // Aggiorna statistiche in tempo reale
  const updateLiveStats = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;

    const tech = player.tech({ IWillNotUseThisInPlugins: true }) as any;
    const vhs = tech?.vhs;

    if (vhs) {
      // Bitrate corrente
      const currentBandwidth = vhs.bandwidth;
      if (currentBandwidth) {
        setLiveBitrate(currentBandwidth);
      }

      // Qualità disponibili
      const playlists = vhs.playlists?.master?.playlists;
      if (playlists && playlists.length > 0) {
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

      // Qualità corrente
      const currentPlaylist = vhs.playlists?.media?.();
      if (currentPlaylist?.attributes?.RESOLUTION) {
        setCurrentQuality(`${currentPlaylist.attributes.RESOLUTION.height}p`);
      }

      // Velocità di rete stimata
      const stats = vhs.stats;
      if (stats?.bandwidth) {
        setNetworkSpeed(stats.bandwidth);
      }
    }
  }, [availableQualities.length]);

  // Cambia qualità video
  const changeQuality = useCallback((height: number) => {
    const player = playerRef.current;
    if (!player) return;

    const tech = player.tech({ IWillNotUseThisInPlugins: true }) as any;
    const vhs = tech?.vhs;

    if (vhs) {
      if (height === 0) {
        // Auto
        vhs.representations().forEach((rep: any) => rep.enabled(true));
        setCurrentQuality('Auto');
      } else {
        // Qualità specifica
        vhs.representations().forEach((rep: any) => {
          rep.enabled(rep.height === height);
        });
        setCurrentQuality(`${height}p`);
      }
    }
    setShowQualityMenu(false);
  }, []);

  // Inizializza il player
  useEffect(() => {
    if (!channel) return;

    // Reset stato
    setError(null);
    setIsBuffering(true);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setIsUsingNativePlayer(false);
    setShowNextButton(false);

    const source = channel.url;
    const isLive = channel.type === 'live';
    const srcLower = source.toLowerCase();

    // === NATIVE PLAYER (ANDROID/IOS) HANDLING ===
    if (platformService.isNative) {
      console.log('[VideoPlayer] Native platform detected, using internal native player');
      setIsUsingNativePlayer(true);
      setIsBuffering(false);

      const handlePlayerExit = () => {
        console.log('[NativePlayer] Exit event received');
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
        if (!success) {
          setError('Impossibile avviare il player nativo');
        }
      });
      
      return () => {
        nativeVideoPlayer.off('exit', handlePlayerExit);
      };
    }

    // === WEB / ELECTRON PLAYER HANDLING ===
    if (!videoRef.current) return;

    // Determina se usare Video.js (per HLS/DASH) o player nativo (per file progressivi)
    const isHLS = srcLower.includes('.m3u8');
    const isDASH = srcLower.includes('.mpd');
    const useVideoJS = isHLS || isDASH;

    console.log('[VideoPlayer] Initializing for:', source.substring(0, 80));
    console.log('[VideoPlayer] Type:', isHLS ? 'HLS' : isDASH ? 'DASH' : 'Progressive', 'isLive:', isLive);

    // Pulisci il container
    const container = videoRef.current;
    container.innerHTML = '';

    if (useVideoJS) {
      // === USA VIDEO.JS PER HLS/DASH ===

      // Crea elemento video per Video.js
      const videoEl = document.createElement('video');
      videoEl.className = 'video-js vjs-big-play-centered vjs-fill';
      videoEl.playsInline = true;
      container.appendChild(videoEl);

      const sourceType = isHLS ? 'application/x-mpegURL' : 'application/dash+xml';

      const options: any = {
        autoplay: false, // Disabilita autoplay per evitare download iniziale
        controls: false,
        responsive: true,
        fluid: false,
        fill: true,
        preload: 'metadata', // Carica solo i metadati inizialmente
        techOrder: ['html5'],
        playbackRates: [0.5, 0.75, 1, 1.25, 1.5, 2], // Velocità di riproduzione
        html5: {
          vhs: {
            overrideNative: !platformService.isIOS,
            enableLowInitialPlaylist: isLive,
            smoothQualityChange: true,
            allowSeeksWithinUnsafeLiveWindow: true,
            handleManifestRedirects: true,
            maxPlaylistRetries: 5,
            bandwidth: 5000000,
            useBandwidthFromLocalStorage: true,
            limitRenditionByPlayerDimensions: true,
            useDevicePixelRatio: true,
          },
          nativeVideoTracks: platformService.isIOS,
          nativeAudioTracks: platformService.isIOS,
          nativeTextTracks: platformService.isIOS,
        },
        sources: [{
          src: source,
          type: sourceType,
        }],
        liveui: isLive,
        liveTracker: isLive ? {
          trackingThreshold: 0,
          liveTolerance: 15,
        } : undefined,
      };

      try {
        const player = videojs(videoEl, options);
        playerRef.current = player;

        player.ready(function(this: Player) {
          console.log('[VideoJS] Player ready');

          setupPlayerEvents(this);
        });
      } catch (err) {
        console.error('[VideoJS] Failed to initialize:', err);
        setError('Errore inizializzazione player');
        setIsBuffering(false);
      }

    } else {
      // === USA PLAYER NATIVO HTML5 PER FILE PROGRESSIVI ===

      // Crea elemento video
      const videoEl = document.createElement('video');
      videoEl.className = 'w-full h-full';
      videoEl.style.backgroundColor = '#000';
      videoEl.autoplay = false; // Disabilita autoplay
      videoEl.playsInline = true;
      videoEl.preload = 'metadata'; // Carica solo metadati

      container.appendChild(videoEl);

      // Setup eventi per player nativo
      setupNativeVideoEvents(videoEl, source, isLive);

      // Salva riferimento
      nativeVideoRef.current = videoEl;

      // Imposta la sorgente
      videoEl.src = source;
      
      // Non chiamiamo play() qui, lo faremo dopo il seek in onloadedmetadata
    }

    // Cleanup
    return () => {
      // Ferma intervallo statistiche
      if (statsIntervalRef.current) {
        clearInterval(statsIntervalRef.current);
        statsIntervalRef.current = null;
      }

      if (playerRef.current) {
        console.log('[VideoJS] Disposing player');
        try {
          playerRef.current.dispose();
        } catch (e) {
          console.warn('[VideoJS] Dispose error:', e);
        }
        playerRef.current = null;
      }
      if (nativeVideoRef.current) {
        console.log('[NativeVideo] Cleaning up');
        nativeVideoRef.current.pause();
        nativeVideoRef.current.src = '';
        nativeVideoRef.current.load();
        nativeVideoRef.current = null;
      }

      // Reset stati
      setAvailableQualities([]);
      setCurrentQuality('Auto');
      setLiveBitrate(null);
      setNetworkSpeed(null);
    };
  }, [channel]);

  // Setup eventi per Video.js player
  const setupPlayerEvents = (player: Player) => {
    player.on('play', () => {
      setIsPlaying(true);
      setIsBuffering(false);
    });

    player.on('pause', () => {
      setIsPlaying(false);
    });

    player.on('waiting', () => {
      setIsBuffering(true);
    });

    player.on('canplay', () => {
      setIsBuffering(false);
    });

    player.on('playing', () => {
      setIsBuffering(false);
      setIsPlaying(true);
      setTimeout(() => detectCodecInfo(), 1000);

      // Avvia monitoraggio statistiche per HLS
      if (!statsIntervalRef.current) {
        statsIntervalRef.current = window.setInterval(() => {
          updateLiveStats();
        }, 2000);
      }
    });

    player.on('timeupdate', () => {
      const ct = player.currentTime() || 0;
      const dur = player.duration() || 0;
      setCurrentTime(ct);

      // Mostra pulsante "Prossimo episodio" se mancano meno di 45 secondi
      if (onNext && dur > 0 && dur - ct < 45) {
        setShowNextButton(true);
      } else {
        setShowNextButton(false);
      }

      const now = Date.now();
      if (onProgress && dur > 0 && (now - lastProgressUpdate.current > 5000)) {
        lastProgressUpdate.current = now;
        onProgress(ct / dur, dur);
      }
    });

    player.on('durationchange', () => {
      setDuration(player.duration() || 0);
    });

    player.on('loadedmetadata', () => {
      const dur = player.duration() || 0;
      setDuration(dur);

      if (initialProgress && initialProgress > 0 && initialProgress < 0.95 && channel?.type !== 'live') {
        const resumeTime = dur * initialProgress;
        if (resumeTime > 30 && resumeTime < dur - 60) {
          console.log(`[VideoJS] Resuming from ${Math.round(resumeTime)}s`);
          player.currentTime(resumeTime);
        }
      }
      
      // Avvia la riproduzione DOPO aver impostato il tempo
      player.play();
    });

    player.on('progress', () => {
      const buf = player.buffered();
      if (buf && buf.length > 0) {
        const end = buf.end(buf.length - 1);
        const dur = player.duration() || 1;
        setBuffered((end / dur) * 100);
      }
    });

    player.on('volumechange', () => {
      setVolume(player.volume() || 0);
      setIsMuted(player.muted() || false);
    });

    player.on('fullscreenchange', () => {
      setIsFullscreen(player.isFullscreen() || false);
    });

    player.on('ended', () => {
      if (onProgress && player.duration()) {
        onProgress(1, player.duration()!);
      }
      if (onNext) onNext();
    });

    player.on('error', () => {
      const err = player.error();
      console.error('[VideoJS] Error:', err);

      let errorMsg = 'Errore di riproduzione';
      if (err) {
        switch (err.code) {
          case 1:
            errorMsg = 'Riproduzione interrotta';
            break;
          case 2:
            errorMsg = 'Errore di rete';
            break;
          case 3:
            errorMsg = 'Codec non supportato';
            break;
          case 4:
            errorMsg = 'Formato non supportato';
            break;
        }
      }
      setError(errorMsg);
      setIsBuffering(false);
    });
  };

  // Setup eventi per player video nativo
  const setupNativeVideoEvents = (videoEl: HTMLVideoElement, source: string, isLive: boolean) => {
    videoEl.onplay = () => {
      setIsPlaying(true);
      setIsBuffering(false);
    };

    videoEl.onpause = () => {
      setIsPlaying(false);
    };

    videoEl.onwaiting = () => {
      setIsBuffering(true);
    };

    videoEl.oncanplay = () => {
      setIsBuffering(false);
    };

    videoEl.onplaying = () => {
      setIsBuffering(false);
      setIsPlaying(true);
      // Rileva info codec usando la funzione dedicata
      setTimeout(() => {
        detectNativeCodecInfo(videoEl, source);
      }, 500);
    };

    videoEl.ontimeupdate = () => {
      const ct = videoEl.currentTime;
      const dur = videoEl.duration || 0;
      setCurrentTime(ct);

      // Mostra pulsante "Prossimo episodio" se mancano meno di 45 secondi
      if (onNext && dur > 0 && dur - ct < 45) {
        setShowNextButton(true);
      } else {
        setShowNextButton(false);
      }

      const now = Date.now();
      if (onProgress && dur > 0 && isFinite(dur) && (now - lastProgressUpdate.current > 5000)) {
        lastProgressUpdate.current = now;
        onProgress(ct / dur, dur);
      }
    };

    videoEl.ondurationchange = () => {
      if (isFinite(videoEl.duration)) {
        setDuration(videoEl.duration);
      }
    };

    videoEl.onloadedmetadata = () => {
      if (isFinite(videoEl.duration)) {
        setDuration(videoEl.duration);

        if (initialProgress && initialProgress > 0 && initialProgress < 0.95 && !isLive) {
          const resumeTime = videoEl.duration * initialProgress;
          if (resumeTime > 30 && resumeTime < videoEl.duration - 60) {
            console.log(`[NativeVideo] Resuming from ${Math.round(resumeTime)}s`);
            videoEl.currentTime = resumeTime;
          }
        }
        
        // Avvia la riproduzione DOPO aver impostato il tempo
        videoEl.play().catch((err) => {
          console.warn('[NativeVideo] Autoplay failed:', err);
          if (err.name !== 'NotAllowedError') {
            handlePlaybackError(err, source);
          }
        });
      }
    };

    videoEl.onprogress = () => {
      if (videoEl.buffered.length > 0 && isFinite(videoEl.duration)) {
        const end = videoEl.buffered.end(videoEl.buffered.length - 1);
        setBuffered((end / videoEl.duration) * 100);
      }
    };

    videoEl.onvolumechange = () => {
      setVolume(videoEl.volume);
      setIsMuted(videoEl.muted);
    };

    videoEl.onended = () => {
      if (onProgress && isFinite(videoEl.duration)) {
        onProgress(1, videoEl.duration);
      }
      if (onNext) onNext();
    };

    videoEl.onerror = () => {
      handlePlaybackError(videoEl.error, source);
    };
  };

  // Gestione errori di riproduzione
  const handlePlaybackError = (err: any, source: string) => {
    console.error('[Video] Playback error:', err);

    let errorMsg = 'Errore di riproduzione';

    if (err instanceof MediaError || err?.code) {
      const code = err.code;
      switch (code) {
        case MediaError.MEDIA_ERR_ABORTED:
          errorMsg = 'Riproduzione interrotta';
          break;
        case MediaError.MEDIA_ERR_NETWORK:
          errorMsg = 'Errore di rete';
          break;
        case MediaError.MEDIA_ERR_DECODE:
          errorMsg = 'Codec non supportato';
          break;
        case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
          errorMsg = 'Formato non supportato';
          break;
      }
    }

    setError(errorMsg);
    setIsBuffering(false);
  };

  // Gestione controlli visibilità
  useEffect(() => {
    const hideControls = () => {
      if (isPlaying && !showPlaylist && !showStreamInfo && !showQualityMenu && !showSpeedMenu && !showNextButton) {
        setShowControls(false);
      }
    };

    const showControlsHandler = () => {
      setShowControls(true);
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
      controlsTimeoutRef.current = window.setTimeout(hideControls, 3000);
    };

    const container = containerRef.current;
    if (container) {
      container.addEventListener('mousemove', showControlsHandler);
      container.addEventListener('touchstart', showControlsHandler);
    }

    return () => {
      if (container) {
        container.removeEventListener('mousemove', showControlsHandler);
        container.removeEventListener('touchstart', showControlsHandler);
      }
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    };
  }, [isPlaying, showPlaylist, showStreamInfo, showQualityMenu, showSpeedMenu, showNextButton]);

  // Gesture touch per mobile
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      touchStartRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        time: Date.now()
      };
    }
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current) return;

    const touch = e.changedTouches[0];
    const deltaX = touch.clientX - touchStartRef.current.x;
    const deltaY = touch.clientY - touchStartRef.current.y;
    const deltaTime = Date.now() - touchStartRef.current.time;

    // Ignora se il gesto è troppo lento (> 500ms)
    if (deltaTime > 500) {
      touchStartRef.current = null;
      return;
    }

    const absDeltaX = Math.abs(deltaX);
    const absDeltaY = Math.abs(deltaY);

    // Swipe orizzontale per seek (> 50px)
    if (absDeltaX > 50 && absDeltaX > absDeltaY * 2) {
      const seekAmount = deltaX > 0 ? 10 : -10;
      skip(seekAmount);
      setSeekIndicator({direction: deltaX > 0 ? 'right' : 'left', seconds: 10});
      // Nascondi dopo 1 secondo
      setTimeout(() => setSeekIndicator(null), 1000);
    }
    // Swipe verticale per volume (> 50px, solo sul lato destro dello schermo)
    else if (absDeltaY > 50 && absDeltaY > absDeltaX * 2) {
      const container = containerRef.current;
      if (container && touchStartRef.current.x > container.clientWidth / 2) {
        const videoEl = getVideoElement();
        if (videoEl) {
          const volumeChange = deltaY > 0 ? -0.1 : 0.1;
          videoEl.volume = Math.max(0, Math.min(1, videoEl.volume + volumeChange));
        }
      }
    }
    // Double tap per play/pause

    touchStartRef.current = null;
  }, []);

  // Helper per ottenere l'elemento video corrente
  const getVideoElement = (): HTMLVideoElement | null => {
    if (nativeVideoRef.current) {
      return nativeVideoRef.current;
    }
    if (playerRef.current) {
      const tech = playerRef.current.tech({ IWillNotUseThisInPlugins: true }) as any;
      return tech?.el() as HTMLVideoElement | null;
    }
    return null;
  };

  // Controlli player - funzionano con entrambi i player
  const togglePlay = () => {
    const videoEl = getVideoElement();
    if (videoEl) {
      if (isPlaying) {
        videoEl.pause();
      } else {
        videoEl.play().catch(console.warn);
      }
      return;
    }

    // Fallback a Video.js API
    const player = playerRef.current;
    if (player) {
      if (isPlaying) {
        player.pause();
      } else {
        player.play();
      }
    }
  };

  // Cambia velocità di riproduzione
  const changePlaybackRate = (rate: number) => {
    const videoEl = getVideoElement();
    if (videoEl) {
      videoEl.playbackRate = rate;
      setPlaybackRate(rate);
    } else if (playerRef.current) {
      playerRef.current.playbackRate(rate);
      setPlaybackRate(rate);
    }
    setShowSpeedMenu(false);
  };

  const toggleMute = () => {
    const videoEl = getVideoElement();
    if (videoEl) {
      videoEl.muted = !videoEl.muted;
      return;
    }

    const player = playerRef.current;
    if (player) {
      player.muted(!isMuted);
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseFloat(e.target.value);

    const videoEl = getVideoElement();
    if (videoEl) {
      videoEl.volume = newVolume;
      if (newVolume > 0 && videoEl.muted) {
        videoEl.muted = false;
      }
      return;
    }

    const player = playerRef.current;
    if (player) {
      player.volume(newVolume);
      if (newVolume > 0 && isMuted) {
        player.muted(false);
      }
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);

    const videoEl = getVideoElement();
    if (videoEl) {
      videoEl.currentTime = time;
      setCurrentTime(time);
      return;
    }

    const player = playerRef.current;
    if (player) {
      player.currentTime(time);
      setCurrentTime(time);
    }
  };

  const skip = (seconds: number) => {
    const videoEl = getVideoElement();
    if (videoEl) {
      const newTime = Math.max(0, Math.min(videoEl.currentTime + seconds, duration));
      videoEl.currentTime = newTime;
      return;
    }

    const player = playerRef.current;
    if (player) {
      const newTime = Math.max(0, Math.min((player.currentTime() || 0) + seconds, duration));
      player.currentTime(newTime);
    }
  };

  const toggleFullscreen = () => {
    const container = containerRef.current;
    if (!container) return;

    if (isFullscreen) {
      document.exitFullscreen?.();
      setIsFullscreen(false);
    } else {
      container.requestFullscreen?.();
      setIsFullscreen(true);
    }
  };

  const togglePiP = async () => {
    const videoEl = getVideoElement();

    if (videoEl && 'requestPictureInPicture' in videoEl) {
      try {
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture();
        } else {
          await videoEl.requestPictureInPicture();
        }
      } catch (e) {
        console.error('[Video] PiP error:', e);
      }
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;

      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          skip(-10);
          break;
        case 'ArrowRight':
          e.preventDefault();
          skip(10);
          break;
        case 'ArrowUp':
          e.preventDefault();
          {
            const videoEl = getVideoElement();
            if (videoEl) {
              videoEl.volume = Math.min(1, videoEl.volume + 0.1);
            } else if (playerRef.current) {
              playerRef.current.volume(Math.min(1, (volume || 0) + 0.1));
            }
          }
          break;
        case 'ArrowDown':
          e.preventDefault();
          {
            const videoEl = getVideoElement();
            if (videoEl) {
              videoEl.volume = Math.max(0, videoEl.volume - 0.1);
            } else if (playerRef.current) {
              playerRef.current.volume(Math.max(0, (volume || 0) - 0.1));
            }
          }
          break;
        case 'm':
          e.preventDefault();
          toggleMute();
          break;
        case 'f':
          e.preventDefault();
          toggleFullscreen();
          break;
        case 'Escape':
          if (showQualityMenu) setShowQualityMenu(false);
          else if (showSpeedMenu) setShowSpeedMenu(false);
          else if (showPlaylist) setShowPlaylist(false);
          else if (showStreamInfo) setShowStreamInfo(false);
          else if (onBack) onBack();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [volume, showPlaylist, showStreamInfo, showQualityMenu, showSpeedMenu, onBack]);

  if (!channel) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-black">
        <p className="text-gray-400">Seleziona un canale</p>
      </div>
    );
  }

  // Se siamo su Android/iOS e stiamo usando il player nativo, mostra una UI di placeholder
  if (isUsingNativePlayer) {
    return (
      <div className="relative w-full h-full bg-black flex flex-col items-center justify-center p-8 text-center">
        <div className="mb-6 relative">
          <div className="absolute inset-0 bg-blue-500/20 rounded-full animate-ping" style={{ animationDuration: '2s' }}></div>
          <div className="relative bg-gradient-to-br from-blue-600 to-blue-800 p-6 rounded-full shadow-lg shadow-blue-500/30">
            <Tv className="w-16 h-16 text-white" />
          </div>
        </div>
        
        <h2 className="text-2xl font-bold text-white mb-2">Riproduzione in corso...</h2>
        <p className="text-gray-400 mb-8 max-w-md">
          Il video è in riproduzione nel player nativo. Premi il tasto "Indietro" del dispositivo per tornare all'app.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full bg-black overflow-hidden select-none"
      onDoubleClick={toggleFullscreen}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Video container */}
      <div ref={videoRef} className="w-full h-full bg-black" />

      {/* Live stats overlay (top-right, sempre visibile durante streaming) */}
      {(liveBitrate || networkSpeed) && isPlaying && (
        <div className="absolute top-4 right-4 z-10 bg-black/60 rounded px-2 py-1 text-xs text-white/70 font-mono">
          {currentQuality !== 'Auto' && <span className="mr-2">{currentQuality}</span>}
          {liveBitrate && <span>{(liveBitrate / 1000000).toFixed(1)} Mbps</span>}
        </div>
      )}

      {/* Buffering indicator */}
      {isBuffering && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-20">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="w-16 h-16 text-white animate-spin" />
            <p className="text-white text-lg">Caricamento...</p>
            {liveBitrate && (
              <p className="text-white/60 text-sm">{(liveBitrate / 1000000).toFixed(1)} Mbps</p>
            )}
          </div>
        </div>
      )}

      {/* Next Episode Button Overlay */}
      {showNextButton && onNext && (
        <div className="absolute bottom-24 right-8 z-40 animate-fade-in">
          <button
            onClick={onNext}
            className="flex items-center gap-3 bg-white text-black px-6 py-3 rounded-lg font-bold shadow-lg hover:bg-gray-200 transition-transform hover:scale-105"
          >
            <span>Prossimo episodio</span>
            <SkipForward className="w-5 h-5 fill-black" />
          </button>
        </div>
      )}

      {/* CAST OVERLAY - Mostra quando c'è una sessione Cast attiva */}
      {castSession.isConnected && (
        <div
          className="absolute inset-0 z-[100] flex flex-col items-center justify-center bg-gradient-to-b from-black/90 via-black/70 to-black/90"
        >
          {/* Cast Icon Animation */}
          <div className="relative mb-6">
            <div className="absolute inset-0 bg-blue-500/20 rounded-full animate-ping" style={{ animationDuration: '2s' }}></div>
            <div className="relative bg-gradient-to-br from-blue-500 to-blue-700 p-6 rounded-full shadow-lg shadow-blue-500/30">
              <Tv className="w-16 h-16 text-white" />
            </div>
          </div>

          {/* Device Info */}
          <h2 className="text-2xl font-semibold text-white mb-2">
            Trasmissione su {castSession.device?.name || 'dispositivo'}
          </h2>
          <p className="text-gray-400 mb-8">{channel?.cleanName || channel?.name}</p>

          {/* Playback Status */}
          <div className="flex items-center gap-3 mb-6">
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${
              castSession.status.playerState === 'PLAYING' ? 'bg-green-500/20 text-green-400' :
              castSession.status.playerState === 'PAUSED' ? 'bg-yellow-500/20 text-yellow-400' :
              castSession.status.playerState === 'BUFFERING' ? 'bg-blue-500/20 text-blue-400' :
              'bg-gray-500/20 text-gray-400'
            }`}>
              {castSession.status.playerState === 'PLAYING' ? '▶ In riproduzione' :
               castSession.status.playerState === 'PAUSED' ? '⏸ In pausa' :
               castSession.status.playerState === 'BUFFERING' ? '⏳ Buffering...' :
               '⏹ Fermo'}
            </span>
          </div>

          {/* Progress Bar */}
          {castSession.status.duration > 0 && (
            <div className="w-full max-w-xl px-8 mb-6">
              <div className="flex items-center gap-4 text-sm text-gray-400 mb-2">
                <span>{formatTime(castSession.status.currentTime)}</span>
                <div
                  className="flex-1 h-2 bg-white/20 rounded-full cursor-pointer relative group"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const percent = (e.clientX - rect.left) / rect.width;
                    castSession.seek(percent * castSession.status.duration);
                  }}
                >
                  <div
                    className="absolute h-full bg-blue-500 rounded-full transition-all"
                    style={{ width: `${(castSession.status.currentTime / castSession.status.duration) * 100}%` }}
                  />
                </div>
                <span>{formatTime(castSession.status.duration)}</span>
              </div>
            </div>
          )}

          {/* Playback Controls */}
          <div className="flex items-center gap-6 mb-8">
            {/* Rewind 10s */}
            <button
              onClick={() => castSession.seek(Math.max(0, castSession.status.currentTime - 10))}
              className="p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
              title="Indietro 10s"
            >
              <Rewind className="w-6 h-6" />
            </button>

            {/* Play/Pause */}
            <button
              onClick={async () => {
                if (castSession.status.playerState === 'PLAYING') {
                  await castSession.pause();
                } else {
                  await castSession.play();
                }
              }}
              className="p-5 rounded-full bg-white text-black hover:bg-gray-200 transition-colors shadow-lg"
            >
              {castSession.status.playerState === 'PLAYING' ?
                <Pause className="w-8 h-8" /> :
                <Play className="w-8 h-8 ml-1" />
              }
            </button>

            {/* Forward 10s */}
            <button
              onClick={() => castSession.seek(castSession.status.currentTime + 10)}
              className="p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
              title="Avanti 10s"
            >
              <FastForward className="w-6 h-6" />
            </button>

            {/* Stop */}
            <button
              onClick={() => castSession.stop()}
              className="p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
              title="Stop"
            >
              <StopCircle className="w-6 h-6" />
            </button>
          </div>

          {/* Volume Control */}
          <div className="flex items-center gap-4 w-full max-w-xs px-8 mb-8">
            <button
              onClick={() => castSession.setMuted(!castSession.status.muted)}
              className="p-2 rounded-full hover:bg-white/10 text-white transition-colors"
            >
              {castSession.status.muted || castSession.status.volume === 0 ?
                <VolumeX className="w-5 h-5" /> :
                <Volume2 className="w-5 h-5" />
              }
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={castSession.status.muted ? 0 : castSession.status.volume}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                castSession.setVolume(val);
                if (val > 0 && castSession.status.muted) {
                  castSession.setMuted(false);
                }
              }}
              className="flex-1 h-2 bg-white/20 rounded-full appearance-none cursor-pointer"
            />
            <span className="text-sm text-gray-400 w-10 text-right">
              {Math.round((castSession.status.muted ? 0 : castSession.status.volume) * 100)}%
            </span>
          </div>

          {/* Disconnect Button */}
          <button
            onClick={() => castSession.disconnect()}
            className="px-6 py-2 bg-red-600 hover:bg-red-500 text-white rounded-full font-medium transition-colors flex items-center gap-2"
          >
            <X className="w-4 h-4" />
            Disconnetti
          </button>
        </div>
      )}

      {/* Custom Controls */}
      <div
        className={`absolute inset-0 z-30 transition-opacity duration-300 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Top bar */}
        <div className="absolute top-0 left-0 right-0 p-4 bg-gradient-to-b from-black/80 to-transparent">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={onBack}
                className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
              >
                <X className="w-6 h-6 text-white" />
              </button>
              <div>
                <h2 className="text-white font-semibold text-lg truncate max-w-md">
                  {channel.cleanName || channel.name}
                </h2>
                {channel.group && (
                  <p className="text-gray-400 text-sm">{channel.group}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowStreamInfo(!showStreamInfo)}
                className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
              >
                <Info className="w-5 h-5 text-white" />
              </button>
              {playlist.length > 1 && (
                <button
                  onClick={() => setShowPlaylist(!showPlaylist)}
                  className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
                >
                  <List className="w-5 h-5 text-white" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Center play button */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          {!isPlaying && !isBuffering && (
            <button
              onClick={togglePlay}
              className="p-6 rounded-full bg-white/20 hover:bg-white/30 transition-colors pointer-events-auto"
            >
              <Play className="w-16 h-16 text-white" fill="white" />
            </button>
          )}
        </div>

        {/* Bottom controls */}
        <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent">
          {/* Progress bar */}
          {channel.type !== 'live' && duration > 0 && (
            <div className="mb-4">
              <div className="relative h-1 bg-white/20 rounded-full overflow-hidden group cursor-pointer">
                {/* Buffered */}
                <div
                  className="absolute h-full bg-white/40 rounded-full"
                  style={{ width: `${buffered}%` }}
                />
                {/* Progress */}
                <div
                  className="absolute h-full bg-red-500 rounded-full"
                  style={{ width: `${(currentTime / duration) * 100}%` }}
                />
                <input
                  type="range"
                  min={0}
                  max={duration}
                  value={currentTime}
                  onChange={handleSeek}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
              </div>
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>
          )}

          {/* Control buttons */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {/* Prev */}
              {onPrev && (
                <button
                  onClick={onPrev}
                  className="p-2 rounded-full hover:bg-white/10 transition-colors"
                >
                  <SkipBack className="w-6 h-6 text-white" />
                </button>
              )}

              {/* Rewind */}
              <button
                onClick={() => skip(-10)}
                className="p-2 rounded-full hover:bg-white/10 transition-colors"
              >
                <Rewind className="w-6 h-6 text-white" />
              </button>

              {/* Play/Pause */}
              <button
                onClick={togglePlay}
                className="p-3 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
              >
                {isPlaying ? (
                  <Pause className="w-8 h-8 text-white" />
                ) : (
                  <Play className="w-8 h-8 text-white" fill="white" />
                )}
              </button>

              {/* Forward */}
              <button
                onClick={() => skip(10)}
                className="p-2 rounded-full hover:bg-white/10 transition-colors"
              >
                <FastForward className="w-6 h-6 text-white" />
              </button>

              {/* Next */}
              {onNext && (
                <button
                  onClick={onNext}
                  className="p-2 rounded-full hover:bg-white/10 transition-colors"
                >
                  <SkipForward className="w-6 h-6 text-white" />
                </button>
              )}

              {/* Volume */}
              <div className="flex items-center gap-2 ml-4">
                <button
                  onClick={toggleMute}
                  className="p-2 rounded-full hover:bg-white/10 transition-colors"
                >
                  {isMuted || volume === 0 ? (
                    <VolumeX className="w-6 h-6 text-white" />
                  ) : (
                    <Volume2 className="w-6 h-6 text-white" />
                  )}
                </button>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={isMuted ? 0 : volume}
                  onChange={handleVolumeChange}
                  className="w-20 h-1 bg-white/20 rounded-full appearance-none cursor-pointer"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Quality selector */}
              {availableQualities.length > 1 && (
                <div className="relative">
                  <button
                    onClick={() => setShowQualityMenu(!showQualityMenu)}
                    className="px-2 py-1 rounded hover:bg-white/10 transition-colors text-white text-sm font-medium"
                  >
                    {currentQuality}
                  </button>
                  {showQualityMenu && (
                    <div className="absolute bottom-full right-0 mb-2 bg-black/95 rounded-lg border border-white/10 overflow-hidden min-w-[120px]">
                      {availableQualities.map((q) => (
                        <button
                          key={q.label}
                          onClick={() => changeQuality(q.height)}
                          className={`w-full px-4 py-2 text-left text-sm hover:bg-white/10 transition-colors ${
                            currentQuality === q.label ? 'text-green-400' : 'text-white'
                          }`}
                        >
                          {q.label}
                          {q.bitrate > 0 && (
                            <span className="text-white/50 ml-2 text-xs">
                              {(q.bitrate / 1000000).toFixed(1)}M
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Speed selector - solo per VOD */}
              {channel.type !== 'live' && (
                <div className="relative">
                  <button
                    onClick={() => setShowSpeedMenu(!showSpeedMenu)}
                    className="px-2 py-1 rounded hover:bg-white/10 transition-colors text-white text-sm font-medium"
                    title="Velocità di riproduzione"
                  >
                    {playbackRate === 1 ? '1x' : `${playbackRate}x`}
                  </button>
                  {showSpeedMenu && (
                    <div className="absolute bottom-full right-0 mb-2 bg-black/95 rounded-lg border border-white/10 overflow-hidden min-w-[80px]">
                      {playbackRates.map((rate) => (
                        <button
                          key={rate}
                          onClick={() => changePlaybackRate(rate)}
                          className={`w-full px-4 py-2 text-left text-sm hover:bg-white/10 transition-colors ${
                            playbackRate === rate ? 'text-green-400' : 'text-white'
                          }`}
                        >
                          {rate === 1 ? 'Normale' : `${rate}x`}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Reset progress */}
              {onResetProgress && channel.type !== 'live' && (
                <button
                  onClick={onResetProgress}
                  className="p-2 rounded-full hover:bg-white/10 transition-colors"
                  title="Ricomincia dall'inizio"
                >
                  <RotateCcw className="w-5 h-5 text-white" />
                </button>
              )}

              {/* External Player (VLC/MX) - Salvavita per compatibilità */}
              {platformService.isNative && (
                <button
                  onClick={openExternalPlayer}
                  className="p-2 rounded-full hover:bg-white/10 transition-colors"
                  title="Apri con player esterno (VLC)"
                >
                  <ExternalLink className="w-5 h-5 text-white" />
                </button>
              )}

              {/* Cast */}
              <button
                onClick={() => castSession.isConnected ? null : setShowDevicePicker(true)}
                disabled={isCastLoading || castSession.isConnecting}
                className={`p-2 rounded-full hover:bg-white/10 transition-colors ${
                  castSession.isConnected ? 'text-blue-400' : 'text-white'
                } ${isCastLoading || castSession.isConnecting ? 'opacity-50' : ''}`}
                title={castSession.isConnected ? `Casting su ${castSession.device?.name}` : 'Trasmetti'}
              >
                {isCastLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Cast className="w-5 h-5" />}
              </button>

              {/* PiP */}
              {'pictureInPictureEnabled' in document && (
                <button
                  onClick={togglePiP}
                  className="p-2 rounded-full hover:bg-white/10 transition-colors"
                >
                  <PictureInPicture2 className="w-5 h-5 text-white" />
                </button>
              )}

              {/* Fullscreen */}
              <button
                onClick={toggleFullscreen}
                className="p-2 rounded-full hover:bg-white/10 transition-colors"
              >
                {isFullscreen ? (
                  <Minimize className="w-6 h-6 text-white" />
                ) : (
                  <Maximize className="w-6 h-6 text-white" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Cast Device Picker Modal */}
      {channel && (
        <CastDevicePicker
          isOpen={showDevicePicker}
          onClose={() => setShowDevicePicker(false)}
          mediaUrl={channel.url}
          mediaTitle={channel.cleanName || channel.name}
          mediaPoster={channel.logo}
          onDeviceSelect={async (device) => {
            console.log('[VideoPlayer] Connecting to device:', device);
            setIsCastLoading(true);

            const connected = await castSession.connect(device);
            if (!connected) {
              setIsCastLoading(false);
              return false;
            }

            const loaded = await castSession.loadMedia(channel.url, channel.cleanName || channel.name);
            setIsCastLoading(false);

            if (loaded) {
              // Pause local video
              const videoEl = getVideoElement();
              if (videoEl) {
                videoEl.pause();
              }
            }

            return loaded;
          }}
          onCastStart={() => {
            setIsCastLoading(true);
          }}
          onCastSuccess={() => {
            setIsCastLoading(false);
          }}
          onCastError={() => {
            setIsCastLoading(false);
          }}
        />
      )}
    </div>
  );
};

export default VideoPlayerNew;
