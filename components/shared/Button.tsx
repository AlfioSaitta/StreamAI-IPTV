import React, { forwardRef } from 'react';
import { LucideIcon } from 'lucide-react';

/**
 * StreamAI Design System — Button (UI-1.3.3)
 *
 * Single source of truth per le CTA dell'app. Tutte le varianti rispettano i
 * token DS (`brand`, `surface`, `state-*`) e applicano `tv-focus` per la
 * navigazione spaziale via tastiera/telecomando.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  loading?: boolean;
  leftIcon?: LucideIcon;
  rightIcon?: LucideIcon;
  /** Variante di focus: 'normal' (default, scala 105) o 'dense' (no scale). */
  focusVariant?: 'normal' | 'dense';
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-primary hover:bg-brand-primary-hover active:bg-brand-primary-press text-white shadow-elev-2',
  secondary:
    'bg-surface-2 hover:bg-surface-3 text-content-primary border border-DEFAULT',
  ghost:
    'bg-transparent hover:bg-surface-2 text-content-primary',
  danger:
    'bg-state-error/90 hover:bg-state-error text-white shadow-elev-2',
  accent:
    'bg-brand-accent hover:bg-brand-accent-hover active:bg-brand-accent-press text-white shadow-elev-2',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-sm gap-1.5',
  md: 'h-11 px-5 text-sm gap-2',
  lg: 'h-12 px-6 text-base gap-2.5',
};

const ICON_SIZE: Record<ButtonSize, string> = {
  sm: 'w-icon-sm h-icon-sm',
  md: 'w-icon-md h-icon-md',
  lg: 'w-icon-md h-icon-md',
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    fullWidth = false,
    loading = false,
    leftIcon: LeftIcon,
    rightIcon: RightIcon,
    focusVariant = 'normal',
    className = '',
    children,
    disabled,
    type = 'button',
    ...rest
  },
  ref,
) {
  const focusClass = focusVariant === 'dense' ? 'tv-focus-dense' : 'tv-focus';
  const isDisabled = disabled || loading;
  const iconSize = ICON_SIZE[size];

  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      className={[
        'inline-flex items-center justify-center font-semibold rounded-control select-none',
        'transition-colors duration-150',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        SIZE_CLASSES[size],
        VARIANT_CLASSES[variant],
        focusClass,
        fullWidth ? 'w-full' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {loading ? (
        <span
          aria-hidden="true"
          className={`${iconSize} animate-spin rounded-full border-2 border-white/40 border-t-white`}
        />
      ) : (
        LeftIcon && <LeftIcon className={iconSize} aria-hidden="true" />
      )}
      {children && <span className="truncate">{children}</span>}
      {!loading && RightIcon && <RightIcon className={iconSize} aria-hidden="true" />}
    </button>
  );
});

export default Button;

