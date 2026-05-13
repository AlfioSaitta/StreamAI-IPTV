import React, { useEffect, useMemo, useRef } from 'react';
import { X, Keyboard } from 'lucide-react';
import { IconButton } from './shared';

export interface ShortcutEntry {
  keys: string[];
  description: string;
}

export interface ShortcutGroup {
  title: string;
  entries: ShortcutEntry[];
}

interface ShortcutsCheatsheetProps {
  isOpen: boolean;
  onClose: () => void;
  groups?: ShortcutGroup[];
}

/**
 * Default keyboard shortcuts grouped for the cheatsheet overlay.
 * Aligned with `hooks/usePlayerShortcuts.ts` and `App.tsx` back/Esc handling.
 */
export const DEFAULT_SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Player',
    entries: [
      { keys: ['Space', 'Enter', 'P'], description: 'Play / Pausa' },
      { keys: ['←', '→'], description: 'Seek −10s / +10s' },
      { keys: ['↑', '↓'], description: 'Volume +10% / −10%' },
      { keys: ['M'], description: 'Muto / Audio attivo' },
      { keys: ['F'], description: 'Fullscreen toggle' },
      { keys: ['C'], description: 'Menu Cast (Chromecast / DLNA / AirPlay)' },
      { keys: ['L'], description: 'Lista canali (Live) o episodi (Serie)' },
      { keys: ['G'], description: 'Guida TV / Mini-EPG (Live)' },
      { keys: ['T'], description: 'Sleep timer (menu spegnimento)' },
    ],
  },
  {
    title: 'Navigazione',
    entries: [
      { keys: ['Ctrl+K', '⌘K'], description: 'Ricerca globale (Command Palette)' },
      { keys: ['Tab', 'Shift+Tab'], description: 'Spostamento focus (TV / Telecomando)' },
      { keys: ['Esc'], description: 'Indietro / Chiudi modale' },
      { keys: ['?', 'Shift+/'], description: 'Mostra questa scheda' },
    ],
  },
  {
    title: 'Picture-in-Picture',
    entries: [
      { keys: ['P'], description: 'PiP attivo durante la riproduzione (Desktop e Android)' },
    ],
  },
];

const Kbd: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <kbd className="inline-flex items-center justify-center min-w-[2.25rem] px-2 py-1 rounded-control border border-DEFAULT bg-surface-2 text-xs font-mono text-content-primary shadow-elev-1">
    {children}
  </kbd>
);

const ShortcutsCheatsheet: React.FC<ShortcutsCheatsheetProps> = ({ isOpen, onClose, groups }) => {
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const data = useMemo(() => groups ?? DEFAULT_SHORTCUT_GROUPS, [groups]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    // Auto-focus close button for keyboard users
    const t = window.setTimeout(() => closeBtnRef.current?.focus(), 50);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.clearTimeout(t);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-cheatsheet-title"
      className="fixed inset-0 z-[300] flex items-center justify-center bg-surface-scrim backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl max-h-[85vh] overflow-auto rounded-modal border border-DEFAULT bg-surface-1 shadow-elev-3 p-6 md:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-brand-accent/20 p-2">
              <Keyboard className="w-icon-md h-icon-md text-brand-accent" aria-hidden="true" />
            </div>
            <div>
              <h2 id="shortcuts-cheatsheet-title" className="text-xl font-bold text-content-primary">
                Scorciatoie da tastiera
              </h2>
              <p className="text-sm text-content-muted">
                Premi <Kbd>?</Kbd> in qualsiasi momento per aprire questa scheda.
              </p>
            </div>
          </div>
          <IconButton
            ref={closeBtnRef}
            icon={X}
            aria-label="Chiudi scheda scorciatoie"
            variant="ghost"
            size="md"
            onClick={onClose}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {data.map(group => (
            <section key={group.title} className="space-y-3">
              <h3 className="text-sm font-bold uppercase tracking-widest text-content-muted">
                {group.title}
              </h3>
              <ul className="space-y-2">
                {group.entries.map((entry, idx) => (
                  <li key={`${group.title}-${idx}`} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-content-secondary">{entry.description}</span>
                    <span className="flex flex-wrap items-center gap-1 justify-end">
                      {entry.keys.map((k, i) => (
                        <React.Fragment key={i}>
                          {i > 0 && <span className="text-content-disabled text-xs">o</span>}
                          <Kbd>{k}</Kbd>
                        </React.Fragment>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <p className="mt-6 pt-4 border-t border-subtle text-xs text-content-disabled">
          Per dispositivi senza tastiera: tutti i comandi sono accessibili anche dai
          pulsanti del player e dal menu contestuale, navigabili con Tab/D-pad.
        </p>
      </div>
    </div>
  );
};

export default ShortcutsCheatsheet;

