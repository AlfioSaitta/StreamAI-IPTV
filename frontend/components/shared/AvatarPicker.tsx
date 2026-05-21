import React from 'react';
import { AVATARS, AvatarCategory } from '../../services/avatars';
import Avatar from './Avatar';

/**
 * AvatarPicker — galleria selezionabile degli avatar predefiniti.
 *
 * Stile coerente con DS: griglia di tile circolari, tile selezionata con
 * ring `brand-primary`. Le tile sono raggruppate per categoria con un
 * piccolo header.
 */

export interface AvatarPickerProps {
  /** Avatar attualmente selezionato. */
  value: string;
  /** Colore del profilo (usato per il preview di tutte le tile). */
  color: string;
  onChange: (avatarId: string) => void;
  /** Etichetta per gli screen reader (default: "Scegli un avatar"). */
  ariaLabel?: string;
  className?: string;
}

const CATEGORY_LABELS: Record<AvatarCategory, string> = {
  animals: 'Animali',
  fun: 'Pop & Gaming',
  lifestyle: 'Lifestyle',
};

const CATEGORY_ORDER: AvatarCategory[] = ['animals', 'fun', 'lifestyle'];

const AvatarPicker: React.FC<AvatarPickerProps> = ({
  value,
  color,
  onChange,
  ariaLabel = 'Scegli un avatar',
  className = '',
}) => {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={['flex flex-col gap-4', className].join(' ')}
    >
      {CATEGORY_ORDER.map((cat) => {
        const items = AVATARS.filter((a) => a.category === cat);
        if (items.length === 0) return null;
        return (
          <div key={cat} className="flex flex-col gap-2">
            <span className="text-xs font-bold uppercase tracking-widest text-content-muted">
              {CATEGORY_LABELS[cat]}
            </span>
            <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
              {items.map((a) => {
                const selected = a.id === value;
                return (
                  <button
                    key={a.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => onChange(a.id)}
                    title={a.label}
                    aria-label={a.label}
                    className={[
                      'tv-focus-dense relative flex items-center justify-center rounded-full p-0.5 transition-all',
                      selected
                        ? 'ring-2 ring-brand-primary ring-offset-2 ring-offset-surface-1 scale-105'
                        : 'hover:scale-105 opacity-80 hover:opacity-100',
                    ].join(' ')}
                  >
                    <Avatar avatarId={a.id} color={color} size="sm" shape="circle" />
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default AvatarPicker;

