import React from 'react';
import { X } from 'lucide-react';

interface AudioTrack {
  id: number | string;
  label?: string;
  language?: string;
  enabled: boolean;
}

interface AudioTrackMenuProps {
  show: boolean;
  onClose: () => void;
  tracks: AudioTrack[];
  onTrackChange: (id: number | string) => void;
}

export const AudioTrackMenu: React.FC<AudioTrackMenuProps> = ({
  show,
  onClose,
  tracks,
  onTrackChange
}) => {
  if (!show || tracks.length <= 1) return null;

  return (
    <div className="absolute bottom-20 right-4 w-64 bg-black/90 backdrop-blur-xl border border-white/10 rounded-2xl p-2 z-[70] shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-200">
      <div className="p-3 border-b border-white/10 flex items-center justify-between mb-2">
        <h3 className="font-bold text-white text-sm">Tracce Audio</h3>
        <button 
          onClick={onClose} 
          aria-label="Chiudi menu tracce audio" 
          className="tv-focus touch-target p-1 rounded-full hover:bg-white/10"
        >
          <X className="w-4 h-4 text-gray-400" />
        </button>
      </div>
      <div className="space-y-1">
        {tracks.map((track) => (
          <button
            key={track.id}
            onClick={() => onTrackChange(track.id)}
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
  );
};

export default AudioTrackMenu;
