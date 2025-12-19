import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Channel } from '../types.ts';
import { MetadataService } from '../services/metadata.ts';
import { DownloadManager } from '../services/downloadManager.ts';
import { useCast } from '../hooks/useCast.ts';
import { useCastSession } from '../hooks/useCastSession.ts';
import CastDevicePicker from './CastDevicePicker.tsx';
import { AlertTriangle, Play, Pause, Volume2, VolumeX, Maximize, Minimize, SkipForward, SkipBack, List, X, FastForward, Rewind, RotateCcw, PictureInPicture2, Cast, Loader2, Tv, StopCircle, ChevronLeft, Info, Settings } from 'lucide-react';
import Hls from 'hls.js';
import mpegts from 'mpegts.js';
import { nativeVideoPlayer } from '../services/nativeVideoPlayer.ts';
import { platformService } from '../services/platformService.ts';
import { streamInfoService, StreamCodecInfo } from '../services/streamInfoService.ts';

interface VideoPlayerProps {
  channel: Channel | null;
  playlist?: Channel[];
  onChannelSelect?: (channel: Channel) => void;
  onNext?: () => void;
  onPrev?: () => void;
  onBack?: () => void;
  onProgress?: (progress: number, duration: number) => void;
  initialProgress?: number; // Progresso iniziale (0-1) per riprendere
  onResetProgress?: () => void; // Callback per resettare il progresso
}

const VideoPlayer: React.FC<VideoPlayerProps> = ({ channel, playlist = [], onChannelSelect, onNext, onPrev, onBack, onProgress, initialProgress, onResetProgress }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  
  const hlsRef = useRef<Hls | null>(null); 
  const mpegtsRef = useRef<mpegts.Player | null>(null);
  const lastHostRef = useRef<string | null>(null);
  const loadTokenRef = useRef(0);
  const debounceTimerRef = useRef<number | null>(null);


  // Warm cache per prebuffer canali adiacenti (LRU max 4 per zapping veloce)
  const warmCacheRef = useRef<Map<string, Hls>>(new Map());

  // Pool di connessioni prewarmed per ridurre latenza DNS/TLS
  const connectionPoolRef = useRef<Set<string>>(new Set());

  // Prewarm HTTP (DNS/TLS warmup) - più aggressivo
  const prewarm = (url: string) => {
    if (connectionPoolRef.current.has(url)) return;
    connectionPoolRef.current.add(url);
    // Mantieni pool size limitato
    if (connectionPoolRef.current.size > 10) {
      const first = connectionPoolRef.current.values().next().value;
      if (first) connectionPoolRef.current.delete(first);
    }
    try {
      // Usa fetch con keepalive per mantenere connessione calda
      fetch(url, {
        method: 'HEAD',
        mode: 'no-cors',
        cache: 'no-store',
        keepalive: true,
        headers: {
          'User-Agent': 'StreamAI IPTV',
        }
      } as any).catch(() => {});
    } catch {}
  };

  // Crea istanza Hls ottimizzata per pre-caricamento rapido
  const warmHls = (url: string, isLive: boolean) => {
    const h = new Hls({
      enableWorker: true,
      autoStartLoad: false,
      lowLatencyMode: isLive,
      backBufferLength: 0,
      // Live: buffer MINIMO, VOD: un po' di più
      maxBufferLength: isLive ? 1 : 10,
      maxMaxBufferLength: isLive ? 2 : 20,
      startLevel: 0, // Sempre dal livello più basso per velocità
      testBandwidth: false,
      initialLiveManifestSize: 1, // Solo 1 segmento
      // Timeout minimi per prewarm
      manifestLoadingTimeOut: isLive ? 2000 : 8000,
      fragLoadingTimeOut: isLive ? 2000 : 10000,
    } as any);
    try {
      h.loadSource(url);
      h.on(Hls.Events.MANIFEST_PARSED, () => {
        try { h.startLoad(0); } catch {}
        // Pre-buffer brevissimo per live
        const preloadTime = isLive ? 300 : 1500;
        setTimeout(() => { try { h.stopLoad(); } catch {} }, preloadTime);
      });
    } catch { /* ignore */ }
    return h as Hls;
  };

  // LRU cache size aumentato a 4 per zapping più fluido
  const cachePut = (key: string, val: Hls) => {
    const cache = warmCacheRef.current;
    if (cache.has(key)) cache.delete(key);
    cache.set(key, val);
    while (cache.size > 4) {
      const firstKey = cache.keys().next().value as string | undefined;
      if (!firstKey) break;
      try { cache.get(firstKey)?.destroy(); } catch {}
      cache.delete(firstKey);
    }
  };
  
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false); // Nuovo: feedback buffering
  const [, setVolume] = useState(1); // Volume state (UI display handled via video.volume)
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPiP, setIsPiP] = useState(false); // Picture-in-Picture
  const [showControls, setShowControls] = useState(true);
  
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  const [meta, setMeta] = useState<any>(null);

  // Playlist / Zapping UI
  const [showPlaylist, setShowPlaylist] = useState(false);
  const playlistRef = useRef<HTMLDivElement>(null);

  // Stream Info State
  const [showStreamInfo, setShowStreamInfo] = useState(false);
  const [streamInfo, setStreamInfo] = useState<StreamCodecInfo | null>(null);
  const [streamLogs, setStreamLogs] = useState<string[]>([]);

  // Cast State
  const cast = useCast();
  const castSession = useCastSession();
  const [isCastLoading, setIsCastLoading] = useState(false);
  const [showDevicePicker, setShowDevicePicker] = useState(false);
  const [castMessage, setCastMessage] = useState<string | null>(null);

  // OSD State
  const [osdMessage, setOsdMessage] = useState<{icon: React.ElementType, text?: string} | null>(null);
  const osdTimeoutRef = useRef<number | null>(null);
  const controlsTimeoutRef = useRef<number | null>(null);

  // Throttle progress updates to avoid flooding
  const lastProgressUpdate = useRef<number>(0);

  // Funzione per raccogliere info stream (versione asincrona per analisi approfondita)
  const collectStreamInfo = useCallback(async () => {
    if (!channel) return;

    // Reset logs
    setStreamLogs([]);

    // Usa la versione asincrona per analisi più approfondita
    const info = await streamInfoService.collectInfoAsync(
      videoRef.current,
      hlsRef.current,
      mpegtsRef.current,
      channel.url
    );

    setStreamInfo(info);
    console.log('[StreamInfo] Collected:', info);

    // Log aggiuntivo per debug
    if (info.isHEVC) {
      console.warn('[StreamInfo] ⚠️ HEVC/H.265 detected - Support:', info.supportDetails);
    }

    return info;
  }, [channel]);

  // Analisi automatica quando lo stream è pronto
  const autoAnalyzeStream = useCallback(() => {
    // Prima analisi rapida dopo 2 secondi
    setTimeout(async () => {
      const info = await collectStreamInfo();
      if (info) {
        const logPrefix = '[AutoAnalyze]';
        console.log(`${logPrefix} Prima analisi completata`);
        console.log(`${logPrefix} Video: ${info.videoCodec || 'non rilevato'} ${info.width || '?'}x${info.height || '?'}`);
        console.log(`${logPrefix} Audio: ${info.audioCodec || 'non rilevato'}`);
        console.log(`${logPrefix} Protocol: ${info.protocol}, Container: ${info.container}`);
        // Se i codec non sono stati rilevati, fai una seconda analisi dopo altri 3 secondi
        if (!info.videoCodec) {
          console.log(`${logPrefix} Codec non rilevato, ri-analisi tra 3 secondi...`);
          setTimeout(async () => {
            const info2 = await collectStreamInfo();
            if (info2) {
              console.log(`${logPrefix} Seconda analisi: Video: ${info2.videoCodec || 'non rilevato'}`);
              if (info2.isHEVC) {
                console.warn(`${logPrefix} ⚠️ HEVC/H.265 rilevato - Supporto: ${info2.supportDetails}`);
              }
            }
          }, 3000);
        } else if (info.isHEVC) {
          console.warn(`${logPrefix} ⚠️ HEVC/H.265 rilevato - Supporto: ${info.supportDetails}`);
        }
      }
    }, 2000);
  }, [collectStreamInfo]);

  // Registra callback per i log del streamInfoService
  useEffect(() => {
    const logCallback = (message: string, level: 'info' | 'warn' | 'error') => {
      const timestamp = new Date().toLocaleTimeString();
      const prefix = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : 'ℹ️';
      setStreamLogs(prev => [...prev.slice(-50), `${timestamp} ${prefix} ${message}`]);
    };

    streamInfoService.onLog(logCallback);
    return () => {
      streamInfoService.offLog(logCallback);
    };
  }, []);

  // Auto-analizza codec quando lo stream inizia la riproduzione
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !channel) return;

    const onPlayingAutoAnalyze = () => {
      console.log('[VideoPlayer] 🎬 Stream playing - triggering auto codec analysis');
      autoAnalyzeStream();
    };

    // Analizza quando il video inizia a riprodurre
    video.addEventListener('playing', onPlayingAutoAnalyze, { once: true });

    return () => {
      video.removeEventListener('playing', onPlayingAutoAnalyze);
    };
  }, [channel, autoAnalyzeStream]);

  // Toggle pannello info stream
  const toggleStreamInfo = () => {
    if (!showStreamInfo) {
      collectStreamInfo(); // Funzione async, si esegue in background
    }
    setShowStreamInfo(!showStreamInfo);
  };

  const showOSD = (Icon: React.ElementType, text?: string) => {
      setOsdMessage({ icon: Icon, text });
      if (osdTimeoutRef.current) window.clearTimeout(osdTimeoutRef.current);
      osdTimeoutRef.current = window.setTimeout(() => setOsdMessage(null), 1000);
  };


  const resetControlsTimeout = () => {
      setShowControls(true);
      if (controlsTimeoutRef.current) window.clearTimeout(controlsTimeoutRef.current);
      if (controlsRef.current && controlsRef.current.contains(document.activeElement)) return;
      if (showPlaylist) return; // Don't hide if playlist is open

      controlsTimeoutRef.current = window.setTimeout(() => {
          if (isPlaying && !isSeeking && !showPlaylist) {
              setShowControls(false);
          }
      }, 4000);
  };

  useEffect(() => {
      if (containerRef.current) containerRef.current.focus();
      resetControlsTimeout();
      return () => { 
          if(controlsTimeoutRef.current) window.clearTimeout(controlsTimeoutRef.current);
          if(osdTimeoutRef.current) window.clearTimeout(osdTimeoutRef.current);
      };
  }, [channel, isPlaying, isSeeking, showPlaylist]);

  // Pausa download immagini durante streaming live per non interferire con la banda
  useEffect(() => {
    if (!channel) return;

    if (channel.type === 'live') {
      // Pausa tutti i download per i live
      DownloadManager.pause();
    }

    return () => {
      // Riprendi download quando si esce dal player
      DownloadManager.resume();
    };
  }, [channel]);

  // Load Stream
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !channel) return;
    setError(null);
    setIsPlaying(true); 
    setIsBuffering(true);
    setShowPlaylist(false);
    setCurrentTime(0);
    setDuration(0);
    setBuffered(0);

    const localToken = ++loadTokenRef.current;
    const isLive = channel.type === 'live';

    // Telemetria: tempi
    const t0 = performance.now();

    // Per i LIVE: NESSUN DEBOUNCE, avvio immediato
    // Per VOD: piccolo debounce per evitare rimbalzi
    const loadStream = () => {
      if (localToken !== loadTokenRef.current) return;

      // ============================================
      // CLEANUP AGGRESSIVO: ferma tutti i download PRIMA di distruggere
      // per evitare leak di banda durante lo zapping
      // ============================================

      // 1. Ferma il video element immediatamente
      video.pause();

      // 2. HLS.js: stopLoad() ferma tutti i download in corso
      if (hlsRef.current) {
        try {
          hlsRef.current.stopLoad(); // Ferma download frammenti
          hlsRef.current.detachMedia(); // Scollega dal video
          hlsRef.current.destroy(); // Distruggi istanza
        } catch {}
        hlsRef.current = null;
      }

      // 3. MPEGTS: unload ferma i download
      if (mpegtsRef.current) {
        try {
          mpegtsRef.current.pause();
          mpegtsRef.current.unload();
          mpegtsRef.current.detachMediaElement();
          mpegtsRef.current.destroy();
        } catch {}
        mpegtsRef.current = null;
      }

      // 4. Pulisci warm cache (connessioni HLS pre-caricate)
      warmCacheRef.current.forEach(h => {
        try {
          h.stopLoad();
          h.destroy();
        } catch {}
      });
      warmCacheRef.current.clear();

      // 5. Resetta il video element
      video.removeAttribute('src');
      // Per live: non chiamare load() che è lento
      if (!isLive) {
        video.load();
      }

      video.preload = isLive ? "none" : "auto";
      video.autoplay = true;
      video.playsInline = true;
      (video as any).disableRemotePlayback = true;

      // Debug: log eventi video element per live
      if (isLive) {
        const logEvent = (name: string) => () => {
          console.log(`[VIDEO] ${name}`, Math.round(performance.now() - t0), 'ms',
            'readyState:', video.readyState,
            'paused:', video.paused,
            'buffered:', video.buffered.length > 0 ? video.buffered.end(0).toFixed(2) + 's' : '0s'
          );
        };
        video.addEventListener('loadstart', logEvent('loadstart'), { once: true });
        video.addEventListener('loadedmetadata', logEvent('loadedmetadata'), { once: true });
        video.addEventListener('loadeddata', logEvent('loadeddata'), { once: true });
        video.addEventListener('canplay', logEvent('canplay'), { once: true });
        video.addEventListener('canplaythrough', logEvent('canplaythrough'), { once: true });
        video.addEventListener('playing', logEvent('playing'), { once: true });
        video.addEventListener('waiting', logEvent('waiting'), { once: true });
        video.addEventListener('stalled', logEvent('stalled'), { once: true });
        video.addEventListener('error', () => {
          console.error('[VIDEO] error', video.error?.code, video.error?.message);
        }, { once: true });
      }

      // First-frame telemetry
      const onFirstFrame = () => {
        console.log('first-frame', Math.round(performance.now() - t0), 'ms');
        video.removeEventListener('canplay', onFirstFrame);
      };
      video.addEventListener('canplay', onFirstFrame, { once: true } as any);

      const source = channel.url;
      const isM3U8 = source.toLowerCase().includes('.m3u8');
      const isTS = source.toLowerCase().match(/\.(ts|mpeg|mpg)$/);

      const getHost = (u: string) => {
        try { const { host, protocol } = new URL(u); return protocol + '//' + host; } catch { return null; }
      };
      const host = getHost(source);


      // Funzione per tentare riproduzione nativa del m3u8
      const tryNativeHls = () => {
        console.log('[NATIVE-HLS] Trying native HLS playback');
        video.src = source;
        video.play().catch((e) => {
          console.error('[NATIVE-HLS] Failed:', e);
          setError('Impossibile riprodurre lo stream');
          setIsBuffering(false);
        });
      };

      // HLS con hls.js
      if (isM3U8 && (Hls as any).isSupported()) {
        // ============================================
        // CONFIGURAZIONE LIVE: AVVIO ISTANTANEO
        // Priorità: partire il prima possibile
        // ============================================
        const hlsConfigLive: any = {
          debug: false,
          enableWorker: true,
          // === LOW LATENCY MODE per avvio rapido ===
          lowLatencyMode: true,
          // === AVVIO ISTANTANEO ===
          startLevel: 0, // Parti dal livello più basso
          startFragPrefetch: true,
          progressive: true,
          // === BUFFER MINIMO per partenza rapida ===
          backBufferLength: 0,
          maxBufferLength: 10,
          maxMaxBufferLength: 20,
          maxBufferHole: 1.5,
          // === LIVE SYNC AGGRESSIVO ===
          liveSyncDurationCount: 2, // Solo 2 segmenti di ritardo
          liveMaxLatencyDurationCount: 4,
          liveDurationInfinity: true,
          liveBackBufferLength: 0,
          // === AVVIO RAPIDO ===
          maxStarvationDelay: 2, // Ridotto per partire prima
          maxLoadingDelay: 4,
          highBufferWatchdogPeriod: 2,
          nudgeOffset: 0.5,
          nudgeMaxRetry: 5,
          // === ABR DISABILITATO per velocità ===
          abrEwmaFastLive: 1.0,
          abrEwmaSlowLive: 2.0,
          abrEwmaDefaultEstimate: 1000000,
          abrBandWidthFactor: 0.7,
          abrBandWidthUpFactor: 0.5,
          // === TIMEOUT ALTI per server lenti ===
          manifestLoadingTimeOut: 30000,
          levelLoadingTimeOut: 60000,
          fragLoadingTimeOut: 60000,
          // === RETRY ===
          manifestLoadingMaxRetry: 3,
          levelLoadingMaxRetry: 4,
          fragLoadingMaxRetry: 4,
          manifestLoadingRetryDelay: 1000,
          levelLoadingRetryDelay: 1000,
          fragLoadingRetryDelay: 1000,
          // === OTTIMIZZAZIONI ===
          capLevelOnFPSDrop: false,
          capLevelToPlayerSize: false,
          testBandwidth: false,
          // === LOADER POLICY ===
          enableSoftwareAES: true,
          // === XHR SETUP per server IPTV ===
          xhrSetup: (xhr: XMLHttpRequest, _url: string) => {
            xhr.withCredentials = false;
            xhr.timeout = 120000; // 2 minuti timeout XHR
            try {
              xhr.setRequestHeader('User-Agent', 'StreamAI IPTV');
              xhr.setRequestHeader('Accept', '*/*');
              xhr.setRequestHeader('Connection', 'keep-alive');
            } catch (e) {}
          },
        };

        // ============================================
        // CONFIGURAZIONE VOD (Movies): QUALITÀ E SEEKING
        // ============================================
        const hlsConfigMovie: any = {
          debug: false,
          enableWorker: true,
          lowLatencyMode: false,
          // === AVVIO VELOCE MA CON QUALITÀ ===
          startLevel: -1, // ABR automatico
          startFragPrefetch: true,
          progressive: true,
          // === BUFFER AMPIO PER FILM ===
          backBufferLength: 90, // 90s di backbuffer per seek indietro
          maxBufferLength: 90, // 90 secondi avanti
          maxMaxBufferLength: 180, // Fino a 3 minuti
          maxBufferHole: 0.5,
          // === GUARDIE RILASSATE ===
          maxStarvationDelay: 4,
          maxLoadingDelay: 8,
          nudgeOffset: 0.2,
          nudgeMaxRetry: 5,
          // === ABR CONSERVATIVO (qualità stabile) ===
          abrEwmaFastVod: 3.0,
          abrEwmaSlowVod: 9.0,
          abrBandWidthFactor: 0.95, // Usa quasi tutta la bandwidth
          abrBandWidthUpFactor: 0.8, // Switch up più generoso
          // === TIMEOUT GENEROSI ===
          manifestLoadingTimeOut: 15000,
          levelLoadingTimeOut: 15000,
          fragLoadingTimeOut: 25000,
          manifestLoadingMaxRetry: 3,
          levelLoadingMaxRetry: 3,
          fragLoadingMaxRetry: 4,
          manifestLoadingRetryDelay: 500,
          levelLoadingRetryDelay: 500,
          fragLoadingRetryDelay: 400,
          // === NO CAP PER QUALITÀ MASSIMA ===
          capLevelOnFPSDrop: false,
          capLevelToPlayerSize: false,
          // === XHR SETUP per server IPTV ===
          xhrSetup: (xhr: XMLHttpRequest, _url: string) => {
            xhr.withCredentials = false;
            xhr.setRequestHeader('User-Agent', 'StreamAI IPTV');
            xhr.setRequestHeader('Accept', '*/*');
          },
        };

        // ============================================
        // CONFIGURAZIONE SERIES: VIA DI MEZZO
        // ============================================
        // Episodi più corti, seeking frequente, ma qualità importante
        const hlsConfigSeries: any = {
          debug: false,
          enableWorker: true,
          lowLatencyMode: false,
          // === AVVIO RAPIDO ===
          startLevel: 0, // Parti basso poi sale
          startFragPrefetch: true,
          progressive: true,
          // === BUFFER MEDIO ===
          backBufferLength: 60, // 60s backbuffer
          maxBufferLength: 45, // 45 secondi avanti
          maxMaxBufferLength: 90, // Max 90 secondi
          maxBufferHole: 0.3,
          // === GUARDIE MODERATE ===
          maxStarvationDelay: 2,
          maxLoadingDelay: 4,
          nudgeOffset: 0.15,
          nudgeMaxRetry: 4,
          // === ABR BILANCIATO ===
          abrEwmaFastVod: 2.0,
          abrEwmaSlowVod: 6.0,
          abrBandWidthFactor: 0.9,
          abrBandWidthUpFactor: 0.7,
          // === TIMEOUT BILANCIATI ===
          manifestLoadingTimeOut: 10000,
          levelLoadingTimeOut: 10000,
          fragLoadingTimeOut: 15000,
          manifestLoadingMaxRetry: 2,
          levelLoadingMaxRetry: 2,
          fragLoadingMaxRetry: 3,
          manifestLoadingRetryDelay: 400,
          levelLoadingRetryDelay: 400,
          fragLoadingRetryDelay: 300,
          // === CAP MODERATO ===
          capLevelOnFPSDrop: true,
          capLevelToPlayerSize: false,
          // === XHR SETUP per server IPTV ===
          xhrSetup: (xhr: XMLHttpRequest, _url: string) => {
            xhr.withCredentials = false;
            xhr.setRequestHeader('User-Agent', 'StreamAI IPTV');
            xhr.setRequestHeader('Accept', '*/*');
          },
        };

        // Selezione configurazione basata sul tipo
        let hlsConfig: any;
        if (isLive) {
          hlsConfig = hlsConfigLive;
        } else if (channel.type === 'series') {
          hlsConfig = hlsConfigSeries;
        } else {
          hlsConfig = hlsConfigMovie;
        }

        // Per LIVE: sempre nuova istanza HLS per evitare stalli
        // Per VOD: riusa se possibile
        let hls: Hls | null = null;

        if (isLive) {
          // LIVE: crea sempre nuova istanza
          hls = new Hls(hlsConfig);
          hlsRef.current = hls;
        } else {
          // VOD: prova a riusare dalla cache
          const cached = warmCacheRef.current.get(channel.id);
          if (cached) {
            hls = cached;
            warmCacheRef.current.delete(channel.id);
            hlsRef.current = hls;
          } else {
            hls = new Hls(hlsConfig);
            hlsRef.current = hls;
          }
        }

        lastHostRef.current = host;
        hls!.attachMedia(video);

        console.log('[HLS] Loading source:', source.substring(0, 80) + '...');
        hls!.loadSource(source);

        // Flag per evitare play multipli
        let playStarted = false;
        const tryPlay = (reason: string) => {
          if (playStarted) return;
          playStarted = true;
          console.log(`[HLS] tryPlay (${reason})`, Math.round(performance.now() - t0), 'ms',
            'buffered:', video.buffered.length > 0 ? video.buffered.end(0).toFixed(2) + 's' : '0s',
            'readyState:', video.readyState);
          setIsBuffering(false);
          video.play().catch((e) => {
            console.debug('[HLS] Autoplay failed:', e);
            setIsPlaying(false);
            playStarted = false;
          });
        };

        // Per LIVE: avvia subito il caricamento
        if (isLive) {
          hls!.startLoad(-1);

          // LIVE: Avvia play quando ci sono dati
          hls!.on(Hls.Events.FRAG_BUFFERED, () => {
            tryPlay('FRAG_BUFFERED');
          });

          video.addEventListener('canplay', () => {
            tryPlay('canplay');
          }, { once: true });

          video.addEventListener('loadeddata', () => {
            tryPlay('loadeddata');
          }, { once: true });

          // loadedmetadata - se c'è QUALSIASI buffer, proviamo subito
          video.addEventListener('loadedmetadata', () => {
            if (video.buffered.length > 0 && video.buffered.end(0) > 0.5) {
              console.log('[HLS] loadedmetadata with buffer, trying play immediately');
              tryPlay('loadedmetadata-buffer');
            }
          }, { once: true });

          // STRATEGIA ULTRA-AGGRESSIVA per LIVE:
          // Buffer check molto frequente - basta 1s di buffer
          const bufferCheckInterval = setInterval(() => {
            if (playStarted) {
              clearInterval(bufferCheckInterval);
              return;
            }

            const hasBuffer = video.buffered.length > 0;
            const bufferAmount = hasBuffer ? video.buffered.end(0) : 0;

            // Per LIVE: se c'è almeno 1s di buffer, prova a partire SUBITO
            if (bufferAmount > 1) {
              console.log('[HLS] Buffer check: buffer=' + bufferAmount.toFixed(1) + 's, starting playback');
              clearInterval(bufferCheckInterval);
              tryPlay('buffer-check');
            }
          }, 100); // Check MOLTO frequente (100ms)

          // Timeout di sicurezza CORTO: dopo 1.5s forza il play se c'è qualsiasi buffer
          const forcePlayTimeout = setTimeout(() => {
            if (playStarted) return;
            clearInterval(bufferCheckInterval);

            if (video.buffered.length > 0) {
              const bufferAmount = video.buffered.end(0);
              console.log('[HLS] Force play timeout: buffer=' + bufferAmount.toFixed(1) + 's');
              tryPlay('timeout-force');
            }
          }, 1500);

          // Cleanup
          const cleanupBufferCheck = () => {
            clearInterval(bufferCheckInterval);
            clearTimeout(forcePlayTimeout);
          };

          // Pulisci quando parte o dopo 2 minuti
          video.addEventListener('playing', cleanupBufferCheck, { once: true });
          setTimeout(cleanupBufferCheck, 120000);
        }

        hls!.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
          console.log('[HLS] MANIFEST_PARSED', Math.round(performance.now() - t0), 'ms', 'levels:', data.levels?.length);
          if (!isLive) {
            video.play().catch(err => {
              console.debug('Autoplay catch:', err);
              setIsPlaying(false);
            });
          }
        });

        // Flag per evitare seek multipli
        let resumeDone = false;

        // Log eventi per debug
        hls!.on(Hls.Events.LEVEL_LOADED, (_, data) => {
          console.log('[HLS] LEVEL_LOADED', Math.round(performance.now() - t0), 'ms', 'live:', data.details.live);

          // Per VOD/Series: seek alla posizione salvata quando abbiamo la durata
          if (!isLive && !resumeDone && initialProgress && initialProgress > 0 && initialProgress < 0.95) {
            const totalDuration = data.details.totalduration;
            if (totalDuration > 0) {
              const resumeTime = totalDuration * initialProgress;
              // Riprendi solo se significativo (> 30s) e non quasi alla fine
              if (resumeTime > 30 && resumeTime < totalDuration - 60) {
                resumeDone = true;
                console.log(`[HLS] Ripresa VOD dalla posizione: ${Math.round(resumeTime)}s (${Math.round(initialProgress * 100)}%)`);
                // Ferma il caricamento corrente e ricarica dalla posizione desiderata
                hls!.stopLoad();
                hls!.startLoad(resumeTime);
                video.currentTime = resumeTime;
                showOSD(FastForward, `Ripresa da ${formatTime(resumeTime)}`);
              }
            }
          }
        });

        hls!.on(Hls.Events.FRAG_LOADING, (_, data) => {
          console.log('[HLS] FRAG_LOADING', Math.round(performance.now() - t0), 'ms', 'sn:', data.frag.sn, 'url:', data.frag.url?.substring(0, 60));
        });

        hls!.on(Hls.Events.FRAG_LOADED, (_, data) => {
          console.log('[HLS] FRAG_LOADED', Math.round(performance.now() - t0), 'ms', 'sn:', data.frag.sn);
        });

        hls!.on(Hls.Events.ERROR, (_e: any, data: any) => {
          console.warn('[HLS] ERROR:', data.type, data.details, data.fatal ? 'FATAL' : '', 'response:', data.response?.code);

          // Per i LIVE: ignora bufferStalledError - è normale durante il buffering iniziale
          if (isLive && data.details === 'bufferStalledError') {
            console.log('[HLS] Ignoring bufferStalledError for live stream (normal during initial buffering)');
            return;
          }

          if (!data?.fatal) return;

          console.warn('HLS Fatal Error:', data.type, data.details);

          // Distruggi HLS per evitare retry infiniti
          try { hls!.destroy(); } catch {}
          hlsRef.current = null;

          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              // Errori di rete - prova fallback
              if (data.details === 'manifestLoadError' || data.details === 'manifestLoadTimeOut') {
                console.log('[HLS] Manifest load failed, trying native playback...');
                tryNativeHls();
              } else if (data.details === 'levelLoadError' || data.details === 'levelLoadTimeOut') {
                // Errore caricamento level (spesso 509 Bandwidth Exceeded)
                // Prova con URL TS diretto se disponibile
                console.log('[HLS] Level load failed (possibly 509), trying TS direct or native...');
                // Costruisci URL TS diretto dal manifest
                const tsUrl = source.replace('.m3u8', '.ts');
                if (mpegts.isSupported()) {
                  // Prova MPEG-TS diretto
                  const player = mpegts.createPlayer({
                    type: 'mpegts',
                    url: tsUrl,
                    isLive: true
                  }, {
                    enableWorker: true,
                    stashInitialSize: 128 * 1024,
                    liveBufferLatencyChasing: true,
                  });
                  mpegtsRef.current = player;
                  player.attachMediaElement(video);
                  player.load();
                  player.play();
                  player.on(mpegts.Events.ERROR, () => {
                    // Se anche TS fallisce, prova nativo
                    try { player.destroy(); } catch {}
                    mpegtsRef.current = null;
                    tryNativeHls();
                  });
                } else {
                  tryNativeHls();
                }
              } else {
                // Altri errori di rete
                tryNativeHls();
              }
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              if (data.details === 'bufferAppendError' ||
                  data.details === 'bufferAppendingError' ||
                  data.details === 'fragParsingError') {
                console.warn('Possible codec issue, trying native fallback...');
                tryNativePlayback(video, source);
              } else {
                tryNativeHls();
              }
              break;
            default:
              console.warn('HLS error, trying native fallback...');
              tryNativePlayback(video, source);
              break;
          }
        });
      } else if (isTS && mpegts.isSupported()) {
        // MPEG-TS - configurazioni differenziate per live/movies/series
        // (cleanup già fatto all'inizio di loadStream)

        // ============================================
        // MPEG-TS LIVE: RIPRODUZIONE ISTANTANEA
        // ============================================
        const mpegtsConfigLive = {
          enableWorker: true,
          // Buffer MINIMO per partenza immediata
          stashInitialSize: 32 * 1024, // 32KB - minimo assoluto
          lazyLoad: false, // Carica tutto subito
          lazyLoadMaxDuration: 3,
          deferLoadAfterSourceOpen: false,
          autoCleanupSourceBuffer: true,
          autoCleanupMaxBackwardDuration: 2, // Solo 2s backbuffer
          autoCleanupMinBackwardDuration: 1,
          fixAudioTimestampGap: true,
          // Inseguimento latenza ISTANTANEA
          liveBufferLatencyChasing: true,
          liveBufferLatencyMaxLatency: 0.8, // Max 800ms di ritardo
          liveBufferLatencyMinRemain: 0.2, // Min 200ms buffer
          seekType: 'range' as const,
        };

        // ============================================
        // MPEG-TS MOVIE: BUFFER AMPIO, SEEKING FLUIDO
        // ============================================
        const mpegtsConfigMovie = {
          enableWorker: true,
          stashInitialSize: 512 * 1024, // 512KB per avvio veloce con qualità
          lazyLoad: true,
          lazyLoadMaxDuration: 900, // 15 minuti
          lazyLoadRecoverDuration: 90,
          deferLoadAfterSourceOpen: false,
          autoCleanupSourceBuffer: true,
          autoCleanupMaxBackwardDuration: 180, // 3 minuti backbuffer
          autoCleanupMinBackwardDuration: 90,
          fixAudioTimestampGap: true,
          liveBufferLatencyChasing: false,
          seekType: 'range' as const,
          accurateSeek: true,
        };

        // ============================================
        // MPEG-TS SERIES: VIA DI MEZZO
        // ============================================
        const mpegtsConfigSeries = {
          enableWorker: true,
          stashInitialSize: 256 * 1024, // 256KB
          lazyLoad: true,
          lazyLoadMaxDuration: 600, // 10 minuti
          lazyLoadRecoverDuration: 60,
          deferLoadAfterSourceOpen: false,
          autoCleanupSourceBuffer: true,
          autoCleanupMaxBackwardDuration: 90, // 90s backbuffer
          autoCleanupMinBackwardDuration: 45,
          fixAudioTimestampGap: true,
          liveBufferLatencyChasing: false,
          seekType: 'range' as const,
          accurateSeek: true,
        };

        // Selezione configurazione
        let mpegtsConfig;
        if (isLive) {
          mpegtsConfig = mpegtsConfigLive;
        } else if (channel.type === 'series') {
          mpegtsConfig = mpegtsConfigSeries;
        } else {
          mpegtsConfig = mpegtsConfigMovie;
        }

        const player = mpegts.createPlayer({
          type: 'mpegts', url: source, isLive
        }, mpegtsConfig);

        mpegtsRef.current = player;
        player.attachMediaElement(video);
        player.load();
        const playPromise = player.play();
        if (playPromise) (playPromise as Promise<void>).catch(() => setIsPlaying(false));
        player.on(mpegts.Events.ERROR, () => {
          // Tenta fallback nativo
          console.warn('MPEGTS error, trying native fallback...');
          try { player.destroy(); } catch {}
          mpegtsRef.current = null;
          tryNativePlayback(video, source);
        });
      } else {
        // Native playback (MP4, MKV, etc.)
        // (cleanup già fatto all'inizio di loadStream)
        tryNativePlayback(video, source);
      }

      // Funzione helper per tentare riproduzione nativa con gestione errori avanzata
      function tryNativePlayback(videoEl: HTMLVideoElement, url: string) {
        // Su Android: prova prima il player nativo (ExoPlayer) che supporta HEVC
        if (platformService.isAndroid && nativeVideoPlayer.isAvailable) {
          console.log('[NativePlayer] Using ExoPlayer for Android (HEVC support)');
          setIsBuffering(true);

          nativeVideoPlayer.play({
            url: url,
            title: channel?.cleanName || channel?.name || 'Video',
            subtitle: channel?.group || '',
            poster: channel?.logo || '',
            autoplay: true,
            fullscreen: true,
          }).then((success) => {
            if (success) {
              console.log('[NativePlayer] ExoPlayer started successfully');
              setIsBuffering(false);
              setIsPlaying(true);
              // Il player nativo gestisce tutto, nascondi il video HTML
              videoEl.style.display = 'none';
            } else {
              console.warn('[NativePlayer] ExoPlayer failed, falling back to WebView');
              videoEl.style.display = '';
              // Fallback al player WebView standard
              playInWebView(videoEl, url);
            }
          }).catch((err) => {
            console.error('[NativePlayer] ExoPlayer error:', err);
            videoEl.style.display = '';
            playInWebView(videoEl, url);
          });

          // Listener per quando il player nativo viene chiuso
          nativeVideoPlayer.on('exit', () => {
            videoEl.style.display = '';
            setIsPlaying(false);
            if (onBack) onBack();
          });

          return;
        }

        // Fallback: riproduzione standard nel WebView
        playInWebView(videoEl, url);
      }

      // Riproduzione nel WebView (fallback)
      function playInWebView(videoEl: HTMLVideoElement, url: string) {
        videoEl.src = url;

        const handleError = () => {
          const mediaError = videoEl.error;
          let errorMsg = 'Formato Non Supportato';

          if (mediaError) {
            switch (mediaError.code) {
              case MediaError.MEDIA_ERR_ABORTED:
                errorMsg = 'Riproduzione Interrotta';
                break;
              case MediaError.MEDIA_ERR_NETWORK:
                errorMsg = 'Errore di Rete';
                break;
              case MediaError.MEDIA_ERR_DECODE:
                // Questo è spesso il caso per HEVC/4K non supportato
                errorMsg = 'Codec Non Supportato (HEVC/4K)';
                console.warn('Decode error - likely unsupported codec:', mediaError.message);

                // Su Android: prova il player nativo come ultima risorsa
                if (platformService.isAndroid) {
                  console.log('[VideoPlayer] Codec error detected, trying native ExoPlayer...');
                  nativeVideoPlayer.init().then((available) => {
                    if (available) {
                      nativeVideoPlayer.play({
                        url: url,
                        title: channel?.cleanName || channel?.name || 'Video',
                        autoplay: true,
                        fullscreen: true,
                      });
                    }
                  });
                  return; // Non mostrare errore, stiamo provando il player nativo
                }
                break;
              case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
                errorMsg = 'Formato Video Non Supportato';
                break;
            }
          }

          setError(errorMsg);
          setIsBuffering(false);
        };

        videoEl.onerror = handleError;

        // Gestione eventi per rilevare problemi di codec durante la riproduzione
        const handleStalled = () => {
          console.warn('Video stalled - possible codec issue');
        };

        videoEl.addEventListener('stalled', handleStalled, { once: true });

        videoEl.play().catch((err) => {
          console.warn('Native playback failed:', err);
          // Se il play fallisce ma non c'è già un errore, potrebbe essere un problema di codec
          if (!videoEl.error) {
            // Attendi un attimo per vedere se arriva un errore più specifico
            setTimeout(() => {
              if (!videoEl.error && videoEl.readyState < 2) {
                // Su Android: prova il player nativo
                if (platformService.isAndroid) {
                  console.log('[VideoPlayer] Playback timeout, trying native ExoPlayer...');
                  nativeVideoPlayer.init().then((available) => {
                    if (available) {
                      nativeVideoPlayer.play({
                        url: url,
                        title: channel?.cleanName || channel?.name || 'Video',
                        autoplay: true,
                        fullscreen: true,
                      });
                    } else {
                      setError('Impossibile Riprodurre - Codec Non Supportato');
                      setIsBuffering(false);
                    }
                  });
                } else {
                  setError('Impossibile Riprodurre - Codec Non Supportato');
                  setIsBuffering(false);
                }
              }
            }, 2000);
          }
          setIsPlaying(false);
        });
      }

      // Metadata solo per movie
      setMeta(null);
      if (channel && channel.type === 'movie') {
        const query = channel.cleanName || channel.name;
        MetadataService.searchTMDB(query, 'movie', channel.year).then(res => {
          if (res?.id) MetadataService.getDetails(res.id, 'movie').then(setMeta);
        });
      }
    };

    // LIVE: avvio IMMEDIATO senza debounce
    // VOD: piccolo debounce per evitare rimbalzi durante navigazione
    if (isLive) {
      // Cancella eventuali timer precedenti
      if (debounceTimerRef.current) {
        window.clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      // Avvia SUBITO
      loadStream();
    } else {
      // VOD: debounce di 50ms
      if (debounceTimerRef.current) window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = window.setTimeout(loadStream, 50);
    }

    return () => {
      if (debounceTimerRef.current) window.clearTimeout(debounceTimerRef.current);
    };
  }, [channel]);

  // Prewarm/Persistenza cache per canali adiacenti - SOLO per VOD/Series, NON per Live
  useEffect(() => {
    if (!channel || !playlist?.length) return;

    // DISABILITA PREWARM PER LIVE - interferisce con lo streaming
    if (channel.type === 'live') return;

    const idx = playlist.findIndex(c => c.id === channel.id);

    // Prewarm più canali: prev, next, next+1 per zapping fluido (solo VOD/Series)
    const neighbors: Channel[] = [];
    if (idx > 0) neighbors.push(playlist[idx - 1]);
    if (idx < playlist.length - 1) neighbors.push(playlist[idx + 1]);
    if (idx < playlist.length - 2) neighbors.push(playlist[idx + 2]);

    // Prewarm in parallelo (solo per VOD/Series)
    neighbors.forEach(c => {
      if (!c?.url) return;

      // DNS/TLS warmup
      prewarm(c.url);

      // HLS prewarm solo per m3u8 VOD/Series
      const isM3U8 = c.url.toLowerCase().includes('.m3u8');
      if (isM3U8 && (Hls as any).isSupported() && !warmCacheRef.current.has(c.id)) {
        const doWarm = () => {
          try {
            const h = warmHls(c.url, false); // false = non è live
            cachePut(c.id, h);
          } catch { /* ignore */ }
        };

        if ('requestIdleCallback' in window) {
          (window as any).requestIdleCallback(doWarm, { timeout: 1000 });
        } else {
          setTimeout(doWarm, 100);
        }
      }
    });

    return () => {
      // nessuna azione: LRU gestisce la dimensione automaticamente
    };
  }, [channel, playlist]);

  // Cleanup su unmount
  useEffect(() => {
    return () => {
      // Ferma tutti i download prima di distruggere
      try {
        hlsRef.current?.stopLoad();
        hlsRef.current?.detachMedia();
        hlsRef.current?.destroy();
      } catch {}
      try {
        mpegtsRef.current?.pause();
        mpegtsRef.current?.unload();
        mpegtsRef.current?.detachMediaElement();
        mpegtsRef.current?.destroy();
      } catch {}
      warmCacheRef.current.forEach(h => {
        try {
          h.stopLoad();
          h.destroy();
        } catch {}
      });
      warmCacheRef.current.clear();
    };
  }, []);

  // Keyboard Handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        if (!channel) return;
        const video = videoRef.current;
        if (!video) return;

        resetControlsTimeout();

        if (showPlaylist) {
            if (e.key === 'Escape' || e.key === 'ArrowLeft') {
                setShowPlaylist(false);
                containerRef.current?.focus();
            }
            return; 
        }

        const isLive = channel.type === 'live';
        switch (e.key) {
            case 'ArrowLeft':
                if (isLive) { if (onPrev) { onPrev(); showOSD(SkipBack, 'Prev'); } }
                else { video.currentTime = Math.max(0, video.currentTime - 10); showOSD(Rewind, "-10s"); }
                break;
            case 'ArrowRight':
                if (isLive) { if (onNext) { onNext(); showOSD(SkipForward, 'Next'); } }
                else { video.currentTime = Math.min(video.duration, video.currentTime + 10); showOSD(FastForward, "+10s"); }
                break;
            case 'ArrowUp':
                // Playlist solo per series, non per live e movies
                if (channel.type === 'series') {
                    e.preventDefault();
                    setShowPlaylist(true);
                    setTimeout(() => {
                        const el = document.getElementById(`plist-${channel.id}`);
                        el?.scrollIntoView({block: 'center'});
                        el?.focus();
                    }, 100);
                } else {
                    // Per live e movies: aumenta volume
                    const newVolUp = Math.min(1, video.volume + 0.1);
                    video.volume = newVolUp;
                    setVolume(newVolUp);
                    showOSD(Volume2, `${Math.round(newVolUp * 100)}%`);
                }
                break;
            case 'ArrowDown':
                const newVolDown = Math.max(0, video.volume - 0.1);
                video.volume = newVolDown;
                setVolume(newVolDown);
                showOSD(Volume2, `${Math.round(newVolDown * 100)}%`);
                break;
            case ' ':
            case 'Enter':
                const activeTag = document.activeElement?.tagName.toLowerCase();
                if (activeTag !== 'button' && activeTag !== 'input') {
                    togglePlay();
                    showOSD(isPlaying ? Pause : Play);
                }
                break;
            case 'm':
                toggleMute();
                showOSD(isMuted ? Volume2 : VolumeX);
                break;
            case 'f':
                toggleFull();
                break;
            case 'p':
                togglePiP();
                break;
            case 'c':
                if (cast.isAvailable) {
                    toggleCast();
                }
                break;
        }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [channel, isFullscreen, isPlaying, isMuted, isPiP, showPlaylist, cast.isAvailable, cast.isConnected]);

  // Video Events
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const updateBuffer = () => {
        if (video.duration > 0 && video.buffered.length > 0) {
            let b = 0;
            // Per VOD: trova il punto bufferizzato più avanti dopo la posizione corrente
            // Per Live: trova il buffer che copre la posizione corrente
            const isVOD = channel?.type === 'movie' || channel?.type === 'series';

            for(let i = 0; i < video.buffered.length; i++) {
                const start = video.buffered.start(i);
                const end = video.buffered.end(i);

                if (isVOD) {
                    // VOD: mostra tutto il buffer disponibile dopo la posizione corrente
                    if (end > video.currentTime && start <= video.currentTime + 1) {
                        b = Math.max(b, end);
                    }
                } else {
                    // Live: buffer che contiene la posizione corrente
                    if (start <= video.currentTime + 0.5 && end >= video.currentTime - 0.5) {
                        b = end;
                        break;
                    }
                }
            }
            setBuffered(b);
        }
    };

    const onTime = () => { 
        if(!isSeeking) {
            setCurrentTime(video.currentTime);
            
            // Update progress ogni 5 secondi o se > 1% change
            const now = Date.now();
            if (onProgress && video.duration > 0 && (now - lastProgressUpdate.current > 5000)) {
                lastProgressUpdate.current = now;
                onProgress(video.currentTime / video.duration, video.duration);
            }
        }
        updateBuffer();
    };
    
    const onMeta = () => {
        setDuration(video.duration);

        // Riprendi dalla posizione salvata per playback NATIVO (non HLS)
        // Per HLS il seek è già fatto in MANIFEST_PARSED
        const isHlsActive = hlsRef.current !== null;
        if (!isHlsActive && initialProgress && initialProgress > 0 && initialProgress < 0.95 && channel?.type !== 'live') {
            const resumeTime = video.duration * initialProgress;
            // Riprendi solo se il progresso è significativo (> 30 secondi) e non quasi alla fine
            if (resumeTime > 30 && resumeTime < video.duration - 60) {
                console.log(`[VideoPlayer] Ripresa nativa dalla posizione: ${Math.round(resumeTime)}s (${Math.round(initialProgress * 100)}%)`);
                video.currentTime = resumeTime;
                showOSD(FastForward, `Ripresa da ${formatTime(resumeTime)}`);
            }
        }
    };

    const onEnd = () => { 
        if (onProgress && video.duration > 0) onProgress(1, video.duration);
        if (onNext) onNext();
    };

    // Eventi aggiuntivi per gestione buffering VOD
    const onWaiting = () => {
        // Video in attesa di dati - mostra spinner
        setIsBuffering(true);
        updateBuffer();
    };

    const onCanPlay = () => {
        // Pronto a riprodurre - nascondi spinner
        setIsBuffering(false);
        updateBuffer();
    };

    const onPlaying = () => {
        // In riproduzione attiva
        setIsBuffering(false);
    };

    const onSeeked = () => {
        // Dopo seek completato, aggiorna buffer
        updateBuffer();
        setIsSeeking(false);
    };

    video.addEventListener('timeupdate', onTime);
    video.addEventListener('progress', updateBuffer);
    video.addEventListener('loadedmetadata', onMeta);
    video.addEventListener('ended', onEnd);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('canplay', onCanPlay);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('seeked', onSeeked);

    return () => {
        video.removeEventListener('timeupdate', onTime);
        video.removeEventListener('progress', updateBuffer);
        video.removeEventListener('loadedmetadata', onMeta);
        video.removeEventListener('ended', onEnd);
        video.removeEventListener('waiting', onWaiting);
        video.removeEventListener('canplay', onCanPlay);
        video.removeEventListener('playing', onPlaying);
        video.removeEventListener('seeked', onSeeked);
    };
  }, [isSeeking, onNext, onProgress, channel]);

  // Watchdog anti-stallo: tenta recupero automatico se il tempo non avanza o readyState basso
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let lastTime = -1;
    let attempts = 0;
    let stallStart = 0;
    let firstPlayTime = 0; // Traccia quando è iniziata la riproduzione

    const reset = () => { attempts = 0; lastTime = video.currentTime; stallStart = 0; };

    // Listener per tracciare quando inizia effettivamente la riproduzione
    const onPlaying = () => { firstPlayTime = Date.now(); };
    video.addEventListener('playing', onPlaying);

    const tick = () => {
      if (!channel) return;
      // Evita falsi positivi quando in pausa o durante seek
      if (video.paused || video.seeking) { reset(); return; }

      const advancing = video.currentTime > (lastTime + 0.05);
      const readyOk = video.readyState >= 3; // HAVE_FUTURE_DATA

      if (!advancing || !readyOk) {
        if (stallStart === 0) stallStart = Date.now();
        attempts++;

        const isLive = channel.type === 'live';
        const isSeries = channel.type === 'series';
        const hls = hlsRef.current;
        const ts = mpegtsRef.current;
        const stallDuration = Date.now() - stallStart;
        const timeSincePlay = firstPlayTime > 0 ? Date.now() - firstPlayTime : 0;

        // Per LIVE: non fare recovery durante i primi 10 secondi di riproduzione
        // perché il buffer potrebbe essere ancora in fase di riempimento
        if (isLive && timeSincePlay < 10000 && attempts < 5) {
          // Solo aspetta, non fare recovery aggressivo
          lastTime = video.currentTime;
          return;
        }

        // Soglie diverse per tipo di contenuto (più alte per live)
        const stallThreshold = isLive ? 3000 : isSeries ? 2000 : 3000;

        if (hls) {
          try {
            if (attempts === 1 && !isLive) {
              // recoverMediaError solo per VOD/Series, non per live
              hls.recoverMediaError();
            } else if (attempts === 2) {
              hls.startLoad();
            } else if (attempts >= 3 && stallDuration > stallThreshold) {
              if (isLive) {
                // Live: salto più aggressivo per uscire da buchi
                video.currentTime = video.currentTime + 0.3;
                attempts = 0;
              } else {
                // VOD/Series: cerca il punto bufferizzato più vicino
                let foundBuffered = false;
                for (let i = 0; i < video.buffered.length; i++) {
                  const start = video.buffered.start(i);
                  const end = video.buffered.end(i);
                  if (video.currentTime < start && start - video.currentTime < 10) {
                    video.currentTime = start + 0.1;
                    foundBuffered = true;
                    break;
                  }
                  if (video.currentTime >= start && video.currentTime <= end) {
                    video.currentTime = video.currentTime + 0.2;
                    foundBuffered = true;
                    break;
                  }
                }
                if (!foundBuffered) {
                  hls.startLoad(video.currentTime);
                }
                attempts = 0;
                stallStart = 0;
              }
            }
          } catch {}
        } else if (ts) {
          try {
            if (attempts === 1 && !isLive) {
              ts.unload();
              ts.load();
            } else if (attempts >= 2 && stallDuration > stallThreshold) {
              if (isLive) {
                video.currentTime = video.currentTime + 0.3;
              } else {
                const targetTime = video.currentTime + 0.3;
                ts.unload();
                ts.load();
                setTimeout(() => {
                  try { video.currentTime = targetTime; } catch {}
                }, 100);
              }
              attempts = 0;
              stallStart = 0;
            }
          } catch {}
        }
      } else {
        attempts = 0;
        stallStart = 0;
      }

      lastTime = video.currentTime;
    };

    // Intervallo differenziato: più frequente per live
    const isLive = channel?.type === 'live';
    const interval = isLive ? 500 : 1000; // 500ms per live, 1s per VOD
    const id = window.setInterval(tick, interval);
    video.addEventListener('canplay', reset);
    video.addEventListener('playing', reset);
    return () => {
      window.clearInterval(id);
      video.removeEventListener('canplay', reset);
      video.removeEventListener('playing', reset);
      video.removeEventListener('playing', onPlaying);
    };
  }, [channel]);

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
        // I download rimangono in pausa - sono già fermati quando il player è a schermo
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };
  const toggleMute = () => { if (videoRef.current) { videoRef.current.muted = !isMuted; setIsMuted(!isMuted); }};

  const handleVolumeChange = (value: number) => {
    if (videoRef.current) {
      videoRef.current.volume = value;
      videoRef.current.muted = value === 0;
      setIsMuted(value === 0);
      setVolume(value);
    }
  };

  const skipTime = (seconds: number) => {
    if (videoRef.current) {
      const newTime = Math.max(0, Math.min(videoRef.current.currentTime + seconds, duration));
      videoRef.current.currentTime = newTime;
      setCurrentTime(newTime);
      showOSD(seconds > 0 ? FastForward : Rewind, `${seconds > 0 ? '+' : ''}${seconds}s`);
    }
  };

  const toggleFull = () => {
      if (!containerRef.current) return; 
      if (!document.fullscreenElement) containerRef.current.requestFullscreen().then(() => setIsFullscreen(true));
      else document.exitFullscreen().then(() => setIsFullscreen(false));
  };

  // Picture-in-Picture
  const togglePiP = async () => {
      const video = videoRef.current;
      if (!video) return;

      try {
          if (document.pictureInPictureElement) {
              await document.exitPictureInPicture();
              setIsPiP(false);
              showOSD(PictureInPicture2, 'PiP disattivato');
          } else if (document.pictureInPictureEnabled) {
              await video.requestPictureInPicture();
              setIsPiP(true);
              showOSD(PictureInPicture2, 'PiP attivato');
          }
      } catch (err) {
          console.warn('PiP error:', err);
      }
  };

  // Ascolta eventi PiP per sincronizzare lo stato
  useEffect(() => {
      const video = videoRef.current;
      if (!video) return;

      const onEnterPiP = () => setIsPiP(true);
      const onLeavePiP = () => setIsPiP(false);

      video.addEventListener('enterpictureinpicture', onEnterPiP);
      video.addEventListener('leavepictureinpicture', onLeavePiP);

      return () => {
          video.removeEventListener('enterpictureinpicture', onEnterPiP);
          video.removeEventListener('leavepictureinpicture', onLeavePiP);
      };
  }, [channel]);


  // Sincronizza stato cast con video locale
  useEffect(() => {
      if (cast.isConnected && videoRef.current) {
          // Quando il cast è connesso, pausa il video locale
          videoRef.current.pause();
          setIsPlaying(false);
      }
  }, [cast.isConnected]);

  // Seeking ottimizzato per VOD
  const seekDebounceRef = useRef<number | null>(null);
  const pendingSeekRef = useRef<number | null>(null);

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
      const t = parseFloat(e.target.value);
      setCurrentTime(t); // Aggiorna UI immediatamente per feedback visivo
      pendingSeekRef.current = t;

      // Debounce il seek effettivo per evitare troppi seek durante il drag
      if (seekDebounceRef.current) window.clearTimeout(seekDebounceRef.current);
      seekDebounceRef.current = window.setTimeout(() => {
          if (pendingSeekRef.current !== null && videoRef.current) {
              const targetTime = pendingSeekRef.current;
              setIsBuffering(true);

              // Pre-load il segmento target per HLS
              if (hlsRef.current) {
                  try {
                      hlsRef.current.startLoad(targetTime);
                  } catch {}
              }

              // Usa fastSeek se disponibile per seeking più fluido
              if ('fastSeek' in videoRef.current && typeof (videoRef.current as any).fastSeek === 'function') {
                  (videoRef.current as any).fastSeek(targetTime);
              } else {
                  videoRef.current.currentTime = targetTime;
              }
              pendingSeekRef.current = null;
          }
      }, 150); // 150ms debounce per bilanciare reattività e performance
  };

  const handleSeekStart = () => {
      setIsSeeking(true);
      // Pausa temporanea durante seeking per VOD per ridurre carico
      if (videoRef.current && (channel?.type === 'movie' || channel?.type === 'series')) {
          videoRef.current.pause();
      }
  };

  const handleSeekEnd = () => {
      setIsSeeking(false);
      // Riprendi riproduzione dopo seek
      if (videoRef.current && (channel?.type === 'movie' || channel?.type === 'series')) {
          videoRef.current.play().catch(() => {});
      }
      // Forza seek finale se c'è un valore pending
      if (pendingSeekRef.current !== null && videoRef.current) {
          if (seekDebounceRef.current) window.clearTimeout(seekDebounceRef.current);
          videoRef.current.currentTime = pendingSeekRef.current;
          pendingSeekRef.current = null;
      }
  };

  const formatTime = (s: number) => {
      if (!s || isNaN(s)) return "0:00";
      const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = Math.floor(s%60);
      return h > 0 ? `${h}:${m.toString().padStart(2,'0')}:${sec.toString().padStart(2,'0')}` : `${m}:${sec.toString().padStart(2,'0')}`;
  };

  // Riparti dall'inizio
  const restartFromBeginning = () => {
      if (videoRef.current) {
          videoRef.current.currentTime = 0;
          videoRef.current.play().catch(() => {});
          showOSD(RotateCcw, 'Dall\'inizio');
          // Notifica il reset del progresso
          if (onResetProgress) {
              onResetProgress();
          }
          // Aggiorna anche immediatamente il progresso a 0
          if (onProgress) {
              onProgress(0, duration);
          }
      }
  };

  if (!channel) return null;
  const backdrop = MetadataService.getImageUrl(meta?.backdrop_path, 'original');
  const showSeekBar = duration > 0 && duration !== Infinity && channel.type !== 'live';

  return (
    <div 
        ref={containerRef}
        className="relative w-full h-full bg-black flex flex-col overflow-hidden outline-none group select-none"
        onMouseMove={resetControlsTimeout}
        tabIndex={0} 
    >
      <video 
        ref={videoRef} 
        className="absolute inset-0 w-full h-full object-contain z-10 bg-black" 
        poster={channel.type === 'movie' ? (channel.logo || undefined) : undefined}
        playsInline
      />
      
      {backdrop && (
          <div className={`absolute inset-0 z-0 bg-cover bg-center transition-opacity duration-1000 ${(!isPlaying || showControls) ? 'opacity-30 blur-sm' : 'opacity-0'}`} style={{ backgroundImage: `url(${backdrop})` }} />
      )}

      {/* Buffering Spinner - Design migliorato */}
      {isBuffering && !error && !cast.isConnected && (
          <div className="absolute inset-0 z-40 flex items-center justify-center pointer-events-none bg-black/30">
              <div className="flex flex-col items-center gap-4">
                  <div className="relative">
                      <div className="w-16 h-16 border-4 border-white/20 border-t-red-500 rounded-full animate-spin"></div>
                      <div className="absolute inset-0 flex items-center justify-center">
                          <Play className="w-6 h-6 text-white/50" />
                      </div>
                  </div>
                  <span className="text-white/90 text-sm font-medium bg-black/50 px-4 py-1.5 rounded-full backdrop-blur-sm">
                      Caricamento...
                  </span>
              </div>
          </div>
      )}

      {/* Cast Overlay - mostra quando si sta trasmettendo */}
      {cast.isConnected && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/80 pointer-events-none">
              <div className="flex flex-col items-center gap-6 text-center px-8">
                  <Cast className="w-20 h-20 text-blue-400 animate-pulse" />
                  <div className="space-y-2">
                      <h3 className="text-2xl font-bold text-white">Trasmissione in corso</h3>
                      <p className="text-lg text-gray-300">
                          Stai guardando su <span className="text-blue-400 font-semibold">{cast.deviceName}</span>
                      </p>
                      <p className="text-sm text-gray-500 mt-4">
                          {channel?.cleanName || channel?.name}
                      </p>
                  </div>
                  <button
                      onClick={toggleCast}
                      className="mt-4 px-6 py-3 bg-red-600 hover:bg-red-500 text-white rounded-lg font-semibold transition-colors pointer-events-auto"
                  >
                      Interrompi trasmissione
                  </button>
              </div>
          </div>
      )}

      {/* OSD - Design migliorato */}
      {osdMessage && (
          <div className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none">
              <div className="bg-black/70 backdrop-blur-xl p-6 rounded-2xl flex flex-col items-center gap-3 border border-white/10 shadow-2xl animate-fade-in">
                  <div className="p-4 bg-white/10 rounded-full">
                      <osdMessage.icon className="w-10 h-10 text-white" />
                  </div>
                  {osdMessage.text && <span className="text-lg font-semibold text-white">{osdMessage.text}</span>}
              </div>
          </div>
      )}
      
      {/* PLAYLIST / ZAPPING OVERLAY */}
      <div className={`absolute top-0 right-0 bottom-0 w-80 bg-black/90 backdrop-blur-xl border-l border-white/10 z-[60] transform transition-transform duration-300 flex flex-col ${showPlaylist ? 'translate-x-0' : 'translate-x-full'}`}>
          <div className="p-4 border-b border-white/10 flex items-center justify-between">
              <h3 className="font-bold text-white">Canali ({playlist.length})</h3>
              <button onClick={() => setShowPlaylist(false)} className="tv-focus p-2 rounded-full hover:bg-white/10"><X className="w-5 h-5" /></button>
          </div>
          <div ref={playlistRef} className="flex-1 overflow-y-auto p-2 space-y-2">
              {playlist.map(c => (
                  <button 
                    key={c.id}
                    id={`plist-${c.id}`}
                    onClick={() => onChannelSelect && onChannelSelect(c)}
                    className={`tv-focus w-full text-left p-3 rounded-lg flex items-center gap-3 transition-colors ${c.id === channel.id ? 'bg-red-600 text-white' : 'hover:bg-white/10 text-gray-300'}`}
                  >
                      {/* Non caricare immagini durante live per risparmiare banda */}
                      {channel.type !== 'live' && c.logo ? (
                        <img src={c.logo} alt={c.name} className="w-8 h-8 object-contain bg-black rounded" loading="lazy" />
                      ) : (
                        <div className="w-8 h-8 bg-gray-700 rounded flex items-center justify-center text-xs">TV</div>
                      )}
                      <span className="truncate text-sm font-medium">{c.cleanName || c.name}</span>
                  </button>
              ))}
          </div>
      </div>

      {error && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80">
            <div className="bg-red-900/50 backdrop-blur border border-red-500/50 px-8 py-6 rounded-2xl flex flex-col items-center gap-3 max-w-md text-center">
                <AlertTriangle className="w-12 h-12 text-red-400" />
                <p className="text-xl font-medium text-white">{error}</p>
                {(error.includes('Codec') || error.includes('HEVC') || error.includes('4K') || error.includes('Formato')) && (
                    <p className="text-sm text-gray-300">
                        Questo contenuto potrebbe utilizzare un codec video (HEVC/H.265) non supportato dal browser.
                        Prova a riprodurre il contenuto con un player esterno.
                    </p>
                )}
                <div className="flex gap-3 mt-4">
                    <button
                        onClick={() => {
                            setError(null);
                            if (onBack) onBack();
                        }}
                        className="tv-focus px-6 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-lg font-medium transition-colors"
                    >
                        Chiudi
                    </button>
                    <button
                        onClick={() => {
                            setError(null);
                            setIsBuffering(true);
                            // Forza ricaricamento dello stream
                            if (videoRef.current && channel) {
                                videoRef.current.src = '';
                                setTimeout(() => {
                                    if (videoRef.current) {
                                        videoRef.current.src = channel.url;
                                        videoRef.current.play().catch(() => {});
                                    }
                                }, 100);
                            }
                        }}
                        className="tv-focus px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors"
                    >
                        Riprova
                    </button>
                </div>
            </div>
        </div>
      )}

      {/* CAST OVERLAY - Mostra quando c'è una sessione Cast attiva */}
      {castSession.isConnected && (
        <div
          className="absolute inset-0 z-[100] flex flex-col items-center justify-center bg-gradient-to-b from-black/90 via-black/70 to-black/90"
          style={{ pointerEvents: 'auto' }}
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
          <p className="text-gray-400 mb-8">{castSession.status.mediaTitle || channel?.cleanName || channel?.name}</p>

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
                  <div
                    className="absolute h-4 w-4 bg-white rounded-full shadow-lg -translate-y-1/2 top-1/2 opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ left: `calc(${(castSession.status.currentTime / castSession.status.duration) * 100}% - 8px)` }}
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
              onClick={async (e) => {
                e.stopPropagation();
                e.preventDefault();
                console.log('[Cast Controls] Play/Pause clicked!');
                console.log('[Cast Controls] State:', castSession.status.playerState);
                console.log('[Cast Controls] isConnected:', castSession.isConnected);

                try {
                  if (castSession.status.playerState === 'PLAYING') {
                    console.log('[Cast Controls] Calling pause()...');
                    await castSession.pause();
                    console.log('[Cast Controls] pause() returned');
                  } else {
                    console.log('[Cast Controls] Calling play()...');
                    await castSession.play();
                    console.log('[Cast Controls] play() returned');
                  }
                } catch (err) {
                  console.error('[Cast Controls] Error:', err);
                }
              }}
              className="p-5 rounded-full bg-white text-black hover:bg-gray-200 transition-colors shadow-lg active:scale-95"
            >
              {castSession.status.playerState === 'PLAYING' ?
                <Pause className="w-8 h-8" /> :
                <Play className="w-8 h-8 ml-1" />
              }
            </button>

            {/* Forward 10s */}
            <button
              onClick={async () => {
                console.log('[Cast Controls] Forward clicked');
                await castSession.seek(castSession.status.currentTime + 10);
              }}
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
              className="flex-1 h-2 bg-white/20 rounded-full appearance-none cursor-pointer
                [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-lg"
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

      {/* HEADER INFO - Design migliorato */}
      <div className={`absolute top-0 left-0 right-0 p-6 md:p-8 bg-gradient-to-b from-black/95 via-black/60 to-transparent transition-all duration-500 z-20 pointer-events-none ${showControls ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-10'}`}>
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h2 className="text-2xl md:text-4xl font-bold text-white tracking-tight drop-shadow-lg mb-2 line-clamp-1">
                {meta?.title || channel.cleanName || channel.name}
              </h2>
              <div className="flex flex-wrap items-center gap-2 md:gap-3">
                {channel.type === 'live' && (
                  <span className="flex items-center gap-1.5 bg-red-600 px-2.5 py-1 rounded-md text-white text-xs font-bold uppercase tracking-wide shadow-lg">
                    <span className="w-2 h-2 bg-white rounded-full animate-pulse"></span>
                    LIVE
                  </span>
                )}
                {meta?.release_date && (
                  <span className="bg-white/10 backdrop-blur-sm px-2.5 py-1 rounded-md text-white/90 text-xs font-medium">
                    {meta.release_date.split('-')[0]}
                  </span>
                )}
                {meta?.rating && (
                  <span className="bg-yellow-500/20 text-yellow-400 px-2.5 py-1 rounded-md text-xs font-bold">
                    ⭐ {Number(meta.rating).toFixed(1)}
                  </span>
                )}
                {channel.type !== 'live' && (
                  <span className="bg-white/10 backdrop-blur-sm px-2.5 py-1 rounded-md text-white/70 text-xs font-medium">
                    HD
                  </span>
                )}
              </div>
            </div>
            {/* Pulsante chiudi/indietro */}
            <button
              onClick={() => onBack ? onBack() : window.history.back()}
              className="pointer-events-auto p-2.5 rounded-full bg-black/50 hover:bg-black/70 text-white/80 hover:text-white transition-all backdrop-blur-sm border border-white/10"
              title="Chiudi"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
      </div>

      {/* CONTROLS - Design migliorato */}
      <div
        ref={controlsRef}
        onFocus={() => setShowControls(true)}
        className={`
            absolute bottom-0 left-0 right-0 p-4 md:p-6 bg-gradient-to-t from-black/95 via-black/80 to-transparent
            transition-all duration-500 ease-out z-40
            ${showControls ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'}
      `}>
          
          {showSeekBar && (
            <div className="flex items-center gap-3 md:gap-4 text-xs font-mono text-white/70 select-none mb-4">
                <span className="w-12 text-right tabular-nums">{formatTime(currentTime)}</span>
                <div className="relative flex-1 h-1 bg-white/20 rounded-full group/seek cursor-pointer hover:h-2 transition-all duration-200">

                    {/* Buffer Bar */}
                    <div 
                        className="absolute h-full bg-white/30 rounded-full transition-all duration-300"
                        style={{ width: `${Math.min((buffered / duration) * 100, 100)}%` }}
                    />

                    {/* Play Progress Bar */}
                    <div 
                        className="absolute h-full bg-gradient-to-r from-red-500 to-red-600 rounded-full transition-all"
                        style={{ width: `${(currentTime / duration) * 100}%` }}
                    >
                        {/* Thumb */}
                        <div className="absolute right-0 top-1/2 -translate-y-1/2 w-4 h-4 bg-red-500 rounded-full shadow-lg shadow-red-500/50 scale-0 group-hover/seek:scale-100 transition-transform border-2 border-white" />
                    </div>

                    <input 
                        type="range" min={0} max={duration} step="any" value={currentTime} onChange={handleSeek}
                        onMouseDown={handleSeekStart} onMouseUp={handleSeekEnd}
                        onTouchStart={handleSeekStart} onTouchEnd={handleSeekEnd}
                        className="tv-focus absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
                    />
                </div>
                <span className="w-12 tabular-nums">{formatTime(duration)}</span>
            </div>
          )}

          <div className="flex items-center justify-between max-w-5xl mx-auto">
              {/* Left Controls */}
              <div className="flex items-center gap-2 md:gap-3 flex-1">
                  {/* Volume */}
                  <div className="hidden md:flex items-center gap-2 group/vol">
                      <button
                        onClick={toggleMute}
                        className="tv-focus p-2.5 rounded-full hover:bg-white/10 text-white/80 hover:text-white transition-all"
                      >
                        {isMuted || (videoRef.current?.volume ?? 1) === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                      </button>
                      <div className="w-0 group-hover/vol:w-24 overflow-hidden transition-all duration-300">
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.05}
                          value={isMuted ? 0 : (videoRef.current?.volume ?? 1)}
                          onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                          className="w-full h-1 bg-white/30 rounded-full appearance-none cursor-pointer
                            [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3
                            [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full"
                        />
                      </div>
                  </div>

                  {/* Lista episodi */}
                  {channel.type === 'series' && (
                      <button onClick={() => setShowPlaylist(!showPlaylist)} className="tv-focus p-2.5 rounded-full hover:bg-white/10 text-white/80 hover:text-white transition-all" title="Lista episodi">
                          <List className="w-5 h-5" />
                      </button>
                  )}

                  {/* Riparti dall'inizio */}
                  {(channel.type === 'movie' || channel.type === 'series') && currentTime > 30 && (
                      <button onClick={restartFromBeginning} className="tv-focus p-2.5 rounded-full hover:bg-white/10 text-white/80 hover:text-white transition-all" title="Riparti dall'inizio">
                          <RotateCcw className="w-5 h-5" />
                      </button>
                  )}
              </div>

              {/* Center Controls - Playback */}
              <div className="flex items-center gap-2 md:gap-4">
                  {/* Rewind 10s */}
                  <button
                    onClick={() => skipTime(-10)}
                    className="tv-focus p-2 md:p-3 rounded-full hover:bg-white/10 text-white/80 hover:text-white transition-all"
                    title="Indietro 10s"
                  >
                    <Rewind className="w-5 h-5 md:w-6 md:h-6" />
                  </button>

                  {onPrev && (
                    <button onClick={onPrev} className="tv-focus p-2 md:p-3 rounded-full hover:bg-white/10 text-white"><SkipBack className="w-5 h-5 md:w-6 md:h-6" /></button>
                  )}

                  {/* Play/Pause - Central */}
                  <button
                    onClick={togglePlay} 
                    className="tv-focus p-4 md:p-5 rounded-full bg-white text-black hover:scale-110 shadow-xl shadow-white/20 transition-transform active:scale-95"
                  >
                    {isPlaying ? <Pause className="w-7 h-7 md:w-8 md:h-8" /> : <Play className="w-7 h-7 md:w-8 md:h-8 ml-0.5" />}
                  </button>

                  {onNext && (
                    <button onClick={onNext} className="tv-focus p-2 md:p-3 rounded-full hover:bg-white/10 text-white"><SkipForward className="w-5 h-5 md:w-6 md:h-6" /></button>
                  )}

                  {/* Forward 10s */}
                  <button
                    onClick={() => skipTime(10)}
                    className="tv-focus p-2 md:p-3 rounded-full hover:bg-white/10 text-white/80 hover:text-white transition-all"
                    title="Avanti 10s"
                  >
                    <FastForward className="w-5 h-5 md:w-6 md:h-6" />
                  </button>
              </div>

              {/* Right Controls */}
              <div className="flex items-center gap-2 md:gap-3 flex-1 justify-end">
                  {/* Stream Info / Codec */}
                  <button
                      onClick={toggleStreamInfo}
                      className={`tv-focus p-2.5 rounded-full hover:bg-white/10 transition-all ${showStreamInfo ? 'text-green-400' : 'text-white/80 hover:text-white'}`}
                      title="Info Codec"
                  >
                      <Info className="w-5 h-5" />
                  </button>

                  {/* Cast */}
                  <button
                      onClick={() => castSession.isConnected ? null : setShowDevicePicker(true)}
                      disabled={isCastLoading || castSession.isConnecting}
                      className={`tv-focus p-2.5 rounded-full hover:bg-white/10 transition-all ${
                        castSession.isConnected ? 'text-blue-400' : 'text-white/80 hover:text-white'
                      } ${isCastLoading || castSession.isConnecting ? 'opacity-50' : ''}`}
                      title={castSession.isConnected ? `Casting su ${castSession.device?.name}` : 'Trasmetti'}
                  >
                      {isCastLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Cast className="w-5 h-5" />}
                  </button>

                  {/* PiP */}
                  {document.pictureInPictureEnabled && (
                      <button onClick={togglePiP} className={`tv-focus p-2.5 rounded-full hover:bg-white/10 transition-all ${isPiP ? 'text-purple-400' : 'text-white/80 hover:text-white'}`} title="Picture-in-Picture">
                          <PictureInPicture2 className="w-5 h-5" />
                      </button>
                  )}

                  {/* Fullscreen */}
                  <button onClick={toggleFull} className="tv-focus p-2.5 rounded-full hover:bg-white/10 text-white/80 hover:text-white transition-all" title={isFullscreen ? 'Esci' : 'Schermo intero'}>
                      {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
                  </button>
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

            // Connect to device
            const connected = await castSession.connect(device);
            if (!connected) {
              setIsCastLoading(false);
              return false;
            }

            // Load media
            const loaded = await castSession.loadMedia(channel.url, channel.cleanName || channel.name);
            setIsCastLoading(false);

            if (loaded) {
              // Pause local video
              if (videoRef.current) {
                videoRef.current.pause();
              }
              showOSD(Cast, `Trasmissione su ${device.name}`);
            }

            return loaded;
          }}
          onCastStart={(device) => {
            console.log('[VideoPlayer] Cast starting to:', device);
            setIsCastLoading(true);
          }}
          onCastSuccess={(device) => {
            console.log('[VideoPlayer] Cast success to:', device);
            setIsCastLoading(false);
          }}
          onCastError={(error) => {
            console.log('[VideoPlayer] Cast message:', error);
            setIsCastLoading(false);
            showOSD(Cast, error);
          }}
        />
      )}

      {/* Cast message toast */}
      {castMessage && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[101] bg-black/90 text-white px-4 py-2 rounded-lg text-sm animate-fade-in">
          {castMessage}
        </div>
      )}

      {/* STREAM INFO PANEL - Pannello informazioni codec e log */}
      {showStreamInfo && (
        <div className="absolute top-0 left-0 bottom-0 w-96 max-w-[90vw] bg-black/95 backdrop-blur-xl border-r border-white/10 z-[70] transform transition-transform duration-300 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="p-4 border-b border-white/10 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <Info className="w-5 h-5 text-green-400" />
              <h3 className="font-bold text-white">Info Stream</h3>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={collectStreamInfo}
                className="tv-focus px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-500 text-white text-xs font-medium transition-colors"
              >
                Aggiorna
              </button>
              <button
                onClick={() => setShowStreamInfo(false)}
                className="tv-focus p-2 rounded-full hover:bg-white/10"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Content - scrollabile */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {streamInfo ? (
              <>
                {/* Video Info */}
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Video</h4>
                  <div className="bg-white/5 rounded-lg p-3 space-y-2">
                    <div className="flex justify-between">
                      <span className="text-gray-400 text-sm">Codec</span>
                      <span className={`text-sm font-medium ${
                        !streamInfo.videoCodec ? 'text-gray-500 italic' :
                        streamInfo.isHEVC ? 'text-yellow-400' : 
                        streamInfo.isDolbyVision ? 'text-purple-400' : 'text-white'
                      }`}>
                        {streamInfo.videoCodec || 'Non rilevato'}
                        {streamInfo.isHEVC && ' ⚠️'}
                        {streamInfo.isDolbyVision && ' 🎬'}
                      </span>
                    </div>
                    {streamInfo.videoCodecId && (
                      <div className="flex justify-between">
                        <span className="text-gray-400 text-sm">Codec ID</span>
                        <span className="text-white font-mono text-xs">{streamInfo.videoCodecId}</span>
                      </div>
                    )}
                    {streamInfo.videoProfile && (
                      <div className="flex justify-between">
                        <span className="text-gray-400 text-sm">Profilo</span>
                        <span className="text-white text-sm">{streamInfo.videoProfile}</span>
                      </div>
                    )}
                    {streamInfo.videoLevel && (
                      <div className="flex justify-between">
                        <span className="text-gray-400 text-sm">Livello</span>
                        <span className="text-white text-sm">L{streamInfo.videoLevel}</span>
                      </div>
                    )}
                    {streamInfo.videoBitDepth && (
                      <div className="flex justify-between">
                        <span className="text-gray-400 text-sm">Bit Depth</span>
                        <span className={`text-sm ${streamInfo.videoBitDepth > 8 ? 'text-cyan-400' : 'text-white'}`}>
                          {streamInfo.videoBitDepth}-bit {streamInfo.videoBitDepth > 8 && '✨'}
                        </span>
                      </div>
                    )}
                    {streamInfo.videoHDR && (
                      <div className="flex justify-between">
                        <span className="text-gray-400 text-sm">HDR</span>
                        <span className="text-amber-400 text-sm">
                          ✓ {streamInfo.isDolbyVision ? 'Dolby Vision' :
                             streamInfo.isHDR10 ? 'HDR10' :
                             streamInfo.isHLG ? 'HLG' :
                             streamInfo.videoColorSpace || 'HDR'}
                        </span>
                      </div>
                    )}
                    {streamInfo.width && streamInfo.height && (
                      <div className="flex justify-between">
                        <span className="text-gray-400 text-sm">Risoluzione</span>
                        <span className="text-white text-sm">
                          {streamInfo.width}×{streamInfo.height}
                          <span className="text-gray-500 ml-1">
                            {streamInfo.height >= 2160 ? '(4K)' :
                             streamInfo.height >= 1440 ? '(2K)' :
                             streamInfo.height >= 1080 ? '(FHD)' :
                             streamInfo.height >= 720 ? '(HD)' : '(SD)'}
                          </span>
                        </span>
                      </div>
                    )}
                    {streamInfo.frameRate && (
                      <div className="flex justify-between">
                        <span className="text-gray-400 text-sm">Frame Rate</span>
                        <span className="text-white text-sm">{streamInfo.frameRate.toFixed(2)} fps</span>
                      </div>
                    )}
                    {(streamInfo.bitrate || streamInfo.videoBitrate) && (
                      <div className="flex justify-between">
                        <span className="text-gray-400 text-sm">Bitrate</span>
                        <span className="text-white text-sm">{((streamInfo.videoBitrate || streamInfo.bitrate)! / 1000000).toFixed(2)} Mbps</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Audio Info */}
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Audio</h4>
                  <div className="bg-white/5 rounded-lg p-3 space-y-2">
                    <div className="flex justify-between">
                      <span className="text-gray-400 text-sm">Codec</span>
                      <span className={`text-sm font-medium ${!streamInfo.audioCodec ? 'text-gray-500 italic' : 'text-white'}`}>
                        {streamInfo.audioCodec || 'Non rilevato'}
                      </span>
                    </div>
                    {streamInfo.audioCodecId && (
                      <div className="flex justify-between">
                        <span className="text-gray-400 text-sm">Codec ID</span>
                        <span className="text-white font-mono text-xs">{streamInfo.audioCodecId}</span>
                      </div>
                    )}
                    {streamInfo.audioChannels && (
                      <div className="flex justify-between">
                        <span className="text-gray-400 text-sm">Canali</span>
                        <span className="text-white text-sm">
                          {streamInfo.audioChannels === 1 ? 'Mono' :
                           streamInfo.audioChannels === 2 ? 'Stereo (2.0)' :
                           streamInfo.audioChannels === 6 ? 'Surround 5.1' :
                           streamInfo.audioChannels === 8 ? 'Surround 7.1' :
                           `${streamInfo.audioChannels} canali`}
                        </span>
                      </div>
                    )}
                    {streamInfo.audioSampleRate && (
                      <div className="flex justify-between">
                        <span className="text-gray-400 text-sm">Sample Rate</span>
                        <span className="text-white text-sm">{(streamInfo.audioSampleRate / 1000).toFixed(1)} kHz</span>
                      </div>
                    )}
                    {streamInfo.audioBitrate && (
                      <div className="flex justify-between">
                        <span className="text-gray-400 text-sm">Bitrate</span>
                        <span className="text-white text-sm">{streamInfo.audioBitrate} kbps</span>
                      </div>
                    )}
                    {streamInfo.audioLanguage && (
                      <div className="flex justify-between">
                        <span className="text-gray-400 text-sm">Lingua</span>
                        <span className="text-white text-sm">{streamInfo.audioLanguage}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Playback Quality */}
                {(streamInfo.totalFrames > 0 || streamInfo.droppedFrames > 0) && (
                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Qualità Playback</h4>
                    <div className="bg-white/5 rounded-lg p-3 space-y-2">
                      {streamInfo.totalFrames > 0 && (
                        <div className="flex justify-between">
                          <span className="text-gray-400 text-sm">Frame Totali</span>
                          <span className="text-white text-sm">{streamInfo.totalFrames.toLocaleString()}</span>
                        </div>
                      )}
                      {streamInfo.droppedFrames > 0 && (
                        <div className="flex justify-between">
                          <span className="text-gray-400 text-sm">Frame Persi</span>
                          <span className={`text-sm ${streamInfo.frameDropRate > 1 ? 'text-yellow-400' : 'text-green-400'}`}>
                            {streamInfo.droppedFrames} ({streamInfo.frameDropRate.toFixed(2)}%)
                            {streamInfo.frameDropRate > 1 ? ' ⚠️' : ' ✓'}
                          </span>
                        </div>
                      )}
                      {streamInfo.corruptedFrames > 0 && (
                        <div className="flex justify-between">
                          <span className="text-gray-400 text-sm">Frame Corrotti</span>
                          <span className="text-red-400 text-sm">{streamInfo.corruptedFrames} ⚠️</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Container/Protocol */}
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Streaming</h4>
                  <div className="bg-white/5 rounded-lg p-3 space-y-2">
                    <div className="flex justify-between">
                      <span className="text-gray-400 text-sm">Protocollo</span>
                      <span className="text-white text-sm">{streamInfo.protocol || 'N/A'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400 text-sm">Container</span>
                      <span className="text-white text-sm">{streamInfo.container || 'N/A'}</span>
                    </div>
                    {streamInfo.mimeType && (
                      <div className="flex justify-between">
                        <span className="text-gray-400 text-sm">MIME Type</span>
                        <span className="text-white font-mono text-xs truncate max-w-[180px]">{streamInfo.mimeType}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Supporto */}
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Compatibilità</h4>
                  <div className={`rounded-lg p-3 ${streamInfo.isSupported ? 'bg-green-500/10 border border-green-500/30' : 'bg-red-500/10 border border-red-500/30'}`}>
                    <div className="flex items-center gap-2">
                      <span className={`text-2xl ${streamInfo.isSupported ? '' : ''}`}>
                        {streamInfo.isSupported ? '✅' : '❌'}
                      </span>
                      <div className="flex-1">
                        <p className={`text-sm font-medium ${streamInfo.isSupported ? 'text-green-400' : 'text-red-400'}`}>
                          {streamInfo.supportDetails}
                        </p>
                        <div className="flex flex-wrap gap-2 mt-1">
                          {streamInfo.hardwareAccelerated && (
                            <span className="text-xs text-cyan-400">🚀 HW Accel</span>
                          )}
                          {streamInfo.powerEfficient && (
                            <span className="text-xs text-green-400">⚡ Power Efficient</span>
                          )}
                        </div>
                        {streamInfo.isHEVC && !streamInfo.isSupported && (
                          <p className="text-xs text-gray-400 mt-1">
                            HEVC/H.265 potrebbe non essere supportato da questo browser
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Detection Info */}
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Rilevamento</h4>
                  <div className="bg-white/5 rounded-lg p-3 space-y-2">
                    <div className="flex justify-between">
                      <span className="text-gray-400 text-sm">Metodo</span>
                      <span className="text-white text-sm">{streamInfo.detectionMethod}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400 text-sm">Affidabilità</span>
                      <span className={`text-sm font-medium ${
                        streamInfo.confidence === 'high' ? 'text-green-400' :
                        streamInfo.confidence === 'medium' ? 'text-yellow-400' :
                        streamInfo.confidence === 'low' ? 'text-orange-400' : 'text-red-400'
                      }`}>
                        {streamInfo.confidence === 'high' ? 'ALTA' :
                         streamInfo.confidence === 'medium' ? 'MEDIA' :
                         streamInfo.confidence === 'low' ? 'BASSA' :
                         streamInfo.confidence === 'none' ? 'NON RILEVATO' : 'N/A'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Codec Flags */}
                <div className="flex flex-wrap gap-2">
                  {streamInfo.isH264 && (
                    <span className="px-2 py-1 bg-blue-500/20 text-blue-400 text-xs rounded-full">H.264</span>
                  )}
                  {streamInfo.isHEVC && (
                    <span className="px-2 py-1 bg-yellow-500/20 text-yellow-400 text-xs rounded-full">HEVC/H.265</span>
                  )}
                  {streamInfo.isDolbyVision && (
                    <span className="px-2 py-1 bg-purple-500/20 text-purple-400 text-xs rounded-full">Dolby Vision</span>
                  )}
                  {streamInfo.isAV1 && (
                    <span className="px-2 py-1 bg-purple-500/20 text-purple-400 text-xs rounded-full">AV1</span>
                  )}
                  {streamInfo.isVP9 && (
                    <span className="px-2 py-1 bg-green-500/20 text-green-400 text-xs rounded-full">VP9</span>
                  )}
                  {streamInfo.isVP8 && (
                    <span className="px-2 py-1 bg-green-500/20 text-green-400 text-xs rounded-full">VP8</span>
                  )}
                  {streamInfo.videoHDR && (
                    <span className="px-2 py-1 bg-amber-500/20 text-amber-400 text-xs rounded-full">HDR</span>
                  )}
                  {streamInfo.videoBitDepth && streamInfo.videoBitDepth > 8 && (
                    <span className="px-2 py-1 bg-cyan-500/20 text-cyan-400 text-xs rounded-full">{streamInfo.videoBitDepth}-bit</span>
                  )}
                  {streamInfo.hardwareAccelerated && (
                    <span className="px-2 py-1 bg-emerald-500/20 text-emerald-400 text-xs rounded-full">HW Decode</span>
                  )}
                </div>
              </>
            ) : (
              <div className="text-center py-8 text-gray-400">
                <Info className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>Premi "Aggiorna" per analizzare lo stream</p>
              </div>
            )}

            {/* Log Section */}
            {streamLogs.length > 0 && (
              <div className="space-y-2 mt-4">
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Log Analisi</h4>
                <div className="bg-black/50 rounded-lg p-3 max-h-48 overflow-y-auto font-mono text-xs space-y-1">
                  {streamLogs.map((log, i) => (
                    <div key={i} className={`${log.includes('❌') ? 'text-red-400' : log.includes('⚠️') ? 'text-yellow-400' : 'text-gray-300'}`}>
                      {log}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default VideoPlayer;
