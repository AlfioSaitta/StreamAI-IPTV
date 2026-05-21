// Web player engine hook (Video.js + hls.js + mpegts.js).
// Extracted from components/VideoPlayerNew.tsx — refactor B.1 (engine pluggable).
// Behavior preserved 1:1: same hls.js / mpegts.js / videojs wiring, same retry logic.

import { useEffect } from 'react';
import type { MutableRefObject, ReactNode } from 'react';
import { createElement } from 'react';
import videojs from 'video.js';
import Hls from 'hls.js';
import mpegts from 'mpegts.js';
import type Player from 'video.js/dist/types/player';
import { AlertTriangle } from 'lucide-react';

import type { Channel } from '../types';
import { platformService } from '../services/platformService';
import { host } from '../services/hostBridge';
import { streamInfoService } from '../services/streamInfoService';
import { probeVodSource, type VodProbeResult } from '../services/streamInfo/vodProbe';
import {
  type PlaybackErrorState,
  type StreamSourceInfo,
} from '../components/player/playerTypes';
import { classifyPlaybackError } from '../components/player/playerUtils';

export interface WebPlayerEngineOptions {
  channel: Channel | null;
  detectedSource: StreamSourceInfo | null;
  initialProgress?: number;
  retryNonce: number;
  onNext?: () => void;
  onProgress?: (currentTime: number, duration: number) => void;

  // Refs owned by the component
  videoRef: MutableRefObject<HTMLDivElement | null>;
  playerRef: MutableRefObject<Player | null>;
  hlsRef: MutableRefObject<Hls | null>;
  mpegtsRef: MutableRefObject<any>;
  loadTimeoutRef: MutableRefObject<number | null>;
  networkStatusIntervalRef: MutableRefObject<number | null>;
  retryCountRef: MutableRefObject<number>;

  // State setters
  setIsPlaying: (v: boolean) => void;
  setIsBuffering: (v: boolean) => void;
  setCurrentTime: (v: number) => void;
  setDuration: (v: number) => void;
  setVolume: (v: number) => void;
  setIsMuted: (v: boolean) => void;
  setIsFullscreen: (v: boolean) => void;
  setNetworkSpeed: (v: number | null) => void;
  setAudioTracks: (v: any[]) => void;
  setError: (v: string | null) => void;
  setPlaybackError: (v: PlaybackErrorState | null) => void;
  setIsPiP: (v: boolean) => void;

  // Helpers from the component
  showOsd: (icon: ReactNode, text?: string) => void;
  scheduleRetry: (err: PlaybackErrorState) => void;
  cleanupPlaybackEngines: () => void;
  broadcastStatus: (force?: boolean) => void;

  /**
   * Optional callback invoked once the asynchronous VOD probe (HEAD + tail
   * prefetch) completes. Lets the UI degrade gracefully when the server
   * doesn't support Range or when the real Content-Type is unsupported
   * (e.g. MKV / x-matroska).
   */
  onVodProbeResult?: (result: VodProbeResult) => void;

  /**
   * Flag describing the current "isBuffering" state at effect setup time.
   * Used by the original timeout heuristic in `loadTimeoutRef`.
   * The original effect captured `isBuffering` from the closure, so we keep
   * the same semantics by passing the value explicitly.
   */
  isBuffering: boolean;
}

/**
 * Sets up the Video.js / hls.js / mpegts.js playback chain for the web/Electron
 * renderer. No-op on native (Capacitor) platforms or when channel/detectedSource
 * is missing.
 */
export const useWebPlayerEngine = (opts: WebPlayerEngineOptions): void => {
  const {
    channel,
    detectedSource,
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
    onVodProbeResult,
  } = opts;

  useEffect(() => {
    if (platformService.isNative) return;
    if (!channel || !detectedSource) return;
    if (!videoRef.current) return;

    const source = channel.url;
    const container = videoRef.current;
    container.innerHTML = '';

    const videoEl = document.createElement('video');
    videoEl.className = 'video-js vjs-big-play-centered vjs-fill';
    videoEl.playsInline = true;
    container.appendChild(videoEl);

    if (detectedSource.engine === 'hlsjs') {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: channel.type === 'live',
        backBufferLength: channel.type === 'live' ? 30 : 90,
      });
      hlsRef.current = hls;
      hls.attachMedia(videoEl);
      hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(source));
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data?.fatal) return;
        const httpStatus = data?.response?.code ? ` HTTP ${data.response.code}` : '';
        const hlsError = classifyPlaybackError(videoEl.error, detectedSource, source, retryCountRef.current, 'hlsjs', `${data.type}: ${data.details}${httpStatus}`);
        setPlaybackError(hlsError);
        setError(hlsError.message);
        showOsd(createElement(AlertTriangle, { className: 'w-12 h-12 text-white' }), hlsError.title);
        scheduleRetry(hlsError);
      });
    }

    if (detectedSource.engine === 'mpegts') {
      const tsPlayer = mpegts.createPlayer({ type: 'mpegts', url: source, isLive: detectedSource.isLive });
      mpegtsRef.current = tsPlayer;
      tsPlayer.attachMediaElement(videoEl);
      tsPlayer.load();
      tsPlayer.on(mpegts.Events.ERROR, (type: string, details: string) => {
        const tsError = classifyPlaybackError(videoEl.error, detectedSource, source, retryCountRef.current, 'mpegts', `${type}: ${details}`);
        setPlaybackError(tsError);
        setError(tsError.message);
        showOsd(createElement(AlertTriangle, { className: 'w-12 h-12 text-white' }), tsError.title);
        scheduleRetry(tsError);
      });
    }

    // URG-1 L2: for VOD progressive sources (videojs engine on a likely MP4),
    // warm the moov cache asynchronously and probe Range support so the UI
    // can degrade gracefully if the server refuses Range. Fire-and-forget —
    // we never block the player on this.
    const isVodProgressive = detectedSource.engine === 'videojs'
      && !detectedSource.isLive
      && (channel.type === 'movie' || channel.type === 'series');
    if (isVodProgressive) {
      probeVodSource(source, { prefetchTail: true })
        .then(result => {
          onVodProbeResult?.(result);
          if (result.rangeSupport === 'no') {
            showOsd(
              createElement(AlertTriangle, { className: 'w-12 h-12 text-white' }),
              'Server senza Range: seek non disponibile',
            );
            return;
          }
          // Real Content-Type may reveal a container the videojs progressive
          // engine cannot play correctly. Note: Matroska/MKV è supportato
          // nativamente da Chromium (e quindi da Electron, anche con FFmpeg
          // patchato per HEVC) finché non dichiariamo `video/x-matroska`
          // come `type` della source — vedi MKV-FIX in questo stesso file.
          // Non emettiamo più un warning su MKV per evitare falsi allarmi.
          const ct = (result.contentType ?? '').toLowerCase();
          if (ct.includes('mp2t') && !detectedSource.isLive) {
            showOsd(
              createElement(AlertTriangle, { className: 'w-12 h-12 text-white' }),
              'MPEG-TS senza indici: il seek può essere lento',
            );
          }
        })
        .catch(() => undefined);
    }

    // MKV-FIX (2026-05-16, rev. 2): non basta omettere il `type` dalla source
    // perché Video.js inferisce comunque il MIME dall'estensione `.mkv`
    // tramite il suo middleware "getMimetype" e finisce per chiamare
    // `videoEl.canPlayType('video/x-matroska')`, che in Chromium torna ""
    // → MEDIA_ERR_SRC_NOT_SUPPORTED (code 4 / "No compatible source was
    // found").
    // Soluzione: per MKV bypassiamo del tutto la negoziazione di Video.js
    // (inizializziamo con `sources: []`) e poi, una volta che il player è
    // ready, assegniamo l'URL direttamente all'elemento <video>
    // sottostante. In questo modo Chromium chiama solo `load()` e fa lo
    // sniffing della firma EBML del container — operazione che riesce
    // sempre se il demuxer Matroska è compilato in (lo è in Electron,
    // anche con la build FFmpeg patchata da BranchBit per HEVC). Se i
    // codec interni non sono supportati arriverà un MEDIA_ERR_DECODE
    // (code 3) ben più informativo del MEDIA_ERR_SRC_NOT_SUPPORTED
    // attuale.
    const bypassVideojsSource =
      detectedSource.engine === 'videojs' && detectedSource.protocol === 'mkv';

    // Per gli altri protocolli che usano l'engine videojs evitiamo di
    // dichiarare un `type` quando il MIME rilevato è "incerto"
    // (protocollo `unknown`, MIME generico tipo `application/octet-stream`):
    // meglio nessun MIME che un MIME sbagliato, così Chromium sniffa.
    const shouldDeclareType =
      detectedSource.engine === 'videojs'
      && detectedSource.protocol !== 'mkv'
      && detectedSource.protocol !== 'unknown'
      && !!detectedSource.mimeType
      && detectedSource.mimeType !== 'application/octet-stream';
    const videojsSources = bypassVideojsSource
      ? []
      : detectedSource.engine === 'videojs'
        ? [shouldDeclareType ? { src: source, type: detectedSource.mimeType } : { src: source }]
        : [];

    const player = videojs(videoEl, {
      autoplay: false,
      controls: false,
      responsive: true,
      fluid: true,
      // URG-1 L2: VOD needs `auto` so the browser can fetch the moov index
      // (especially for non-faststart MP4s where the index lives at the end
      // of the file). Live keeps `metadata` to avoid wasting bandwidth.
      preload: isVodProgressive ? 'auto' : 'metadata',
      sources: videojsSources,
    });
    playerRef.current = player;

    // MKV-FIX (rev. 2): una volta che Video.js è pronto, forziamo l'URL
    // direttamente sull'elemento <video> aggirando del tutto il middleware
    // di Video.js (che fallirebbe la negoziazione di MIME `video/x-matroska`
    // su Chromium). `player.ready()` garantisce che la tech HTML5 sia
    // già montata, quindi l'evento `loadedmetadata` viene comunque
    // propagato attraverso il player.
    if (bypassVideojsSource) {
      player.ready(() => {
        if (player.isDisposed()) return;
        const techEl = (player.tech({ IWillNotUseThisInPlugins: true }) as any)?.el?.() as HTMLVideoElement | null;
        const target = techEl ?? videoEl;
        target.setAttribute('data-mkv-bypass', 'true');
        if (target.src !== source) {
          target.src = source;
          target.load();
        }
      });
    }

    loadTimeoutRef.current = window.setTimeout(() => {
      if (player.isDisposed() || (player.currentTime() || 0) > 0 || !isBuffering) return;
      const timeoutError = classifyPlaybackError(player.error() ?? null, detectedSource, source, retryCountRef.current, detectedSource.engine, 'timeout iniziale caricamento metadata');
      setPlaybackError(timeoutError);
      setError(timeoutError.message);
      showOsd(createElement(AlertTriangle, { className: 'w-12 h-12 text-white' }), timeoutError.title);
      scheduleRetry(timeoutError);
    }, 18000);

    // Initial broadcast to announce existence
    broadcastStatus();

    // Audio track utility — declared before being used by 'loadedmetadata' below
    const tracks = player.audioTracks() as any;
    const updateAudioTracksList = () => {
      const tracksList: any[] = [];
      for (let i = 0; i < tracks.length; i++) {
        tracksList.push({
          id: tracks[i].id,
          label: tracks[i].label,
          language: tracks[i].language,
          enabled: tracks[i].enabled,
        });
      }
      setAudioTracks(tracksList);
    };
    tracks.addEventListener('change', updateAudioTracksList);

    player.on('play', () => {
      if (!player.isDisposed()) {
        if (loadTimeoutRef.current) {
          window.clearTimeout(loadTimeoutRef.current);
          loadTimeoutRef.current = null;
        }
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
        if (loadTimeoutRef.current) {
          window.clearTimeout(loadTimeoutRef.current);
          loadTimeoutRef.current = null;
        }
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
      if (loadTimeoutRef.current) {
        window.clearTimeout(loadTimeoutRef.current);
        loadTimeoutRef.current = null;
      }

      updateAudioTracksList();

      const dur = player.duration() || 0;
      setDuration(dur);
      if (initialProgress && initialProgress > 0.05 && initialProgress < 0.95) {
        player.currentTime(dur * initialProgress);
      }
      streamInfoService
        .collectInfoAsync(videoEl, hlsRef.current, mpegtsRef.current, source)
        .then(info => {
          if (info.isHEVC && !info.isSupported) {
            showOsd(createElement(AlertTriangle, { className: 'w-12 h-12 text-white' }), 'HEVC/H.265: verifica codec');
          }
        })
        .catch(() => undefined);
      player.play()?.catch(e => console.warn('Autoplay bloccato:', e));
      broadcastStatus();
    });
    player.on('ended', () => {
      if (onNext) onNext();
      broadcastStatus();
    });
    player.on('error', () => {
      const err = player.error();
      console.error('VideoJS Error:', err);
      const classifiedError = classifyPlaybackError(err ?? null, detectedSource, source, retryCountRef.current, detectedSource.engine);
      setPlaybackError(classifiedError);
      setError(classifiedError.message);
      showOsd(createElement(AlertTriangle, { className: 'w-12 h-12 text-white' }), classifiedError.title);
      scheduleRetry(classifiedError);
      broadcastStatus();
    });

    // PiP Events
    const handleEnterPiP = () => setIsPiP(true);
    const handleLeavePiP = () => setIsPiP(false);
    videoEl.addEventListener('enterpictureinpicture', handleEnterPiP);
    videoEl.addEventListener('leavepictureinpicture', handleLeavePiP);

    // Broadcast network status / monitor bandwidth (desktop: Electron o Wails)
    if (platformService.isDesktop && host) {
      networkStatusIntervalRef.current = window.setInterval(() => {
        if (player && !player.isDisposed()) {
          const stats = (player.tech({ IWillNotUseThisInPlugins: true }) as any)?.vhs?.stats;
          if (stats && stats.bandwidth) {
            setNetworkSpeed(stats.bandwidth / 1024 / 1024); // Mbps
          }
          broadcastStatus();
        }
      }, 5000);
    }

    return () => {
      if (networkStatusIntervalRef.current) {
        window.clearInterval(networkStatusIntervalRef.current);
        networkStatusIntervalRef.current = null;
      }
      videoEl.removeEventListener('enterpictureinpicture', handleEnterPiP);
      videoEl.removeEventListener('leavepictureinpicture', handleLeavePiP);
      tracks.removeEventListener('change', updateAudioTracksList);
      if (playerRef.current) {
        playerRef.current.dispose();
        playerRef.current = null;
      }
      cleanupPlaybackEngines();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, detectedSource, initialProgress, retryNonce, onNext, onProgress]);
};




