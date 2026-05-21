import React, { forwardRef } from 'react';
import { LucideIcon } from 'lucide-react';

/**
 * StreamAI Design System — Chip (UI-1.3.3)
 *
 * Per filter palette (Tutto / Live / Film / Serie), EPG filter, tag.
 */

export type ChipSize = 'sm' | 'md';

export interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
  size?: ChipSize;
  icon?: LucideIcon;
}

const SIZE_CLASSES: Record<ChipSize, string> = {
  sm: 'h-7 px-2.5 text-xs gap-1',
  md: 'h-9 px-3.5 text-sm gap-1.5',
};

const ICON_SIZE: Record<ChipSize, string> = {
  sm: 'w-icon-xs h-icon-xs',
  md: 'w-icon-sm h-icon-sm',
};

const Chip = forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  { selected = false, size = 'md', icon: Icon, className = '', children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-pressed={selected}
      className={[
        'tv-focus-dense inline-flex items-center rounded-full font-semibold border',
        'transition-colors duration-150 select-none',
        selected
          ? 'bg-brand-primary text-white border-brand-primary'
          : 'bg-surface-1 hover:bg-surface-2 text-content-secondary border-subtle',
        SIZE_CLASSES[size],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {Icon && <Icon className={ICON_SIZE[size]} aria-hidden="true" />}
      {children}
    </button>
  );
});

export default Chip;

