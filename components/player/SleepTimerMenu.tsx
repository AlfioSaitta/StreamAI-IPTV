import React from 'react';
import { Moon, Clock, X } from 'lucide-react';
import type { SleepTimerPreset } from '../../hooks/useSleepTimer';
import { formatSleepRemaining } from '../../hooks/useSleepTimer';
import { IconButton } from '../shared';

interface SleepTimerMenuProps {
  isOpen: boolean;
  onClose: () => void;
  current: SleepTimerPreset;
  remainingSeconds: number;
  onPick: (preset: SleepTimerPreset) => void;
  /** Disable "End of programme" when there's no current EPG entry. */
  endOfProgrammeAvailable: boolean;
  /** Optional: end time of current programme (epoch ms) to show in the label. */
  endOfProgrammeAt?: number | null;
}

const OPTIONS: Array<{ id: SleepTimerPreset; label: string }> = [
  { id: 'off', label: 'Disattivato' },
  { id: '15min', label: '15 minuti' },
  { id: '30min', label: '30 minuti' },
  { id: '60min', label: '1 ora' },
  { id: '90min', label: '1 ora 30 min' },
];

/**
 * Compact popover menu for the sleep timer. Mounted absolutely above the
 * player's bottom control bar; closes on outside click and on `Esc`.
 */
const SleepTimerMenu: React.FC<SleepTimerMenuProps> = ({
  isOpen,
  onClose,
  current,
  remainingSeconds,
  onPick,
  endOfProgrammeAvailable,
  endOfProgrammeAt,
}) => {
  if (!isOpen) return null;

  const endOfProgrammeLabel = endOfProgrammeAt
    ? new Date(endOfProgrammeAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div
      role="dialog"
      aria-label="Timer di spegnimento"
      className="absolute bottom-24 right-6 z-40 w-64 rounded-card border border-DEFAULT bg-surface-overlay-hard backdrop-blur-xl shadow-elev-3 p-3 text-content-primary animate-fade-in"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-2 px-2 pb-2 border-b border-subtle">
        <div className="flex items-center gap-2">
          <Moon className="w-icon-sm h-icon-sm text-state-warning" aria-hidden="true" />
          <h3 className="text-sm font-semibold">Sleep timer</h3>
        </div>
        <IconButton
          icon={X}
          aria-label="Chiudi menu sleep timer"
          variant="ghost"
          size="sm"
          onClick={onClose}
        />
      </div>

      {current !== 'off' && remainingSeconds > 0 && (
        <div className="flex items-center gap-2 px-2 py-2 border-b border-subtle text-xs text-content-secondary">
          <Clock className="w-icon-xs h-icon-xs text-state-warning" aria-hidden="true" />
          <span>Tempo rimanente</span>
          <span className="ml-auto font-mono font-semibold text-state-warning">
            {formatSleepRemaining(remainingSeconds)}
          </span>
        </div>
      )}

      <ul className="py-1">
        {OPTIONS.map(opt => {
          const isActive = current === opt.id;
          return (
            <li key={opt.id}>
              <button
                type="button"
                onClick={() => { onPick(opt.id); if (opt.id === 'off') onClose(); }}
                aria-pressed={isActive}
                className={`tv-focus-dense w-full flex items-center justify-between gap-2 px-3 py-2 rounded-control text-sm transition-colors ${
                  isActive
                    ? 'bg-brand-primary/25 text-content-primary'
                    : 'text-content-secondary hover:bg-surface-2'
                }`}
              >
                <span>{opt.label}</span>
                {isActive && (
                  <span className="text-[10px] uppercase tracking-widest text-brand-primary">
                    Attivo
                  </span>
                )}
              </button>
            </li>
          );
        })}
        {endOfProgrammeAvailable && (
          <li>
            <button
              type="button"
              onClick={() => onPick('endOfProgramme')}
              aria-pressed={current === 'endOfProgramme'}
              className={`tv-focus-dense w-full flex items-center justify-between gap-2 px-3 py-2 rounded-control text-sm transition-colors ${
                current === 'endOfProgramme'
                  ? 'bg-brand-primary/25 text-content-primary'
                  : 'text-content-secondary hover:bg-surface-2'
              }`}
            >
              <span>Fine programma {endOfProgrammeLabel ? `(${endOfProgrammeLabel})` : ''}</span>
              {current === 'endOfProgramme' && (
                <span className="text-[10px] uppercase tracking-widest text-brand-primary">
                  Attivo
                </span>
              )}
            </button>
          </li>
        )}
      </ul>

      <p className="px-2 pt-2 text-[10px] text-content-disabled leading-snug">
        Il video viene messo in pausa allo scadere del timer, con una breve dissolvenza audio.
      </p>
    </div>
  );
};

export default SleepTimerMenu;
