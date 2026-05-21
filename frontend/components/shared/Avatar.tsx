import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { getAvatar } from '../../services/avatars';

/**
 * Avatar — render unificato per i profili.
 *
 * Linguaggio grafico: cerchio (o rounded-card per le tile grandi) con
 * gradient verticale derivato dal `color` del profilo (top più chiaro,
 * bottom più scuro) + icona Lucide a stroke uniforme centrata in bianco
 * 92% opacity. Coerenza totale per qualsiasi avatar del catalogo
 * (`services/avatars.ts`).
 */

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
export type AvatarShape = 'circle' | 'card';

const SIZE_CONTAINER: Record<AvatarSize, string> = {
  xs: 'w-8 h-8',
  sm: 'w-12 h-12',
  md: 'w-16 h-16',
  lg: 'w-24 h-24',
  xl: 'w-28 h-28',
  '2xl': 'w-32 h-32 md:w-40 md:h-40',
};

const SIZE_ICON: Record<AvatarSize, string> = {
  xs: 'w-4 h-4',
  sm: 'w-6 h-6',
  md: 'w-8 h-8',
  lg: 'w-12 h-12',
  xl: 'w-14 h-14',
  '2xl': 'w-16 h-16 md:w-20 md:h-20',
};

export interface AvatarProps {
  /** ID avatar dal catalogo (`services/avatars.ts`). */
  avatarId?: string | null;
  /** Override esplicito dell'icona (bypass del catalogo). */
  icon?: LucideIcon;
  /** Colore base del profilo (hex). Usato per il gradient. */
  color: string;
  size?: AvatarSize;
  shape?: AvatarShape;
  className?: string;
  /** Etichetta accessibile (es. nome profilo). Quando assente, decorativo. */
  label?: string;
}

/**
 * Schiarisce un colore hex di una percentuale (0-100). Usato per costruire
 * il top-stop del gradient senza dipendenze CSS-vars dinamiche.
 */
function lighten(hex: string, percent: number): string {
  const m = hex.replace('#', '').match(/^([0-9a-f]{6}|[0-9a-f]{3})$/i);
  if (!m) return hex;
  let value = m[1];
  if (value.length === 3) value = value.split('').map((c) => c + c).join('');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  const f = percent / 100;
  const lr = Math.round(r + (255 - r) * f);
  const lg = Math.round(g + (255 - g) * f);
  const lb = Math.round(b + (255 - b) * f);
  return `#${[lr, lg, lb].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Scurisce un colore hex di una percentuale. Usato per il bottom-stop.
 */
function darken(hex: string, percent: number): string {
  const m = hex.replace('#', '').match(/^([0-9a-f]{6}|[0-9a-f]{3})$/i);
  if (!m) return hex;
  let value = m[1];
  if (value.length === 3) value = value.split('').map((c) => c + c).join('');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  const f = 1 - percent / 100;
  const dr = Math.max(0, Math.round(r * f));
  const dg = Math.max(0, Math.round(g * f));
  const db = Math.max(0, Math.round(b * f));
  return `#${[dr, dg, db].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

const Avatar: React.FC<AvatarProps> = ({
  avatarId,
  icon,
  color,
  size = 'md',
  shape = 'card',
  className = '',
  label,
}) => {
  const fromColor = lighten(color, 18);
  const toColor = darken(color, 22);
  const radius = shape === 'circle' ? 'rounded-full' : 'rounded-card';

  const Icon = icon ?? getAvatar(avatarId).icon;

  return (
    <div
      className={[
        SIZE_CONTAINER[size],
        radius,
        'relative flex items-center justify-center overflow-hidden shadow-elev-2',
        className,
      ].join(' ')}
      style={{
        // Linear gradient top→bottom: stessa cifra stilistica per ogni
        // avatar — è la "voce" comune del set.
        background: `linear-gradient(160deg, ${fromColor} 0%, ${color} 55%, ${toColor} 100%)`,
      }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {/* Soft top highlight: stessa glossiness per tutti gli avatar. */}
      <div className="absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b from-white/15 to-transparent pointer-events-none" />
      <Icon
        className={`${SIZE_ICON[size]} text-white/95 relative z-10`}
        // stroke uniforme: linea costante = stile coerente.
        strokeWidth={1.75}
        aria-hidden="true"
      />
    </div>
  );
};

export default Avatar;

