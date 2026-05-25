import React from 'react';
import { X, Subtitles, Upload, CheckCircle2 } from 'lucide-react';
import { ActiveSubtitle } from '../../services/subtitleService';

interface SubtitleMenuProps {
  show: boolean;
  onClose: () => void;
  activeSubtitle: ActiveSubtitle | null;
  subtitleEnabled: boolean;
  onToggleEnabled: () => void;
  onFileSelect: () => void;
  onRemove: () => void;
}

export const SubtitleMenu: React.FC<SubtitleMenuProps> = ({
  show,
  onClose,
  activeSubtitle,
  subtitleEnabled,
  onToggleEnabled,
  onFileSelect,
  onRemove
}) => {
  if (!show) return null;

  return (
    <div className="absolute bottom-20 right-4 w-72 bg-black/90 backdrop-blur-xl border border-white/10 rounded-2xl p-2 z-[70] shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-200">
      <div className="p-3 border-b border-white/10 flex items-center justify-between mb-2">
        <h3 className="font-bold text-white text-sm flex items-center gap-2">
          <Subtitles className="w-4 h-4" /> Sottotitoli
        </h3>
        <button 
          onClick={onClose} 
          aria-label="Chiudi menu sottotitoli" 
          className="tv-focus touch-target p-1 rounded-full hover:bg-white/10"
        >
          <X className="w-4 h-4 text-gray-400" />
        </button>
      </div>
      <div className="space-y-1 p-1">
        {/* "Off" entry */}
        <button
          onClick={onRemove}
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
            onClick={onToggleEnabled}
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
          onClick={onFileSelect}
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
    </div>
  );
};

export default SubtitleMenu;
