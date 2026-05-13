import React from 'react';
import { Moon, Clock, X } from 'lucide-react';
import type { SleepTimerPreset } from '../../hooks/useSleepTimer';
import { formatSleepRemaining } from '../../hooks/useSleepTimer';

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
      className="absolute bottom-24 right-6 z-40 w-64 rounded-2xl border border-white/10 bg-black/90 backdrop-blur-xl shadow-2xl p-3 text-white"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-2 px-2 pb-2 border-b border-white/10">
        <div className="flex items-center gap-2">
          <Moon className="w-4 h-4 text-purple-300" aria-hidden="true" />
          <h3 className="text-sm font-semibold">Sleep timer</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Chiudi menu sleep timer"
          className="tv-focus rounded-full p-1 hover:bg-white/10"
        >
          <X className="w-3.5 h-3.5 text-gray-400" aria-hidden="true" />
        </button>
      </div>

      {current !== 'off' && remainingSeconds > 0 && (
        <div className="flex items-center gap-2 px-2 py-2 border-b border-white/10 text-xs text-gray-300">
          <Clock className="w-3 h-3 text-amber-300" aria-hidden="true" />
          <span>Tempo rimanente</span>
          <span className="ml-auto font-mono font-semibold text-amber-200">
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
                className={`tv-focus w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive ? 'bg-red-600/30 text-white' : 'text-gray-200 hover:bg-white/10'
                }`}
              >
                <span>{opt.label}</span>
                {isActive && <span className="text-[10px] uppercase tracking-widest text-red-300">Attivo</span>}
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
              className={`tv-focus w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                current === 'endOfProgramme'
                  ? 'bg-red-600/30 text-white'
                  : 'text-gray-200 hover:bg-white/10'
              }`}
            >
              <span>Fine programma {endOfProgrammeLabel ? `(${endOfProgrammeLabel})` : ''}</span>
              {current === 'endOfProgramme' && (
                <span className="text-[10px] uppercase tracking-widest text-red-300">Attivo</span>
              )}
            </button>
          </li>
        )}
      </ul>

      <p className="px-2 pt-2 text-[10px] text-gray-500 leading-snug">
        Il video viene messo in pausa allo scadere del timer, con una breve dissolvenza audio.
      </p>
    </div>
  );
};

export default SleepTimerMenu;

