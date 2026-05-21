import React from 'react';
import { LucideIcon } from 'lucide-react';

/**
 * StreamAI Design System — Badge (UI-1.3.3)
 *
 * Per indicatori: HD / Live / Premium / Match% / 4K / EPG counters.
 * Un solo tono per stato semantico (UI-1.7).
 */

export type BadgeTone =
  | 'neutral'
  | 'brand'
  | 'accent'
  | 'success'
  | 'warning'
  | 'error'
  | 'info';

export type BadgeSize = 'xs' | 'sm' | 'md';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  size?: BadgeSize;
  icon?: LucideIcon;
  /** Pallino pulsante (es. Live now). */
  pulse?: boolean;
}

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-2 text-content-primary border-DEFAULT',
  brand: 'bg-brand-primary/20 text-brand-primary border-brand-primary/40',
  accent: 'bg-brand-accent/20 text-brand-accent border-brand-accent/40',
  success: 'bg-state-success/15 text-state-success border-state-success/40',
  warning: 'bg-state-warning/15 text-state-warning border-state-warning/40',
  error: 'bg-state-error/15 text-state-error border-state-error/40',
  info: 'bg-state-info/15 text-state-info border-state-info/40',
};

const SIZE_CLASSES: Record<BadgeSize, string> = {
  xs: 'h-5 px-1.5 text-[10px] gap-1 leading-none',
  sm: 'h-6 px-2 text-xs gap-1 leading-none',
  md: 'h-7 px-2.5 text-sm gap-1.5 leading-none',
};

const ICON_SIZE: Record<BadgeSize, string> = {
  xs: 'w-icon-xs h-icon-xs',
  sm: 'w-icon-xs h-icon-xs',
  md: 'w-icon-sm h-icon-sm',
};

const Badge: React.FC<BadgeProps> = ({
  tone = 'neutral',
  size = 'sm',
  icon: Icon,
  pulse = false,
  className = '',
  children,
  ...rest
}) => {
  return (
    <span
      className={[
        'inline-flex items-center font-semibold uppercase tracking-wider rounded-full border',
        SIZE_CLASSES[size],
        TONE_CLASSES[tone],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {pulse && (
        <span className="relative flex w-2 h-2" aria-hidden="true">
          <span className="absolute inset-0 rounded-full bg-current opacity-75 animate-ping" />
          <span className="relative inline-flex w-2 h-2 rounded-full bg-current" />
        </span>
      )}
      {Icon && <Icon className={ICON_SIZE[size]} aria-hidden="true" />}
      {children}
    </span>
  );
};

export default Badge;

