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

export interface IconButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  icon: LucideIcon;
  /** Etichetta accessibile obbligatoria per pulsanti icona-only. */
  'aria-label': string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
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

const SIZE_CLASSES: Record<IconButtonSize, { box: string; icon: string }> = {
  sm: { box: 'w-9 h-9', icon: 'w-icon-sm h-icon-sm' },
  md: { box: 'w-11 h-11', icon: 'w-icon-md h-icon-md' },
  lg: { box: 'w-12 h-12', icon: 'w-icon-lg h-icon-lg' },
};

const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    icon: Icon,
    variant = 'ghost',
    size = 'md',
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

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled}
      className={[
        'inline-flex items-center justify-center rounded-control',
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
      <Icon className={sz.icon} aria-hidden="true" />
    </button>
  );
});

export default IconButton;

