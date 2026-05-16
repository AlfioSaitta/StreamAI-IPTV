import React, { useEffect, useRef, useState, useCallback } from 'react';
import type Player from 'video.js/dist/types/player';
import type Hls from 'hls.js';
import 'video.js/dist/video-js.css';

import { Channel } from '../types';
import type { XtreamCredentials } from '../types';
import { platformService } from '../services/platformService';
import { nativeVideoPlayer } from '../services/nativeVideoPlayer';
import { streamInfoService } from '../services/streamInfoService';
import type { VodProbeResult } from '../services/streamInfo/vodProbe';
import { subtitleService, loadSubtitleFromFile, type ActiveSubtitle } from '../services/subtitleService';
import { useCastSession } from '../hooks/useCastSession';
import { usePlayerOsd } from '../hooks/usePlayerOsd';
import { useInteractiveTimeline } from '../hooks/useInteractiveTimeline';
import { usePlayerShortcuts } from '../hooks/usePlayerShortcuts';
import { usePlayerMediaSession } from '../hooks/usePlayerMediaSession';
import { useRemoteControl } from '../hooks/useRemoteControl';
import { useNativePlayerEngine } from '../hooks/useNativePlayerEngine';
import { useWebPlayerEngine } from '../hooks/useWebPlayerEngine';
import { useEpg } from '../hooks/useEpg';
import { useAutoNextEpisode } from '../hooks/useAutoNextEpisode';
import { useSleepTimer, formatSleepRemaining } from '../hooks/useSleepTimer';
import CastDevicePicker from './CastDevicePicker';
import MiniEpgOverlay from './MiniEpgOverlay';
import AutoNextOverlay from './player/AutoNextOverlay';
import SleepTimerMenu from './player/SleepTimerMenu';
import StreamDiagnostics, {
  type BufferStats,
  type RecentPlaybackError,
} from './player/StreamDiagnostics';
import type { StreamCodecInfo } from '../services/streamInfoService';
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
  PictureInPicture2, Loader2, Info, Cast, Tv, Headphones, Volume1, Calendar, Moon,
  Subtitles, Upload, CheckCircle2, Copy, Check
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
  /** Xtream credentials, used to fetch the EPG for Live channels (D.1). */
  xtreamCreds?: XtreamCredentials | null;
  /**
   * If true and a "next" item is queued for a Series episode, show an
   * Up Next overlay during the last ~15s with a 10s countdown. C.4.
   */
  autoNextEpisodeEnabled?: boolean;
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
  xtreamCreds = null,
  autoNextEpisodeEnabled = true,
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
  const [streamInfoData, setStreamInfoData] = useState<StreamCodecInfo | null>(null);
  const [bufferStats, setBufferStats] = useState<BufferStats | null>(null);
  const [recentErrors, setRecentErrors] = useState<RecentPlaybackError[]>([]);
  const [infoLoading, setInfoLoading] = useState(false);
  const [streamSourceInfo, setStreamSourceInfo] = useState<StreamSourceInfo | null>(null);
  const [nativePiPSupported, setNativePiPSupported] = useState(false);
  const [showMiniEpg, setShowMiniEpg] = useState(false);
  // Feedback transitorio per il pulsante "Copia report errore" nel popup di errore.
  const [errorReportCopied, setErrorReportCopied] = useState(false);
  // URG-1 L3: result of the async VOD probe (HEAD + tail prefetch).
  // Used to disable the timeline when the server doesn't support Range.
  const [vodProbe, setVodProbe] = useState<VodProbeResult | null>(null);

  // D.4 — Sideloaded subtitles (SRT/VTT). MVP: one track at a time, no
  // persistence beyond the current playback session.
  const [activeSubtitle, setActiveSubtitle] = useState<ActiveSubtitle | null>(null);
  const [subtitleEnabled, setSubtitleEnabled] = useState<boolean>(true);
  const [showSubtitleMenu, setShowSubtitleMenu] = useState<boolean>(false);
  const subtitleFileInputRef = useRef<HTMLInputElement | null>(null);
  const subtitleTrackElRef = useRef<HTMLTrackElement | null>(null);

  // OSD (extracted hook)
  const { osd, showOsd } = usePlayerOsd();

  // EPG (D.1) — only loads when the channel is Live and we have a tvgId + creds.
  const isLive = channel?.type === 'live';
  const epg = useEpg(xtreamCreds, {
    tvgId: isLive ? channel?.tvgId : undefined,
    upcomingCount: 3,
    enabled: isLive && !!xtreamCreds,
  });

  // Auto-next episode (C.4): peek the next item in the playlist for the
  // overlay copy, then drive the countdown from playback state. We only
  // surface it for Series episodes — VOD/Live remain unaffected.
  const nextChannel = (() => {
    if (!channel || playlist.length === 0) return null;
    const idx = playlist.findIndex(c => c.id === channel.id);
    if (idx === -1 || idx >= playlist.length - 1) return null;
    return playlist[idx + 1];
  })();
  const autoNextEligible = !!(
    autoNextEpisodeEnabled &&
    onNext &&
    nextChannel &&
    channel?.type === 'series' &&
    !isLive
  );
  const autoNext = useAutoNextEpisode({
    enabled: autoNextEligible,
    hasNext: !!nextChannel,
    currentTime,
    duration,
    isLive,
    onTrigger: () => { onNext?.(); },
    channelId: channel?.id,
  });

  // Sleep timer (D.5) — counts down to a hard pause, with a soft volume
  // fade in the last 5 seconds. Available on any stream type.
  const [showSleepMenu, setShowSleepMenu] = useState(false);
  const sleepTimer = useSleepTimer({
    onFire: () => {
      if (isUsingNativePlayer) {
        nativeVideoPlayer.pause().catch(() => undefined);
      } else if (playerRef.current && !playerRef.current.paused()) {
        playerRef.current.pause();
      }
      setIsPlaying(false);
      showOsd(<Pause className="w-12 h-12 text-white" fill="white" />, 'Sleep timer scaduto');
    },
    fadeOutSeconds: 5,
    getVolume: () => {
      if (isUsingNativePlayer) return volume;
      return playerRef.current?.volume() ?? volume;
    },
    setVolume: (v) => {
      if (isUsingNativePlayer) {
        nativeVideoPlayer.setVolume(v).catch(() => undefined);
      } else if (playerRef.current) {
        playerRef.current.volume(v);
      }
      setVolume(v);
    },
  });

  // Interactive timeline (hover ghost bar + tooltip + pointer scrubbing).
  // URG-1: the hook now owns the scrubbing state machine and emits a SINGLE
  // seek on pointerup, eliminating the seek-storm caused by the previous
  // invisible <input type="range">.
  const performSeek = useCallback((time: number) => {
    if (isUsingNativePlayer) {
      nativeVideoPlayer.seekTo(time)
        .then(() => setCurrentTime(time))
        .catch(err => console.warn('[Player] Native timeline seek failed:', err));
      return;
    }
    if (!playerRef.current) return;
    // Prefer videoEl.fastSeek() when available — lands on the nearest keyframe
    // without decoding the intermediate frames, which is dramatically faster
    // on long VOD files.
    const videoEl = playerRef.current.el()?.querySelector('video') as HTMLVideoElement | null;
    if (videoEl && typeof (videoEl as any).fastSeek === 'function') {
      try { (videoEl as any).fastSeek(time); }
      catch { playerRef.current.currentTime(time); }
    } else {
      playerRef.current.currentTime(time);
    }
    setCurrentTime(time);
  }, [isUsingNativePlayer]);

  const {
    timelineRef,
    hoverTime,
    hoverPos,
    isScrubbing,
    scrubTime,
    onPointerDown: handleTimelinePointerDown,
    onMouseMove: handleTimelineMouseMove,
    onMouseLeave: handleTimelineMouseLeave,
  } = useInteractiveTimeline({ duration, onSeek: performSeek });

  // While scrubbing, the displayed playhead should track the user's finger
  // (optimistic UI), not the actual video.currentTime (which won't update
  // until the seek completes server-side).
  const displayTime = isScrubbing && scrubTime !== null ? scrubTime : currentTime;

  // URG-1 L3: when the upstream server explicitly advertises `Accept-Ranges:
  // none` we KNOW any seek will trigger a full re-download. Disable the
  // timeline interaction entirely (Play/Pause still works) and surface a
  // clear inline banner instead of letting the user freeze the player.
  const seekDisabled = vodProbe?.rangeSupport === 'no';
  const seekDisabledReason = seekDisabled
    ? 'Il server non supporta il seek (Accept-Ranges: none). Solo Play/Pausa disponibili.'
    : null;

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

  const computeBufferStats = useCallback((video: HTMLVideoElement | null): BufferStats | null => {
    if (!video) return null;
    try {
      const buf = video.buffered;
      const ranges = buf ? buf.length : 0;
      let total = 0;
      let ahead = 0;
      let behind = 0;
      const ct = video.currentTime || 0;
      for (let i = 0; i < ranges; i++) {
        const start = buf.start(i);
        const end = buf.end(i);
        total += end - start;
        if (ct >= start && ct <= end) {
          ahead = Math.max(ahead, end - ct);
          behind = Math.max(behind, ct - start);
        } else if (start > ct) {
          // Future buffered range — still counts as ahead from gap edge.
          ahead = Math.max(ahead, end - start);
        }
      }
      return { ranges, ahead, behind, total, currentTime: ct };
    } catch {
      return null;
    }
  }, []);

  const updateStreamInfo = useCallback(async () => {
    if (!channel) return;
    const videoElement = playerRef.current?.el()?.querySelector('video') as HTMLVideoElement | null;
    setInfoLoading(true);
    try {
      const info = await streamInfoService.collectInfoAsync(videoElement, hlsRef.current, mpegtsRef.current, channel.url);
      setStreamInfoData(info);
      setBufferStats(computeBufferStats(videoElement));
      setShowInfoPanel(true);
    } catch (e) {
      console.warn('[Player] Stream diagnostics failed', e);
      setStreamInfoData(null);
      setBufferStats(computeBufferStats(videoElement));
      setShowInfoPanel(true);
    } finally {
      setInfoLoading(false);
    }
  }, [channel, computeBufferStats]);

  // Build a human-readable bug report combining channel metadata, the
  // classified PlaybackError, the source detection and basic environment
  // info. Designed to be pasted into a GitHub issue / email to the dev.
  const buildErrorReport = useCallback((): string => {
    const ts = new Date().toISOString();
    const lines: string[] = [];
    lines.push('=== StreamAI IPTV — Error Report ===');
    lines.push(`Timestamp: ${ts}`);

    // Environment
    const platform = platformService.isElectron
      ? 'electron'
      : platformService.isNative
        ? 'capacitor/native'
        : 'web';
    lines.push(`Platform: ${platform}`);
    if (typeof navigator !== 'undefined') {
      lines.push(`User-Agent: ${navigator.userAgent}`);
      lines.push(`Language: ${navigator.language}`);
      lines.push(`Online: ${navigator.onLine}`);
    }
    lines.push(`Viewport: ${window.innerWidth}x${window.innerHeight}`);
    lines.push('');

    // Channel context (sanitized — never leak credentials).
    if (channel) {
      lines.push('--- Channel ---');
      lines.push(`Name: ${channel.cleanName || channel.name}`);
      lines.push(`Type: ${channel.type}`);
      if (channel.group) lines.push(`Group: ${channel.group}`);
      if (channel.tvgId) lines.push(`tvgId: ${channel.tvgId}`);
      lines.push(`URL (sanitized): ${sanitizeStreamUrl(channel.url)}`);
      lines.push('');
    }

    // Source detection
    if (streamSourceInfo) {
      lines.push('--- Source detection ---');
      lines.push(`Label: ${streamSourceInfo.label}`);
      lines.push(`Protocol: ${streamSourceInfo.protocol}`);
      lines.push(`MIME: ${streamSourceInfo.mimeType}`);
      lines.push(`Engine: ${streamSourceInfo.engine}`);
      lines.push(`Xtream-like: ${streamSourceInfo.isXtreamLike}`);
      lines.push(`Extensionless: ${streamSourceInfo.isExtensionless}`);
      lines.push(`isLive: ${streamSourceInfo.isLive}`);
      lines.push('');
    }

    // Active engine at runtime
    lines.push(`Active engine (runtime): ${playerEngineRef.current}`);
    lines.push('');

    // The classified playback error itself.
    if (playbackError) {
      lines.push('--- PlaybackError ---');
      lines.push(`Title: ${playbackError.title}`);
      lines.push(`Message: ${playbackError.message}`);
      lines.push(`Category: ${playbackError.category}`);
      lines.push(`Retry: ${playbackError.retryCount}/${MAX_PLAYBACK_RETRIES}`);
      lines.push(`Can retry: ${playbackError.canRetry}`);
      lines.push('Technical details:');
      playbackError.technicalDetails.forEach(d => lines.push(`  - ${d}`));
      lines.push('');
    } else if (error) {
      lines.push('--- Error (no classification) ---');
      lines.push(error);
      lines.push('');
    }

    // VOD probe (Range support / real Content-Type from the server)
    if (vodProbe) {
      lines.push('--- VOD probe ---');
      lines.push(`Range support: ${vodProbe.rangeSupport}`);
      if (vodProbe.contentType) lines.push(`Content-Type: ${vodProbe.contentType}`);
      if (vodProbe.contentLength != null) lines.push(`Content-Length: ${vodProbe.contentLength}`);
      lines.push('');
    }

    // Buffer + codec info if we already collected them via the diagnostics
    // panel — useful when the user pressed "Info stream" before "Copia".
    if (bufferStats) {
      lines.push('--- Buffer stats ---');
      lines.push(`currentTime: ${bufferStats.currentTime.toFixed(2)}s`);
      lines.push(`ahead: ${bufferStats.ahead.toFixed(2)}s`);
      lines.push(`behind: ${bufferStats.behind.toFixed(2)}s`);
      lines.push(`total: ${bufferStats.total.toFixed(2)}s`);
      lines.push(`ranges: ${bufferStats.ranges}`);
      lines.push('');
    }
    if (streamInfoData) {
      lines.push('--- Stream / codec info ---');
      try {
        lines.push(JSON.stringify(streamInfoData, null, 2));
      } catch {
        lines.push(String(streamInfoData));
      }
      lines.push('');
    }

    // Recent error history (ring buffer)
    if (recentErrors.length > 0) {
      lines.push('--- Recent errors (most recent first) ---');
      recentErrors.forEach((e, i) => {
        lines.push(`#${i + 1} [${new Date(e.ts).toISOString()}] ${e.category} — ${e.title}: ${e.message}`);
      });
      lines.push('');
    }

    lines.push('=== End report ===');
    return lines.join('\n');
  }, [channel, streamSourceInfo, playbackError, error, vodProbe, bufferStats, streamInfoData, recentErrors]);

  const copyErrorReport = useCallback(async () => {
    const report = buildErrorReport();
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(report);
        ok = true;
      } else {
        // Fallback for older Electron / non-secure contexts.
        const ta = document.createElement('textarea');
        ta.value = report;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      }
    } catch (e) {
      console.warn('[Player] Copy error report failed:', e);
    }
    if (ok) {
      setErrorReportCopied(true);
      showOsd(<Copy className="w-12 h-12 text-white" />, 'Report errore copiato');
      window.setTimeout(() => setErrorReportCopied(false), 2000);
    } else {
      showOsd(<AlertTriangle className="w-12 h-12 text-white" />, 'Copia non disponibile');
    }
  }, [buildErrorReport, showOsd]);

  // P8.2 — Track recent playback errors (ring buffer, max 10) for the
  // diagnostics screen. We snapshot whenever `playbackError` transitions
  // from null → non-null.
  const lastErrorRef = useRef<PlaybackErrorState | null>(null);  useEffect(() => {
    if (playbackError && playbackError !== lastErrorRef.current) {
      lastErrorRef.current = playbackError;
      setRecentErrors(prev => [
        {
          ts: Date.now(),
          title: playbackError.title,
          message: playbackError.message,
          category: playbackError.category,
        },
        ...prev,
      ].slice(0, 10));
    }
    if (!playbackError) lastErrorRef.current = null;
  }, [playbackError]);

  // Refresh buffer stats periodically while the diagnostics panel is open.
  useEffect(() => {
    if (!showInfoPanel) return;
    const id = window.setInterval(() => {
      const videoElement = playerRef.current?.el()?.querySelector('video') as HTMLVideoElement | null;
      setBufferStats(computeBufferStats(videoElement));
    }, 1000);
    return () => window.clearInterval(id);
  }, [showInfoPanel, computeBufferStats]);

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

  // NOTE: the legacy `handleSeek` (input[type=range] onChange) was removed
  // on 2026-05-13 as part of URG-1 (seek-storm fix). All seeks now go
  // through `performSeek` invoked by `useInteractiveTimeline` on pointerup.


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
      toggleEpg: () => setShowMiniEpg(prev => !prev),
      toggleSleepTimer: () => setShowSleepMenu(prev => !prev),
      toggleSubtitles: () => toggleSubtitleVisibility(),
      onEscape: () => {
        if (showSleepMenu) setShowSleepMenu(false);
        else if (showSubtitleMenu) setShowSubtitleMenu(false);
        else if (showMiniEpg) setShowMiniEpg(false);
        else if (showPlaylist) setShowPlaylist(false);
        else if (showDevicePicker) setShowDevicePicker(false);
        else if (showAudioMenu) setShowAudioMenu(false);
        else if (onBack) onBack();
      },
    },
    { channel, seekDisabled }
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
    setShowMiniEpg(false);
    setStreamInfoData(null);
    setBufferStats(null);
    setRecentErrors([]);
    setAudioTracks([]);
    setNativePiPSupported(false);
    setVodProbe(null);
    // D.4 — detach any sideloaded subtitle when the channel changes.
    subtitleService.detach();
    setActiveSubtitle(null);
    setShowSubtitleMenu(false);
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
    onVodProbeResult: setVodProbe,
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

  // D.4 — Attach / detach a <track> element on the underlying <video> when
  // the user loads / removes a sideloaded subtitle file. We bypass video.js
  // text track APIs to keep the implementation portable (works the same on
  // plain HTMLVideoElement on Android web fallback).
  useEffect(() => {
    if (isUsingNativePlayer) return;
    const videoEl = playerRef.current?.el()?.querySelector('video') as HTMLVideoElement | null;
    if (!videoEl) return;

    // Remove the previous track element, if any.
    if (subtitleTrackElRef.current && subtitleTrackElRef.current.parentNode === videoEl) {
      videoEl.removeChild(subtitleTrackElRef.current);
      subtitleTrackElRef.current = null;
    }

    if (!activeSubtitle) return;

    const trackEl = document.createElement('track');
    trackEl.kind = 'subtitles';
    trackEl.label = activeSubtitle.label;
    trackEl.srclang = 'und';
    trackEl.src = activeSubtitle.blobUrl;
    trackEl.default = true;
    videoEl.appendChild(trackEl);
    subtitleTrackElRef.current = trackEl;

    // Browsers expose the just-added TextTrack on `videoEl.textTracks[i]`.
    // Force it to `showing` (the `default` attribute is sometimes ignored
    // when the track is added after `loadedmetadata`).
    const trySetMode = () => {
      const tracks = videoEl.textTracks;
      for (let i = 0; i < tracks.length; i++) {
        const t = tracks[i];
        if (t.label === activeSubtitle.label) {
          t.mode = subtitleEnabled ? 'showing' : 'disabled';
        } else if (t.mode === 'showing') {
          // Hide any other showing track to avoid stacking.
          t.mode = 'disabled';
        }
      }
    };
    trySetMode();
    // Also retry once the track has loaded (some browsers expose the mode
    // only after the .vtt body is fetched).
    trackEl.addEventListener('load', trySetMode, { once: true });
  }, [activeSubtitle, subtitleEnabled, isUsingNativePlayer]);

  // Toggle visibility without re-attaching the <track>.
  useEffect(() => {
    if (isUsingNativePlayer) return;
    const videoEl = playerRef.current?.el()?.querySelector('video') as HTMLVideoElement | null;
    if (!videoEl || !activeSubtitle) return;
    const tracks = videoEl.textTracks;
    for (let i = 0; i < tracks.length; i++) {
      if (tracks[i].label === activeSubtitle.label) {
        tracks[i].mode = subtitleEnabled ? 'showing' : 'disabled';
      }
    }
  }, [subtitleEnabled, activeSubtitle, isUsingNativePlayer]);

  const handleSubtitleFile = useCallback(async (file: File | null | undefined) => {
    if (!file) return;
    try {
      const sub = await loadSubtitleFromFile(file);
      subtitleService.setActive(sub);
      setActiveSubtitle(sub);
      setSubtitleEnabled(true);
      setShowSubtitleMenu(false);
      showOsd(<Subtitles className="w-12 h-12 text-white" />, `Sottotitoli: ${sub.label}`);
    } catch (e) {
      showOsd(<AlertTriangle className="w-12 h-12 text-white" />, (e as Error).message ?? 'Sottotitoli non validi');
    }
  }, [showOsd]);

  const removeSubtitle = useCallback(() => {
    subtitleService.detach();
    setActiveSubtitle(null);
    setSubtitleEnabled(false);
    showOsd(<Subtitles className="w-12 h-12 text-white" />, 'Sottotitoli rimossi');
  }, [showOsd]);

  const toggleSubtitleVisibility = useCallback(() => {
    if (!activeSubtitle) {
      // No subtitle loaded — open the menu to let the user pick a file.
      setShowSubtitleMenu(prev => !prev);
      return;
    }
    setSubtitleEnabled(prev => {
      const next = !prev;
      showOsd(<Subtitles className="w-12 h-12 text-white" />, next ? 'Sottotitoli ON' : 'Sottotitoli OFF');
      return next;
    });
  }, [activeSubtitle, showOsd]);

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

  // Detach any sideloaded subtitle on unmount to free the Blob URL (D.4).
  useEffect(() => {
    return () => {
      subtitleService.detach();
    };
  }, []);

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
          <div className="max-w-xl bg-state-error/15 border border-state-error/40 rounded-2xl p-5 text-left mb-6">
            <div className="flex items-center gap-3 mb-2 text-state-error">
              <AlertTriangle className="w-5 h-5" />
              <span className="font-semibold">{playbackError.title}</span>
            </div>
            <p className="text-sm text-state-error mb-4">{playbackError.message}</p>
            <div className="flex flex-wrap gap-3">
              {playbackError.canRetry && (
                <button onClick={retryPlaybackNow} className="tv-focus touch-target px-4 py-2 rounded-lg bg-brand-primary hover:bg-brand-primary-hover text-white font-medium">
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
            <div className={`w-2 h-2 rounded-full ${networkSpeed > 5 ? 'bg-state-success' : networkSpeed > 2 ? 'bg-state-warning' : 'bg-state-error'} animate-pulse`} />
            {networkSpeed.toFixed(2)} Mbps
          </div>
        </div>
      )}
      
      {error && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/90">
          <div className="bg-state-error/15 backdrop-blur border border-state-error/40 px-8 py-6 rounded-2xl flex flex-col items-center gap-4 text-center max-w-2xl mx-4 shadow-2xl">
            <AlertTriangle className="w-12 h-12 text-state-error" />
            <div>
              <h3 className="text-2xl font-bold text-white mb-2">{playbackError?.title || 'Errore di riproduzione'}</h3>
              <p className="text-base text-state-error">{error}</p>
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
                <button onClick={retryPlaybackNow} className="tv-focus px-6 py-2 bg-brand-primary hover:bg-brand-primary-hover text-white rounded-lg font-semibold flex items-center gap-2">
                  <RotateCcw className="w-4 h-4" /> Riprova
                </button>
              )}
              <button onClick={updateStreamInfo} className="tv-focus px-6 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg flex items-center gap-2">
                <Info className="w-4 h-4" /> Info stream
              </button>
              <button
                onClick={copyErrorReport}
                className="tv-focus px-6 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg flex items-center gap-2"
                title="Copia un report completo dell'errore negli appunti, pronto da inviare allo sviluppatore"
                aria-label="Copia report errore negli appunti"
              >
                {errorReportCopied ? <Check className="w-4 h-4 text-state-success" /> : <Copy className="w-4 h-4" />}
                {errorReportCopied ? 'Copiato!' : 'Copia report'}
              </button>
              <button onClick={() => { setError(null); setPlaybackError(null); if (onBack) onBack(); }} className="tv-focus px-6 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-lg">Chiudi</button>
            </div>
          </div>
        </div>
      )}

      {showInfoPanel && channel && (
        <StreamDiagnostics
          open={showInfoPanel}
          onClose={() => setShowInfoPanel(false)}
          channelName={channel.cleanName || channel.name}
          sanitizedUrl={sanitizeStreamUrl(channel.url)}
          engine={playerEngineRef.current}
          sourceInfo={streamSourceInfo}
          info={streamInfoData}
          bufferStats={bufferStats}
          recentErrors={recentErrors}
          loading={infoLoading}
          onRefresh={updateStreamInfo}
        />
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
                      className={`tv-focus w-full text-left p-3 rounded-lg flex items-center gap-3 transition-colors ${c.id === channel.id ? 'bg-brand-primary text-white' : 'hover:bg-white/10 text-gray-300'}`}
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
                    ? 'bg-brand-primary/20 text-brand-primary border border-brand-primary/30' 
                    : 'hover:bg-white/10 text-gray-300 border border-transparent'
                }`}
              >
                <div className="flex flex-col">
                  <span className="text-sm font-bold capitalize">{track.label || `Traccia ${track.id}`}</span>
                  {track.language && <span className="text-[10px] opacity-60 uppercase tracking-widest">{track.language}</span>}
                </div>
                {track.enabled && <div className="w-2 h-2 rounded-full bg-brand-primary animate-pulse" />}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* SUBTITLE MENU (D.4) */}
      {showSubtitleMenu && (channel.type === 'movie' || channel.type === 'series') && (
        <div className="absolute bottom-20 right-4 w-72 bg-black/90 backdrop-blur-xl border border-white/10 rounded-2xl p-2 z-[70] shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-200">
          <div className="p-3 border-b border-white/10 flex items-center justify-between mb-2">
            <h3 className="font-bold text-white text-sm flex items-center gap-2"><Subtitles className="w-4 h-4" /> Sottotitoli</h3>
            <button onClick={() => setShowSubtitleMenu(false)} aria-label="Chiudi menu sottotitoli" className="tv-focus touch-target p-1 rounded-full hover:bg-white/10"><X className="w-4 h-4 text-gray-400" /></button>
          </div>
          <div className="space-y-1 p-1">
            {/* "Off" entry */}
            <button
              onClick={removeSubtitle}
              className={`tv-focus w-full text-left p-3 rounded-xl flex items-center justify-between transition-all ${
                !activeSubtitle ? 'bg-brand-primary/20 text-brand-primary border border-brand-primary/30' : 'hover:bg-white/10 text-gray-300 border border-transparent'
              }`}
            >
              <span className="text-sm font-bold">Disattivati</span>
              {!activeSubtitle && <CheckCircle2 className="w-4 h-4" />}
            </button>

            {/* Currently loaded subtitle */}
            {activeSubtitle && (
              <button
                onClick={() => setSubtitleEnabled(prev => !prev)}
                className={`tv-focus w-full text-left p-3 rounded-xl flex items-center justify-between transition-all ${
                  subtitleEnabled ? 'bg-brand-primary/20 text-brand-primary border border-brand-primary/30' : 'hover:bg-white/10 text-gray-300 border border-transparent'
                }`}
              >
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-bold truncate">{activeSubtitle.label}</span>
                  <span className="text-[10px] opacity-60 uppercase tracking-widest">
                    {activeSubtitle.format} · {activeSubtitle.cueCount} cue
                  </span>
                </div>
                {subtitleEnabled && <CheckCircle2 className="w-4 h-4 shrink-0" />}
              </button>
            )}

            {/* Load file */}
            <button
              onClick={() => subtitleFileInputRef.current?.click()}
              className="tv-focus w-full text-left p-3 rounded-xl flex items-center gap-2 hover:bg-white/10 text-gray-200 border border-transparent transition-all"
            >
              <Upload className="w-4 h-4" />
              <span className="text-sm font-medium">Carica file (.srt / .vtt)</span>
            </button>

            <p className="px-3 py-2 text-[11px] text-gray-500 leading-relaxed">
              MVP: un solo file alla volta, conversione SRT→VTT automatica.
              I sottotitoli si resettano al cambio di episodio/film.
            </p>
          </div>
          <input
            ref={subtitleFileInputRef}
            type="file"
            accept=".srt,.vtt,application/x-subrip,text/vtt,text/plain"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0];
              void handleSubtitleFile(f);
              // Allow picking the same file twice in a row.
              if (e.target) e.target.value = '';
            }}
          />
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
              {seekDisabledReason && (
                <div className="mb-2 px-3 py-2 rounded-md bg-amber-500/15 border border-amber-400/40 text-amber-100 text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{seekDisabledReason}</span>
                </div>
              )}
              <div
                ref={timelineRef}
                className={`relative h-2 bg-white/20 rounded-full group/timeline transition-all duration-200 touch-none ${seekDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:h-3'}`}
                role="slider"
                aria-label="Posizione di riproduzione"
                aria-valuemin={0}
                aria-valuemax={duration}
                aria-valuenow={displayTime}
                aria-valuetext={formatTime(displayTime)}
                aria-disabled={seekDisabled}
                tabIndex={seekDisabled ? -1 : 0}
                onPointerDown={seekDisabled ? undefined : handleTimelinePointerDown}
                onMouseMove={seekDisabled ? undefined : handleTimelineMouseMove}
                onMouseLeave={seekDisabled ? undefined : handleTimelineMouseLeave}
                onKeyDown={(e) => {
                  if (seekDisabled) return;
                  // Keyboard accessibility: arrows seek ±5s, PageUp/Down ±30s,
                  // Home/End jump to start/end. Single seek per keystroke.
                  let next: number | null = null;
                  if (e.key === 'ArrowRight') next = Math.min(duration, displayTime + 5);
                  else if (e.key === 'ArrowLeft') next = Math.max(0, displayTime - 5);
                  else if (e.key === 'PageUp') next = Math.min(duration, displayTime + 30);
                  else if (e.key === 'PageDown') next = Math.max(0, displayTime - 30);
                  else if (e.key === 'Home') next = 0;
                  else if (e.key === 'End') next = Math.max(0, duration - 1);
                  if (next !== null) { e.preventDefault(); performSeek(next); }
                }}
              >
                {/* Buffered Bar */}
                <div className="absolute h-full bg-white/30 rounded-full" style={{ width: '0%' }} />
                
                {/* Played Bar — tracks displayTime so the playhead follows the
                    user's finger during scrubbing instead of lagging behind. */}
                <div className="absolute h-full bg-brand-primary rounded-full" style={{ width: `${(displayTime / duration) * 100}%` }} />

                {/* Hover Ghost Bar */}
                {hoverTime !== null && (
                  <div className="absolute h-full bg-white/20 rounded-full" style={{ width: `${hoverPos}%` }} />
                )}

                {/* Thumb — always visible during scrubbing, otherwise on hover */}
                <div
                  className={`absolute top-1/2 w-4 h-4 bg-brand-primary rounded-full shadow-lg transition-transform duration-200 ${isScrubbing ? 'scale-125' : 'scale-0 group-hover/timeline:scale-100'}`}
                  style={{ left: `${(displayTime / duration) * 100}%`, transform: 'translate(-50%, -50%)' }}
                />

                {/* Tooltip */}
                {(hoverTime !== null || isScrubbing) && (
                  <div
                    className="absolute bottom-5 -translate-x-1/2 bg-black/80 text-white text-xs px-2 py-1 rounded border border-white/10 whitespace-nowrap pointer-events-none"
                    style={{ left: `${hoverPos}%` }}
                  >
                    {formatTime(hoverTime ?? scrubTime ?? 0)}
                  </div>
                )}
              </div>
              <div className="flex justify-between text-xs text-gray-400 mt-2 font-medium">
                <span>{formatTime(displayTime)}</span><span>{formatTime(duration)}</span>
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
              {(channel.type === 'movie' || channel.type === 'series') && currentTime > 30 && !seekDisabled && (
                <button onClick={restartFromBeginning} aria-label="Riparti dall'inizio" className="tv-focus touch-target p-2 hover:bg-white/10 rounded-full" title="Riparti dall'inizio">
                  <RotateCcw className="w-6 h-6 text-white" />
                </button>
              )}
            </div>

            {/* Center Controls */}
            <div className="flex items-center gap-2">
              {onPrev && <button onClick={onPrev} aria-label="Precedente" title="Precedente" className="tv-focus touch-target p-2 hover:bg-white/10 rounded-full"><SkipBack className="w-6 h-6 text-white" /></button>}
              <button onClick={() => skip(-10)} disabled={seekDisabled} aria-label="Indietro 10 secondi" title={seekDisabled ? 'Seek non supportato dal server' : 'Indietro 10s (←)'} className={`tv-focus touch-target p-2 rounded-full ${seekDisabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-white/10'}`}><Rewind className="w-6 h-6 text-white" /></button>
              <button onClick={togglePlay} aria-label={isPlaying ? 'Pausa' : 'Play'} title={`${isPlaying ? 'Pausa' : 'Play'} (Spazio)`} className="tv-focus touch-target p-3 bg-white/10 hover:bg-white/20 rounded-full">{isPlaying ? <Pause className="w-8 h-8 text-white" /> : <Play className="w-8 h-8 text-white" fill="white" />}</button>
              <button onClick={() => skip(10)} disabled={seekDisabled} aria-label="Avanti 10 secondi" title={seekDisabled ? 'Seek non supportato dal server' : 'Avanti 10s (→)'} className={`tv-focus touch-target p-2 rounded-full ${seekDisabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-white/10'}`}><FastForward className="w-6 h-6 text-white" /></button>
              {onNext && <button onClick={onNext} aria-label="Successivo" title="Successivo" className="tv-focus touch-target p-2 hover:bg-white/10 rounded-full"><SkipForward className="w-6 h-6 text-white" /></button>}
            </div>

            {/* Right Controls */}
            <div className="flex items-center gap-2">
              {isLive && channel.tvgId && (
                <button
                  onClick={() => setShowMiniEpg(prev => !prev)}
                  aria-label="Guida TV"
                  aria-pressed={showMiniEpg}
                  className={`tv-focus touch-target p-2 hover:bg-white/10 rounded-full transition-colors ${showMiniEpg ? 'text-brand-primary bg-white/10' : 'text-white'}`}
                  title="Guida TV (G)"
                >
                  <Calendar className="w-6 h-6" />
                </button>
              )}
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
                  className={`tv-focus touch-target p-2 hover:bg-white/10 rounded-full transition-colors ${showAudioMenu ? 'text-brand-primary bg-white/10' : 'text-white'}`}
                  title="Lingue Audio"
                >
                  <Headphones className="w-6 h-6" />
                </button>
              )}
              {/* D.4 — Subtitles (sideload SRT/VTT) */}
              {(channel.type === 'movie' || channel.type === 'series') && (
                <button
                  onClick={() => setShowSubtitleMenu(prev => !prev)}
                  aria-label="Sottotitoli"
                  aria-pressed={showSubtitleMenu || (activeSubtitle !== null && subtitleEnabled)}
                  className={`tv-focus touch-target p-2 hover:bg-white/10 rounded-full transition-colors ${
                    activeSubtitle && subtitleEnabled ? 'text-brand-primary bg-white/10' : showSubtitleMenu ? 'text-white bg-white/10' : 'text-white'
                  }`}
                  title="Sottotitoli (S)"
                >
                  <Subtitles className="w-6 h-6" />
                </button>
              )}
              <button onClick={updateStreamInfo} aria-label="Info stream/codec" className="tv-focus touch-target p-2 hover:bg-white/10 rounded-full" title="Info Codec">
                <Info className="w-6 h-6 text-white" />
              </button>
              {/* D.5 — Sleep timer */}
              <button
                onClick={() => setShowSleepMenu(prev => !prev)}
                aria-label={sleepTimer.preset !== 'off' ? `Sleep timer attivo (${formatSleepRemaining(sleepTimer.remainingSeconds)})` : 'Sleep timer'}
                aria-pressed={showSleepMenu || sleepTimer.preset !== 'off'}
                className={`tv-focus touch-target relative p-2 hover:bg-white/10 rounded-full transition-colors ${
                  sleepTimer.preset !== 'off' ? 'text-amber-300' : 'text-white'
                }`}
                title={sleepTimer.preset !== 'off' ? `Sleep timer: ${formatSleepRemaining(sleepTimer.remainingSeconds)} (T)` : 'Sleep timer (T)'}
              >
                <Moon className="w-6 h-6" />
                {sleepTimer.preset !== 'off' && sleepTimer.remainingSeconds > 0 && (
                  <span className="absolute -bottom-1 -right-1 bg-amber-500 text-black text-[9px] font-mono font-bold rounded-full px-1 leading-tight min-w-[18px] text-center">
                    {sleepTimer.remainingSeconds >= 60
                      ? `${Math.ceil(sleepTimer.remainingSeconds / 60)}m`
                      : `${sleepTimer.remainingSeconds}s`}
                  </span>
                )}
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
                <button onClick={togglePiP} aria-label="Picture-in-Picture" aria-pressed={isPiP} className={`tv-focus touch-target p-2 hover:bg-white/10 rounded-full ${isPiP ? 'text-brand-accent' : 'text-white'}`} title="Picture-in-Picture (P)">
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

      {/* Mini-EPG (Guida TV) — D.1 */}
      {isLive && channel.tvgId && (
        <MiniEpgOverlay
          open={showMiniEpg}
          onClose={() => setShowMiniEpg(false)}
          channelName={channel.cleanName || channel.name}
          current={epg.current}
          upcoming={epg.upcoming}
          isLoading={epg.isLoading}
          error={epg.error}
          onRefresh={epg.refresh}
        />
      )}

      {/* Auto-Next Episode (C.4) — Series only, last ~15s of an episode */}
      <AutoNextOverlay
        isVisible={autoNext.isVisible}
        secondsLeft={autoNext.secondsLeft}
        totalSeconds={10}
        nextChannel={nextChannel}
        onPlayNow={autoNext.playNow}
        onCancel={autoNext.cancel}
      />

      {/* Sleep Timer Menu (D.5) */}
      <SleepTimerMenu
        isOpen={showSleepMenu}
        onClose={() => setShowSleepMenu(false)}
        current={sleepTimer.preset}
        remainingSeconds={sleepTimer.remainingSeconds}
        onPick={(p) => {
          if (p === 'endOfProgramme') {
            const stop = epg.current?.stop;
            sleepTimer.setPreset('endOfProgramme', { endOfProgrammeAt: stop });
            showOsd(<Moon className="w-12 h-12 text-amber-300" />, 'Sleep: fine programma');
          } else if (p === 'off') {
            sleepTimer.setPreset('off');
            showOsd(<Moon className="w-12 h-12 text-gray-400" />, 'Sleep timer disattivato');
          } else {
            sleepTimer.setPreset(p);
            const labels: Record<string, string> = {
              '15min': '15 minuti',
              '30min': '30 minuti',
              '60min': '1 ora',
              '90min': '1 ora 30 min',
            };
            showOsd(<Moon className="w-12 h-12 text-amber-300" />, `Sleep: ${labels[p] ?? p}`);
          }
        }}
        endOfProgrammeAvailable={isLive && !!epg.current && (epg.current.stop > Date.now() + 60_000)}
        endOfProgrammeAt={epg.current?.stop ?? null}
      />

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
