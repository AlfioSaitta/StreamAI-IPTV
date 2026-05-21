import React, { forwardRef } from 'react';
import { LucideIcon } from 'lucide-react';

/**
 * StreamAI Design System — IconButton (UI-1.3.3)
 *
 * Bottone quadrato icona-only. Richiede `aria-label` obbligatorio (UI-1.4)
 * per garantire accessibilità.
 */

export type IconButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';
export type IconButtonSize = 'sm' | 'md' | 'lg';
export type IconButtonShape = 'square' | 'circle';

export interface IconButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  icon: LucideIcon;
  /** Etichetta accessibile obbligatoria per pulsanti icona-only. */
  'aria-label': string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  /** Forma: quadrato (default, `rounded-control`) o cerchio (`rounded-full`). */
  shape?: IconButtonShape;
  focusVariant?: 'normal' | 'dense';
}

const VARIANT_CLASSES: Record<IconButtonVariant, string> = {
  primary:
    'bg-brand-primary hover:bg-brand-primary-hover text-white shadow-elev-2',
  secondary:
    'bg-surface-2 hover:bg-surface-3 text-content-primary border border-DEFAULT',
  ghost:
    'bg-transparent hover:bg-surface-2 text-content-primary',
  danger:
    'bg-state-error/90 hover:bg-state-error text-white',
  accent:
    'bg-brand-accent hover:bg-brand-accent-hover text-white shadow-elev-2',
};

// Box e icone scelte per dare lo stesso "peso visivo" del cerchio: l'icona
// occupa ~55% del riquadro così non sembra mai persa al centro. UI-1.4 ⤴.
const SIZE_CLASSES: Record<IconButtonSize, { box: string; icon: string }> = {
  sm: { box: 'w-9 h-9', icon: 'w-icon-sm h-icon-sm' },
  md: { box: 'w-10 h-10', icon: 'w-icon-md h-icon-md' },
  lg: { box: 'w-12 h-12', icon: 'w-icon-lg h-icon-lg' },
};

const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    icon: Icon,
    variant = 'ghost',
    size = 'md',
    shape = 'square',
    focusVariant = 'normal',
    className = '',
    disabled,
    type = 'button',
    ...rest
  },
  ref,
) {
  const sz = SIZE_CLASSES[size];
  const focusClass = focusVariant === 'dense' ? 'tv-focus-dense' : 'tv-focus';
  const shapeClass = shape === 'circle' ? 'rounded-full' : 'rounded-control';

  // UI-1.4 — accessibilità: avviso in development se l'aria-label è vuoto
  // o composto solo da whitespace. Il tipo statico già richiede la prop,
  // ma con `aria-label=""` un consumatore potrebbe aggirare la regola.
  if (
    process.env.NODE_ENV !== 'production' &&
    (!rest['aria-label'] || !String(rest['aria-label']).trim())
  ) {
    // eslint-disable-next-line no-console
    console.warn(
      '[IconButton] aria-label è obbligatorio e non può essere vuoto: ',
      Icon?.displayName ?? 'icon',
    );
  }

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled}
      className={[
        'inline-flex items-center justify-center leading-none',
        shapeClass,
        'transition-colors duration-150',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        sz.box,
        VARIANT_CLASSES[variant],
        focusClass,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      <Icon className={`${sz.icon} block`} aria-hidden="true" />
    </button>
  );
});

export default IconButton;

