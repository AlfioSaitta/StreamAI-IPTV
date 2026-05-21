import React, { forwardRef } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * StreamAI Design System — Select (UI-1.3.3)
 *
 * Stesso look di Input, wrap su <select> nativo (gestione tastiera/AT free).
 */

export type SelectSize = 'sm' | 'md' | 'lg';

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  selectSize?: SelectSize;
  invalid?: boolean;
}

const SIZE_CLASSES: Record<SelectSize, string> = {
  sm: 'h-9 text-sm pl-3 pr-9',
  md: 'h-11 text-sm pl-4 pr-10',
  lg: 'h-12 text-base pl-4 pr-10',
};

const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { selectSize = 'md', invalid = false, className = '', disabled, children, ...rest },
  ref,
) {
  return (
    <div className="relative">
      <select
        ref={ref}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        className={[
          'appearance-none w-full rounded-control border bg-surface-2 text-content-primary',
          'transition-colors duration-150 outline-none',
          'focus:ring-2',
          invalid
            ? 'border-state-error focus:ring-state-error/30'
            : 'border-DEFAULT focus:border-brand-primary focus:ring-brand-primary/30',
          disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
          SIZE_CLASSES[selectSize],
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        {...rest}
      >
        {children}
      </select>
      <ChevronDown
        className="absolute right-3 top-1/2 -translate-y-1/2 w-icon-md h-icon-md text-content-muted pointer-events-none"
        aria-hidden="true"
      />
    </div>
  );
});

export default Select;

