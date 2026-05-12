// Mini-EPG overlay — D.1 IMPROVEMENT_PLAN_V2.
// Shows the current programme + next 3 programmes for a Live channel.
// Triggered by the `G` shortcut (guide) or the Info button on Live.

import React from 'react';
import { Calendar, Clock, X, RefreshCw, AlertTriangle } from 'lucide-react';
import type { EpgProgramme } from '../types';

interface MiniEpgOverlayProps {
  open: boolean;
  onClose: () => void;
  channelName: string;
  current: EpgProgramme | null;
  upcoming: EpgProgramme[];
  isLoading: boolean;
  error: string | null;
  onRefresh: () => void;
}

const formatTimeRange = (p: EpgProgramme): string => {
  const fmt = (ts: number) =>
    new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${fmt(p.start)} – ${fmt(p.stop)}`;
};

const formatDay = (ts: number): string => {
  const d = new Date(ts);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, today)) return 'Oggi';
  if (sameDay(d, tomorrow)) return 'Domani';
  return d.toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: '2-digit' });
};

const MiniEpgOverlay: React.FC<MiniEpgOverlayProps> = ({
  open,
  onClose,
  channelName,
  current,
  upcoming,
  isLoading,
  error,
  onRefresh,
}) => {
  if (!open) return null;

  const progress = current
    ? Math.max(0, Math.min(1, (Date.now() - current.start) / (current.stop - current.start)))
    : 0;

  return (
    <div
      className="absolute bottom-24 left-1/2 -translate-x-1/2 z-[75] w-[min(560px,92vw)] bg-black/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-200"
      role="dialog"
      aria-label="Guida programmi"
    >
      <div className="p-4 border-b border-white/10 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-white min-w-0">
          <Calendar className="w-5 h-5 text-red-400 flex-shrink-0" />
          <div className="min-w-0">
            <h3 className="font-semibold truncate">Guida TV</h3>
            <p className="text-xs text-gray-400 truncate">{channelName}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={onRefresh}
            disabled={isLoading}
            aria-label="Aggiorna EPG"
            title="Aggiorna EPG"
            className="tv-focus touch-target p-2 rounded-full hover:bg-white/10 text-gray-300 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={onClose}
            aria-label="Chiudi guida TV"
            className="tv-focus touch-target p-2 rounded-full hover:bg-white/10 text-gray-300"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="p-4 space-y-4 max-h-[60vh] overflow-y-auto">
        {error && !current && (
          <div className="flex items-start gap-3 bg-red-950/30 border border-red-500/30 rounded-xl p-3 text-sm text-red-100">
            <AlertTriangle className="w-4 h-4 mt-0.5 text-red-400 flex-shrink-0" />
            <div>
              <div className="font-medium">Impossibile caricare l'EPG</div>
              <div className="text-xs text-red-300 mt-0.5 break-all">{error}</div>
            </div>
          </div>
        )}

        {!current && !error && !isLoading && (
          <div className="text-center text-gray-400 py-6 text-sm">
            Nessun programma EPG per questo canale.
          </div>
        )}

        {current && (
          <div className="bg-gradient-to-br from-red-900/30 to-red-950/20 border border-red-500/30 rounded-xl p-4">
            <div className="flex items-center gap-2 text-[10px] font-bold tracking-widest uppercase text-red-300 mb-2">
              <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              In onda · {formatTimeRange(current)}
            </div>
            <h4 className="text-white font-semibold text-base leading-snug">{current.title}</h4>
            {current.category && (
              <p className="text-xs text-red-200/80 mt-1">{current.category}</p>
            )}
            <div className="mt-3 h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full bg-red-500 transition-[width] duration-500"
                style={{ width: `${(progress * 100).toFixed(1)}%` }}
                role="progressbar"
                aria-valuenow={Math.round(progress * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Avanzamento programma corrente"
              />
            </div>
            {current.description && (
              <p className="text-xs text-gray-300 mt-3 line-clamp-3">{current.description}</p>
            )}
          </div>
        )}

        {upcoming.length > 0 && (
          <div className="space-y-2">
            <div className="text-[10px] font-bold tracking-widest uppercase text-gray-400 px-1">
              Prossimi programmi
            </div>
            {upcoming.map((p, idx) => (
              <div
                key={`${p.channelId}-${p.start}-${idx}`}
                className="bg-white/5 border border-white/5 rounded-xl p-3 flex items-start gap-3"
              >
                <Clock className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] uppercase tracking-wide text-gray-500">
                    {formatDay(p.start)} · {formatTimeRange(p)}
                  </div>
                  <div className="text-sm text-white font-medium leading-snug mt-0.5">{p.title}</div>
                  {p.category && (
                    <div className="text-[10px] text-gray-400 mt-0.5">{p.category}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="px-4 py-2 border-t border-white/10 text-[10px] text-gray-500 text-center">
        Premi <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-gray-300">G</kbd> per aprire/chiudere la guida
      </div>
    </div>
  );
};

export default MiniEpgOverlay;

