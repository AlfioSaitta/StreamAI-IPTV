// Mini-EPG overlay — D.1 IMPROVEMENT_PLAN_V2.
// Shows the current programme + next 3 programmes for a Live channel.
// Triggered by the `G` shortcut (guide) or the Info button on Live.

import React from 'react';
import { Calendar, Clock, X, RefreshCw, AlertTriangle } from 'lucide-react';
import type { EpgProgramme } from '../types';
import { IconButton, Card } from './shared';

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
      className="absolute bottom-24 left-1/2 -translate-x-1/2 z-[75] w-[min(560px,92vw)] bg-surface-overlay-hard backdrop-blur-xl border border-DEFAULT rounded-card shadow-elev-3 animate-fade-in"
      role="dialog"
      aria-label="Guida programmi"
    >
      <div className="p-4 border-b border-subtle flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-content-primary min-w-0">
          <Calendar className="w-icon-md h-icon-md text-brand-primary flex-shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <h3 className="font-semibold truncate">Guida TV</h3>
            <p className="text-xs text-content-muted truncate">{channelName}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <IconButton
            icon={RefreshCw}
            aria-label="Aggiorna EPG"
            title="Aggiorna EPG"
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            disabled={isLoading}
            className={isLoading ? '[&_svg]:animate-spin' : ''}
          />
          <IconButton
            icon={X}
            aria-label="Chiudi guida TV"
            variant="ghost"
            size="sm"
            onClick={onClose}
          />
        </div>
      </div>

      <div className="p-4 space-y-4 max-h-[60vh] overflow-y-auto">
        {error && !current && (
          <Card
            elevation="flat"
            padding="sm"
            className="!border-state-error/30 !bg-state-error/10 flex items-start gap-3 text-sm text-state-error"
          >
            <AlertTriangle className="w-icon-sm h-icon-sm mt-0.5 flex-shrink-0" aria-hidden="true" />
            <div>
              <div className="font-medium">Impossibile caricare l'EPG</div>
              <div className="text-xs opacity-80 mt-0.5 break-all">{error}</div>
            </div>
          </Card>
        )}

        {!current && !error && !isLoading && (
          <div className="text-center text-content-muted py-6 text-sm">
            Nessun programma EPG per questo canale.
          </div>
        )}

        {current && (
          <div className="bg-brand-primary/10 border border-brand-primary/30 rounded-card p-4">
            <div className="flex items-center gap-2 text-[10px] font-bold tracking-widest uppercase text-brand-primary mb-2">
              <span className="inline-block w-2 h-2 rounded-full bg-brand-primary animate-pulse" />
              In onda · {formatTimeRange(current)}
            </div>
            <h4 className="text-content-primary font-semibold text-base leading-snug">{current.title}</h4>
            {current.category && (
              <p className="text-xs text-brand-primary/80 mt-1">{current.category}</p>
            )}
            <div className="mt-3 h-1.5 rounded-full bg-surface-3 overflow-hidden">
              <div
                className="h-full bg-brand-primary transition-[width] duration-500"
                style={{ width: `${(progress * 100).toFixed(1)}%` }}
                role="progressbar"
                aria-valuenow={Math.round(progress * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Avanzamento programma corrente"
              />
            </div>
            {current.description && (
              <p className="text-xs text-content-secondary mt-3 line-clamp-3">{current.description}</p>
            )}
          </div>
        )}

        {upcoming.length > 0 && (
          <div className="space-y-2">
            <div className="text-[10px] font-bold tracking-widest uppercase text-content-muted px-1">
              Prossimi programmi
            </div>
            {upcoming.map((p, idx) => (
              <div
                key={`${p.channelId}-${p.start}-${idx}`}
                className="bg-surface-1 border border-subtle rounded-control p-3 flex items-start gap-3"
              >
                <Clock className="w-icon-sm h-icon-sm text-content-muted mt-0.5 flex-shrink-0" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] uppercase tracking-wide text-content-disabled">
                    {formatDay(p.start)} · {formatTimeRange(p)}
                  </div>
                  <div className="text-sm text-content-primary font-medium leading-snug mt-0.5">{p.title}</div>
                  {p.category && (
                    <div className="text-[10px] text-content-muted mt-0.5">{p.category}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="px-4 py-2 border-t border-subtle text-[10px] text-content-disabled text-center">
        Premi{' '}
        <kbd className="px-1.5 py-0.5 bg-surface-2 rounded text-content-secondary">G</kbd>{' '}
        per aprire/chiudere la guida
      </div>
    </div>
  );
};

export default MiniEpgOverlay;

