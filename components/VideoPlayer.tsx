
import React, { useEffect, useRef, useState } from 'react';
import { Channel } from '../types.ts';
import { MetadataService } from '../services/metadata.ts';
import { AlertTriangle, Play, Pause, Volume2, VolumeX, Maximize, Minimize, SkipForward, SkipBack, List, X, FastForward, Rewind, Settings } from 'lucide-react';
import Hls from 'hls.js';
import mpegts from 'mpegts.js';

interface VideoPlayerProps {
  channel: Channel | null;
  playlist?: Channel[];
  onChannelSelect?: (channel: Channel) => void;
  onNext?: () => void;
  onPrev?: () => void;
  onProgress?: (progress: number, duration: number) => void;
}

const VideoPlayer: React.FC<VideoPlayerProps> = ({ channel, playlist = [], onChannelSelect, onNext, onPrev, onProgress }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  
  const hlsRef = useRef<Hls | null>(null); 
  const mpegtsRef = useRef<mpegts.Player | null>(null);
  
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  const [meta, setMeta] = useState<any>(null);

  // Playlist / Zapping UI
  const [showPlaylist, setShowPlaylist] = useState(false);
  const playlistRef = useRef<HTMLDivElement>(null);

  // OSD State
  const [osdMessage, setOsdMessage] = useState<{icon: React.ElementType, text?: string} | null>(null);
  const osdTimeoutRef = useRef<number | null>(null);
  const controlsTimeoutRef = useRef<number | null>(null);

  // Throttle progress updates to avoid flooding
  const lastProgressUpdate = useRef<number>(0);

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
          if (isPlaying && !isSeeking && !showPlaylist) setShowControls(false);
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

  // Load Stream
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !channel) return;
    setError(null);
    setIsPlaying(true); 
    setShowPlaylist(false); // Close playlist on change
    setCurrentTime(0);
    setDuration(0);
    setBuffered(0);

    // Immediate cleanup of previous instances to free resources for zapping
    if (hlsRef.current) { 
        hlsRef.current.destroy(); 
        hlsRef.current = null; 
    }
    if (mpegtsRef.current) { 
        mpegtsRef.current.destroy(); 
        mpegtsRef.current = null; 
    }
    
    // Reset video element state
    video.removeAttribute('src');
    video.load(); 

    const source = channel.url;
    const isM3U8 = source.toLowerCase().includes('.m3u8');
    const isTS = source.toLowerCase().match(/\.(ts|mpeg|mpg)$/);
    const isLive = channel.type === 'live';

    // Prioritize startup speed
    video.preload = "auto";
    video.autoplay = true;
    video.playsInline = true;

    if (isM3U8 && (Hls as any).isSupported()) {
      // Zapping-optimized Config
      const hlsConfig = {
          debug: false,
          enableWorker: true,
          lowLatencyMode: false, // DISABLE Low Latency: Causes stalls on many IPTV providers
          backBufferLength: isLive ? 0 : 30, // Don't cache back for live zapping
          
          // Startup optimization
          startLevel: -1, // Auto bandwidth
          startFragPrefetch: true, // Fetch first segment immediately
          
          // Resiliency
          manifestLoadingTimeOut: 20000,
          fragLoadingTimeOut: 20000,
          levelLoadingTimeOut: 20000,
          
          // Buffer - keep it lean for live to allow fast sync
          maxBufferLength: isLive ? 10 : 30, 
          maxMaxBufferLength: isLive ? 20 : 60,
      };

      const hls = new Hls(hlsConfig as any);
      hlsRef.current = hls;
      hls.loadSource(source);
      hls.attachMedia(video);
      
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
          // Force play attempt immediately after manifest
          const promise = video.play();
          if (promise !== undefined) {
              promise.catch(error => {
                  console.debug("Autoplay catch:", error);
                  setIsPlaying(false);
              });
          }
      });

      hls.on(Hls.Events.ERROR, (_e: any, data: any) => {
         if (data.fatal) {
             switch (data.type) {
                 case Hls.ErrorTypes.NETWORK_ERROR:
                     hls.startLoad();
                     break;
                 case Hls.ErrorTypes.MEDIA_ERROR:
                     hls.recoverMediaError();
                     break;
                 default:
                     setError("Stream Unavailable");
                     hls.destroy();
                     break;
             }
         }
      });
    } else if (isTS && mpegts.isSupported()) {
        const player = mpegts.createPlayer({ 
            type: 'mpegts', 
            url: source, 
            isLive: isLive 
        }, {
            enableWorker: true,
            lazyLoadMaxDuration: isLive ? 30 : 300, // Reduced from 60
            stashInitialSize: 128 * 1024, // Fast start
            liveBufferLatencyChasing: false, // DISABLE chasing: Increases CPU and can cause stutter on zap
            deferLoadAfterSourceOpen: false
        });
        
        mpegtsRef.current = player;
        player.attachMediaElement(video);
        player.load();
        
        const playPromise = player.play();
        if (playPromise !== undefined) {
             (playPromise as Promise<void>).catch(() => setIsPlaying(false));
        }
        player.on(mpegts.Events.ERROR, () => setError("Stream Error"));
    } else {
      // Native Player
      video.src = source;
      video.play().catch(() => setIsPlaying(false));
      video.onerror = () => setError("Format Not Supported");
    }

    // Metadata Fetch
    setMeta(null);
    if (channel && channel.type === 'movie') {
        const query = channel.cleanName || channel.name;
        MetadataService.searchTMDB(query, 'movie', channel.year).then(res => {
            if (res?.id) MetadataService.getDetails(res.id, 'movie').then(setMeta);
        });
    }

    return () => {
      if (hlsRef.current) hlsRef.current.destroy();
      if (mpegtsRef.current) mpegtsRef.current.destroy();
    };
  }, [channel]);

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

        switch (e.key) {
            case 'ArrowLeft':
                // Seek logic
                video.currentTime = Math.max(0, video.currentTime - 10);
                showOSD(Rewind, "-10s");
                break;
            case 'ArrowRight':
                // Seek logic
                video.currentTime = Math.min(video.duration, video.currentTime + 10);
                showOSD(FastForward, "+10s");
                break;
            case 'ArrowUp':
                e.preventDefault();
                setShowPlaylist(true);
                setTimeout(() => {
                    const el = document.getElementById(`plist-${channel.id}`);
                    el?.scrollIntoView({block: 'center'});
                    el?.focus();
                }, 100);
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
        }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [channel, isFullscreen, isPlaying, isMuted, showPlaylist]);

  // Video Events
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const updateBuffer = () => {
        if (video.duration > 0 && video.buffered.length > 0) {
            let b = 0;
            // Find the buffer range that covers the current time
            for(let i=0; i < video.buffered.length; i++) {
                if (video.buffered.start(i) <= video.currentTime + 0.5 && video.buffered.end(i) >= video.currentTime - 0.5) {
                    b = video.buffered.end(i);
                    break;
                }
            }
            setBuffered(b);
        }
    };

    const onTime = () => { 
        if(!isSeeking) {
            setCurrentTime(video.currentTime);
            
            // Update progress every 5 seconds or if > 1% change to save writes
            const now = Date.now();
            if (onProgress && video.duration > 0 && (now - lastProgressUpdate.current > 5000)) {
                lastProgressUpdate.current = now;
                onProgress(video.currentTime / video.duration, video.duration);
            }
        }
        updateBuffer();
    };
    
    const onMeta = () => setDuration(video.duration);
    
    const onEnd = () => { 
        if (onProgress && video.duration > 0) onProgress(1, video.duration); // Mark as fully watched
        if (onNext) onNext(); 
    };

    video.addEventListener('timeupdate', onTime);
    video.addEventListener('progress', updateBuffer); // Also update on download progress
    video.addEventListener('loadedmetadata', onMeta);
    video.addEventListener('ended', onEnd);
    
    return () => {
        video.removeEventListener('timeupdate', onTime);
        video.removeEventListener('progress', updateBuffer);
        video.removeEventListener('loadedmetadata', onMeta);
        video.removeEventListener('ended', onEnd);
    };
  }, [isSeeking, onNext, onProgress]);

  const togglePlay = () => { if (videoRef.current) isPlaying ? videoRef.current.pause() : videoRef.current.play(); setIsPlaying(!isPlaying); };
  const toggleMute = () => { if (videoRef.current) { videoRef.current.muted = !isMuted; setIsMuted(!isMuted); }};
  const toggleFull = () => { 
      if (!containerRef.current) return; 
      if (!document.fullscreenElement) containerRef.current.requestFullscreen().then(() => setIsFullscreen(true));
      else document.exitFullscreen().then(() => setIsFullscreen(false));
  };
  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
      const t = parseFloat(e.target.value);
      setCurrentTime(t);
      if (videoRef.current) videoRef.current.currentTime = t;
  };
  const formatTime = (s: number) => {
      if (!s || isNaN(s)) return "0:00";
      const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = Math.floor(s%60);
      return h > 0 ? `${h}:${m.toString().padStart(2,'0')}:${sec.toString().padStart(2,'0')}` : `${m}:${sec.toString().padStart(2,'0')}`;
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
        poster={channel.logo}
        playsInline
      />
      
      {backdrop && (
          <div className={`absolute inset-0 z-0 bg-cover bg-center transition-opacity duration-1000 ${(!isPlaying || showControls) ? 'opacity-30 blur-sm' : 'opacity-0'}`} style={{ backgroundImage: `url(${backdrop})` }} />
      )}

      {/* OSD */}
      {osdMessage && (
          <div className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none animate-fade-in">
              <div className="bg-black/60 backdrop-blur-md p-8 rounded-3xl flex flex-col items-center gap-4 border border-white/10 shadow-2xl">
                  <osdMessage.icon className="w-16 h-16 text-white" />
                  {osdMessage.text && <span className="text-2xl font-bold text-white">{osdMessage.text}</span>}
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
                      {c.logo ? <img src={c.logo} className="w-8 h-8 object-contain bg-black rounded" /> : <div className="w-8 h-8 bg-gray-700 rounded flex items-center justify-center text-xs">TV</div>}
                      <span className="truncate text-sm font-medium">{c.cleanName || c.name}</span>
                  </button>
              ))}
          </div>
      </div>

      {error && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80">
            <div className="bg-red-900/50 backdrop-blur border border-red-500/50 px-8 py-6 rounded-2xl flex flex-col items-center gap-2">
                <AlertTriangle className="w-10 h-10 text-red-400" />
                <p className="text-xl font-medium text-white">{error}</p>
            </div>
        </div>
      )}

      {/* HEADER INFO */}
      <div className={`absolute top-0 left-0 right-0 p-8 pt-20 bg-gradient-to-b from-black/90 to-transparent transition-all duration-500 z-20 pointer-events-none ${showControls ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-10'}`}>
          <h2 className="text-4xl font-light text-white tracking-tight text-shadow-lg mb-2">{meta?.title || channel.name}</h2>
          <div className="flex gap-4 text-gray-300 text-sm font-medium tracking-wider">
             {channel.type === 'live' && <span className="bg-red-600 px-2 py-0.5 rounded text-white text-xs font-bold">LIVE</span>}
             {meta?.release_date && <span>{meta.release_date.split('-')[0]}</span>}
             {channel.type !== 'live' && <span className="bg-gray-800 px-2 py-0.5 rounded border border-gray-600 text-xs text-gray-300">Instant Play</span>}
          </div>
      </div>

      {/* CONTROLS */}
      <div 
        ref={controlsRef}
        onFocus={() => setShowControls(true)}
        className={`
            absolute bottom-8 left-1/2 -translate-x-1/2 w-[90%] max-w-4xl bg-black/60 backdrop-blur-2xl border border-white/10 rounded-3xl p-6 shadow-[0_20px_60px_rgba(0,0,0,0.8)]
            transition-all duration-500 ease-out z-40 flex flex-col gap-4
            ${showControls ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-20'}
      `}>
          
          {showSeekBar && (
            <div className="flex items-center gap-4 text-xs font-mono text-gray-400 select-none">
                <span>{formatTime(currentTime)}</span>
                <div className="relative flex-1 h-1.5 bg-white/20 rounded-full group/seek cursor-pointer items-center flex">
                    
                    {/* Buffer Bar */}
                    <div 
                        className="absolute h-full bg-white/30 rounded-full transition-all duration-300 ease-linear" 
                        style={{ width: `${Math.min((buffered / duration) * 100, 100)}%` }} 
                    />

                    {/* Play Progress Bar */}
                    <div 
                        className="absolute h-full bg-gradient-to-r from-purple-600 to-indigo-500 rounded-full" 
                        style={{ width: `${(currentTime / duration) * 100}%` }} 
                    >
                        {/* Visual Thumb */}
                        <div className="absolute right-[-6px] top-1/2 -translate-y-1/2 w-3.5 h-3.5 bg-white rounded-full shadow-lg scale-0 group-hover/seek:scale-100 transition-transform duration-200" />
                    </div>

                    <input 
                        type="range" min={0} max={duration} step="any" value={currentTime} onChange={handleSeek}
                        onMouseDown={() => setIsSeeking(true)} onMouseUp={() => setIsSeeking(false)}
                        className="tv-focus absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
                    />
                </div>
                <span>{formatTime(duration)}</span>
            </div>
          )}

          <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                  <button onClick={() => setShowPlaylist(!showPlaylist)} className="tv-focus p-2 rounded-full hover:bg-white/10 text-gray-300 hover:text-white" title="Channel List (Up Arrow)">
                      <List className="w-6 h-6" />
                  </button>
              </div>

              <div className="flex items-center gap-6">
                  {onPrev && (
                    <button onClick={onPrev} className="tv-focus p-3 rounded-full hover:bg-white/10 text-white"><SkipBack className="w-8 h-8" /></button>
                  )}
                  <button 
                    onClick={togglePlay} 
                    className="tv-focus p-4 rounded-full bg-white text-black hover:scale-105 shadow-[0_0_20px_rgba(255,255,255,0.3)]"
                  >
                    {isPlaying ? <Pause className="w-8 h-8 fill-current" /> : <Play className="w-8 h-8 fill-current" />}
                  </button>
                  {onNext && (
                    <button onClick={onNext} className="tv-focus p-3 rounded-full hover:bg-white/10 text-white"><SkipForward className="w-8 h-8" /></button>
                  )}
              </div>

              <div className="flex items-center gap-4">
                  <button onClick={toggleFull} className="tv-focus p-2 rounded-full hover:bg-white/10 text-gray-300 hover:text-white">
                      {isFullscreen ? <Minimize className="w-6 h-6" /> : <Maximize className="w-6 h-6" />}
                  </button>
              </div>
          </div>
      </div>
    </div>
  );
};

export default VideoPlayer;
