import React from 'react';
import { 
  X, Loader2, Play, Pause, AlertTriangle, 
  RotateCcw, Info, SkipBack, Rewind, 
  FastForward, SkipForward, Volume2, VolumeX,
  Subtitles, Moon, List, Cast, PictureInPicture2,
  Maximize, Minimize, Calendar, Headphones
} from 'lucide-react';
import { Channel } from '../../types';
import { formatTime } from './playerUtils';

interface PlayerControlsProps {
  show: boolean;
  channel: Channel;
  isPlaying: boolean;
  isBuffering: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  onBack: () => void;
  togglePlay: () => void;
  onVolumeChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onMuteToggle: () => void;
  onNext?: () => void;
  onPrev?: () => void;
  onPlaylistToggle: () => void;
  onAudioMenuToggle: () => void;
  onSubtitleMenuToggle: () => void;
  onSleepMenuToggle: () => void;
  onInfoPanelToggle: () => void;
  onCastToggle: () => void;
  onRestart: () => void;
  onSkip: (offset: number) => void;
  onMiniEpgToggle: () => void;
  showMiniEpg: boolean;
  showAudioMenu: boolean;
  showSubtitleMenu: boolean;
  showSleepMenu: boolean;
  isMpv: boolean;
  isUsingNativePlayer: boolean;
  castSession: {
    isCasting: boolean;
    isConnecting: boolean;
    deviceName?: string;
  };
  isCastLoading: boolean;
  osd: { visible: boolean };
  seekDisabledReason: string | null;
  timelineRef: React.RefObject<HTMLDivElement | null>;
  hoverTime: number | null;
  hoverPos: number;
  isScrubbing: boolean;
  displayTime: number;
  onTimelinePointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onTimelineMouseMove: (e: React.MouseEvent<HTMLDivElement>) => void;
  onTimelineMouseLeave: (e: React.MouseEvent<HTMLDivElement>) => void;
  audioTracksCount: number;
  activeSubtitle: any;
  subtitleEnabled: boolean;
  sleepTimer: {
    preset: string;
    remainingSeconds: number;
  };
  formatSleepRemaining: (s: number) => string;
  nativePiPSupported: boolean;
  togglePiP: () => void;
  isFullscreen: boolean;
  toggleFullscreen: () => void;
  isPiP: boolean;
}

export const PlayerControls: React.FC<PlayerControlsProps> = ({
  show,
  channel,
  isPlaying,
  isBuffering,
  currentTime,
  duration,
  volume,
  isMuted,
  onBack,
  togglePlay,
  onVolumeChange,
  onMuteToggle,
  onNext,
  onPrev,
  onPlaylistToggle,
  onAudioMenuToggle,
  onSubtitleMenuToggle,
  onSleepMenuToggle,
  onInfoPanelToggle,
  onCastToggle,
  onRestart,
  onSkip,
  onMiniEpgToggle,
  showMiniEpg,
  showAudioMenu,
  showSubtitleMenu,
  showSleepMenu,
  castSession,
  isCastLoading,
  osd,
  seekDisabledReason,
  timelineRef,
  hoverTime,
  hoverPos,
  isScrubbing,
  displayTime,
  onTimelinePointerDown,
  onTimelineMouseMove,
  onTimelineMouseLeave,
  audioTracksCount,
  activeSubtitle,
  subtitleEnabled,
  sleepTimer,
  formatSleepRemaining,
  nativePiPSupported,
  togglePiP,
  isFullscreen,
  toggleFullscreen,
  isPiP
}) => {
  const seekDisabled = !!seekDisabledReason;
  const isLive = channel.type === 'live';

  return (
    <div className={`absolute inset-0 z-30 transition-opacity duration-300 ${show ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
      {/* Top Bar */}
      <div className="absolute top-0 left-0 right-0 p-4 bg-gradient-to-b from-black/80 to-transparent flex justify-between items-center">
        <div className="flex items-center gap-4">
          <button onClick={onBack} aria-label="Indietro" title="Indietro (Esc)" className="tv-focus touch-target p-2 rounded-full bg-white/10 hover:bg-white/20">
            <X className="w-6 h-6 text-white" />
          </button>
          <div>
            <h2 className="text-white font-semibold text-lg truncate max-w-md">{channel.cleanName || channel.name}</h2>
            {channel.group && <p className="text-gray-400 text-sm">{channel.group}</p>}
          </div>
        </div>
      </div>

      {/* Center Controls */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        {isBuffering && (
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="w-16 h-16 text-brand-primary animate-spin" />
            <span className="text-white/70 text-sm font-medium animate-pulse tracking-widest uppercase">Caricamento...</span>
          </div>
        )}
        {!isPlaying && !isBuffering && !osd.visible && show && (
          <div className="bg-black/40 backdrop-blur-md p-8 rounded-full border border-white/10 animate-in zoom-in duration-300 pointer-events-auto">
            <button onClick={togglePlay} aria-label="Play" className="tv-focus touch-target group">
              <Play className="w-16 h-16 text-white group-hover:scale-110 transition-transform" fill="white" />
            </button>
          </div>
        )}
      </div>

      {/* Bottom Bar */}
      <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent">
        {/* Timeline */}
        {!isLive && duration > 0 && (
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
              onPointerDown={seekDisabled ? undefined : onTimelinePointerDown}
              onMouseMove={seekDisabled ? undefined : onTimelineMouseMove}
              onMouseLeave={seekDisabled ? undefined : onTimelineMouseLeave}
            >
              <div className="absolute h-full bg-brand-primary rounded-full" style={{ width: `${(displayTime / duration) * 100}%` }} />
              {hoverTime !== null && (
                <div className="absolute h-full bg-white/20 rounded-full" style={{ width: `${hoverPos}%` }} />
              )}
              <div
                className={`absolute top-1/2 w-4 h-4 bg-brand-primary rounded-full shadow-lg transition-transform duration-200 ${isScrubbing ? 'scale-125' : 'scale-0 group-hover/timeline:scale-100'}`}
                style={{ left: `${(displayTime / duration) * 100}%`, transform: 'translate(-50%, -50%)' }}
              />
              {(hoverTime !== null || isScrubbing) && (
                <div
                  className="absolute bottom-5 -translate-x-1/2 bg-black/80 text-white text-xs px-2 py-1 rounded border border-white/10 whitespace-nowrap pointer-events-none"
                  style={{ left: `${hoverPos}%` }}
                >
                  {formatTime(hoverTime ?? currentTime)}
                </div>
              )}
            </div>
            <div className="flex justify-between text-xs text-gray-400 mt-2 font-medium">
              <span>{formatTime(displayTime)}</span><span>{formatTime(duration)}</span>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 group/vol">
              <button onClick={onMuteToggle} aria-label={isMuted || volume === 0 ? 'Riattiva audio' : 'Disattiva audio'} title={`${isMuted || volume === 0 ? 'Riattiva audio' : 'Muto'} (M)`} className="tv-focus touch-target p-2 hover:bg-white/10 rounded-full">
                {isMuted || volume === 0 ? <VolumeX className="w-6 h-6 text-white" /> : <Volume2 className="w-6 h-6 text-white" />}
              </button>
              <div className="w-0 group-hover/vol:w-24 overflow-hidden transition-all duration-300">
                <input
                  type="range" min="0" max="1" step="0.05" value={isMuted ? 0 : volume}
                  onChange={onVolumeChange}
                  aria-label="Volume"
                  className="w-full h-1 bg-white/30 rounded-full appearance-none cursor-pointer accent-brand-primary"
                />
              </div>
            </div>
            {!isLive && currentTime > 30 && !seekDisabled && (
              <button onClick={onRestart} aria-label="Riparti dall'inizio" className="tv-focus touch-target p-2 hover:bg-white/10 rounded-full" title="Riparti dall'inizio">
                <RotateCcw className="w-6 h-6 text-white" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {onPrev && <button onClick={onPrev} aria-label="Precedente" title="Precedente" className="tv-focus touch-target p-2 hover:bg-white/10 rounded-full"><SkipBack className="w-6 h-6 text-white" /></button>}
            <button onClick={() => onSkip(-10)} disabled={seekDisabled} aria-label="Indietro 10 secondi" title={seekDisabled ? 'Seek non supportato dal server' : 'Indietro 10s (←)'} className={`tv-focus touch-target p-2 rounded-full ${seekDisabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-white/10'}`}><Rewind className="w-6 h-6 text-white" /></button>
            <button onClick={togglePlay} aria-label={isPlaying ? 'Pausa' : 'Play'} title={`${isPlaying ? 'Pausa' : 'Play'} (Spazio)`} className="tv-focus touch-target p-3 bg-white/10 hover:bg-white/20 rounded-full">{isPlaying ? <Pause className="w-8 h-8 text-white" /> : <Play className="w-8 h-8 text-white" fill="white" />}</button>
            <button onClick={() => onSkip(10)} disabled={seekDisabled} aria-label="Avanti 10 secondi" title={seekDisabled ? 'Seek non supportato dal server' : 'Avanti 10s (→)'} className={`tv-focus touch-target p-2 rounded-full ${seekDisabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-white/10'}`}><FastForward className="w-6 h-6 text-white" /></button>
            {onNext && <button onClick={onNext} aria-label="Successivo" title="Successivo" className="tv-focus touch-target p-2 hover:bg-white/10 rounded-full"><SkipForward className="w-6 h-6 text-white" /></button>}
          </div>

          <div className="flex items-center gap-2">
            {isLive && channel.tvgId && (
              <button
                onClick={onMiniEpgToggle}
                aria-label="Guida TV"
                aria-pressed={showMiniEpg}
                className={`tv-focus touch-target p-2 hover:bg-white/10 rounded-full transition-colors ${showMiniEpg ? 'text-brand-primary bg-white/10' : 'text-white'}`}
                title="Guida TV (G)"
              >
                <Calendar className="w-6 h-6" />
              </button>
            )}
            {(channel.type === 'series' || isLive) && (
              <button onClick={onPlaylistToggle} aria-label={channel.type === 'series' ? "Lista episodi" : "Lista canali"} className="tv-focus touch-target p-2 hover:bg-white/10 rounded-full" title={channel.type === 'series' ? "Lista episodi (L)" : "Lista canali (L)"}>
                <List className="w-6 h-6 text-white" />
              </button>
            )}
            {audioTracksCount > 1 && (
              <button 
                onClick={onAudioMenuToggle} 
                aria-label="Tracce audio"
                aria-pressed={showAudioMenu}
                className={`tv-focus touch-target p-2 hover:bg-white/10 rounded-full transition-colors ${showAudioMenu ? 'text-brand-primary bg-white/10' : 'text-white'}`}
                title="Lingue Audio"
              >
                <Headphones className="w-6 h-6" />
              </button>
            )}
            {!isLive && (
              <button
                onClick={onSubtitleMenuToggle}
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
            <button onClick={onInfoPanelToggle} aria-label="Info stream/codec" className="tv-focus touch-target p-2 hover:bg-white/10 rounded-full" title="Info Codec">
              <Info className="w-6 h-6 text-white" />
            </button>
            <button
              onClick={onSleepMenuToggle}
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
              onClick={onCastToggle}
              disabled={isCastLoading || castSession.isConnecting}
              aria-label={castSession.isCasting ? `Connesso a ${castSession.deviceName}. Clicca per disconnettere o cambiare dispositivo.` : 'Trasmetti'}
              className={`tv-focus touch-target p-2 hover:bg-white/10 rounded-full transition-colors ${
                castSession.isCasting ? 'text-brand-primary' : 'text-white'
              }`}
              title="Trasmetti (C)"
            >
              <Cast className={`w-6 h-6 ${castSession.isConnecting ? 'animate-pulse' : ''}`} />
            </button>
            <button onClick={togglePiP} disabled={!nativePiPSupported} aria-label="Picture-in-Picture" className={`tv-focus touch-target p-2 rounded-full ${nativePiPSupported ? (isPiP ? 'text-brand-primary bg-white/10' : 'text-white hover:bg-white/10') : 'text-gray-600 cursor-not-allowed'}`} title="Picture-in-Picture (P)">
              <PictureInPicture2 className="w-6 h-6" />
            </button>
            <button onClick={toggleFullscreen} aria-label={isFullscreen ? "Esci da fullscreen" : "Vai in fullscreen"} className="tv-focus touch-target p-2 hover:bg-white/10 rounded-full" title="Fullscreen (F)">
              {isFullscreen ? <Minimize className="w-6 h-6 text-white" /> : <Maximize className="w-6 h-6 text-white" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PlayerControls;
