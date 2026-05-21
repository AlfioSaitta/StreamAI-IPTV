import React, { forwardRef, useId } from 'react';
import { LucideIcon } from 'lucide-react';

/**
 * StreamAI Design System — Input + FormField (UI-1.3.3)
 *
 * Sostituisce le 5 varianti ad-hoc di `<input>` censite in UI-1.1. Stile
 * coerente: bg-surface-2, border-default, focus = brand primary o accent.
 */

export type InputSize = 'sm' | 'md' | 'lg';
export type InputAccent = 'brand' | 'accent';

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  inputSize?: InputSize;
  /** Colore del bordo in focus: 'brand' (rosso, default) o 'accent' (viola). */
  accent?: InputAccent;
  leftIcon?: LucideIcon;
  rightIcon?: LucideIcon;
  invalid?: boolean;
}

const SIZE_CLASSES: Record<InputSize, string> = {
  sm: 'h-9 text-sm px-3',
  md: 'h-11 text-sm px-4',
  lg: 'h-12 text-base px-4',
};

const ICON_SIZE: Record<InputSize, string> = {
  sm: 'w-icon-sm h-icon-sm',
  md: 'w-icon-md h-icon-md',
  lg: 'w-icon-md h-icon-md',
};

const ACCENT_FOCUS: Record<InputAccent, string> = {
  brand: 'focus-within:border-brand-primary focus-within:ring-brand-primary/30',
  accent: 'focus-within:border-brand-accent focus-within:ring-brand-accent/30',
};

const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    inputSize = 'md',
    accent = 'brand',
    leftIcon: LeftIcon,
    rightIcon: RightIcon,
    invalid = false,
    className = '',
    disabled,
    ...rest
  },
  ref,
) {
  const iconSize = ICON_SIZE[inputSize];
  return (
    <div
      className={[
        'flex items-center gap-2 rounded-control border bg-surface-2',
        'transition-colors duration-150 focus-within:ring-2',
        invalid ? 'border-state-error focus-within:ring-state-error/30' : 'border-DEFAULT',
        invalid ? '' : ACCENT_FOCUS[accent],
        disabled ? 'opacity-50 cursor-not-allowed' : '',
        SIZE_CLASSES[inputSize],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {LeftIcon && <LeftIcon className={`${iconSize} text-content-muted shrink-0`} aria-hidden="true" />}
      <input
        ref={ref}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        className="bg-transparent flex-1 min-w-0 outline-none placeholder:text-content-muted text-content-primary disabled:cursor-not-allowed"
        {...rest}
      />
      {RightIcon && <RightIcon className={`${iconSize} text-content-muted shrink-0`} aria-hidden="true" />}
    </div>
  );
});

export default Input;

// ---------------------------------------------------------------------------
// FormField — wrapper con label, helper, error.
// ---------------------------------------------------------------------------

export interface FormFieldProps {
  label?: string;
  helper?: string;
  error?: string;
  required?: boolean;
  htmlFor?: string;
  children: React.ReactElement;
  className?: string;
}

export const FormField: React.FC<FormFieldProps> = ({
  label,
  helper,
  error,
  required,
  htmlFor,
  children,
  className = '',
}) => {
  const autoId = useId();
  const fieldId = htmlFor || (children.props as { id?: string }).id || `field-${autoId}`;
  const helperId = helper ? `${fieldId}-helper` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  const describedBy = [helperId, errorId].filter(Boolean).join(' ') || undefined;

  const child = React.cloneElement(children, {
    id: fieldId,
    'aria-describedby': describedBy,
    invalid: error ? true : (children.props as { invalid?: boolean }).invalid,
    required,
  } as Partial<InputProps> & { id: string; 'aria-describedby'?: string });

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {label && (
        <label htmlFor={fieldId} className="text-xs font-semibold uppercase tracking-widest text-content-muted">
          {label}
          {required && <span className="text-state-error ml-1" aria-hidden="true">*</span>}
        </label>
      )}
      {child}
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-state-error">
          {error}
        </p>
      ) : helper ? (
        <p id={helperId} className="text-xs text-content-muted">
          {helper}
        </p>
      ) : null}
    </div>
  );
};

