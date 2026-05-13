import React from 'react';
import { SkipForward, X } from 'lucide-react';
import type { Channel } from '../../types.ts';

interface AutoNextOverlayProps {
  isVisible: boolean;
  secondsLeft: number;
  totalSeconds: number;
  nextChannel?: Channel | null;
  onPlayNow: () => void;
  onCancel: () => void;
}

/**
 * Bottom-right "Up Next" overlay shown during the last seconds of an episode.
 * Designed to be unobtrusive (no full-screen takeover) and TV-friendly:
 * focus moves to "Play now" so a single Enter press skips the countdown.
 */
const AutoNextOverlay: React.FC<AutoNextOverlayProps> = ({
  isVisible,
  secondsLeft,
  totalSeconds,
  nextChannel,
  onPlayNow,
  onCancel,
}) => {
  if (!isVisible) return null;

  const progress = totalSeconds > 0 ? Math.max(0, Math.min(1, secondsLeft / totalSeconds)) : 0;
  // SVG circle (24 radius) progress ring.
  const RADIUS = 22;
  const CIRC = 2 * Math.PI * RADIUS;
  const dash = CIRC * progress;
  const offset = CIRC - dash;

  return (
    <div
      role="dialog"
      aria-label="Prossimo episodio"
      className="absolute bottom-24 right-6 z-40 w-80 max-w-[90vw] rounded-2xl border border-white/10 bg-black/85 backdrop-blur-xl shadow-2xl p-4 text-white animate-fade-in"
    >
      <div className="flex items-start gap-3">
        {/* Countdown ring */}
        <div className="relative flex-shrink-0 w-12 h-12">
          <svg viewBox="0 0 50 50" className="w-12 h-12 -rotate-90">
            <circle cx="25" cy="25" r={RADIUS} stroke="rgba(255,255,255,0.15)" strokeWidth="3" fill="none" />
            <circle
              cx="25"
              cy="25"
              r={RADIUS}
              stroke="#dc2626"
              strokeWidth="3"
              fill="none"
              strokeLinecap="round"
              strokeDasharray={CIRC}
              strokeDashoffset={offset}
              style={{ transition: 'stroke-dashoffset 0.4s linear' }}
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center font-mono text-sm font-bold">
            {secondsLeft}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-bold uppercase tracking-widest text-red-400">Prossimo episodio</div>
          <div className="text-sm font-semibold truncate" title={nextChannel?.name}>
            {nextChannel?.cleanName || nextChannel?.name || 'Episodio successivo'}
          </div>
          <div className="text-xs text-gray-400 mt-0.5">
            Riproduzione tra {secondsLeft}s
          </div>
        </div>

        <button
          type="button"
          onClick={onCancel}
          aria-label="Annulla riproduzione automatica"
          className="tv-focus rounded-full p-1.5 hover:bg-white/10 flex-shrink-0"
        >
          <X className="w-4 h-4 text-gray-300" aria-hidden="true" />
        </button>
      </div>

      <div className="flex items-center gap-2 mt-3">
        <button
          type="button"
          onClick={onPlayNow}
          autoFocus
          aria-label="Riproduci ora"
          className="tv-focus flex-1 flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 text-white font-bold rounded-lg px-4 py-2 text-sm"
        >
          <SkipForward className="w-4 h-4" aria-hidden="true" />
          Riproduci ora
        </button>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Annulla"
          className="tv-focus rounded-lg px-3 py-2 text-sm text-gray-200 hover:bg-white/10"
        >
          Annulla
        </button>
      </div>
    </div>
  );
};

export default AutoNextOverlay;

