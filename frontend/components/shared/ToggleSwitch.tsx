import React, { forwardRef } from 'react';
/**
 * StreamAI Design System — ToggleSwitch (UI-1.3.3)
 *
 * Ispirato al pattern iOS-style di CodePen (pragyajha/ZxYZEJ): track pill
 * con knob circolare, padding interno costante (2 px) su tutti i lati,
 * traslazione netta sull'asse X con `cubic-bezier(.4,0,.2,1)`.
 */
export type ToggleSwitchSize = 'sm' | 'md' | 'lg';
export type ToggleSwitchTone = 'brand' | 'accent' | 'success';
export interface ToggleSwitchProps
  extends Omit<
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    'onChange' | 'aria-label'
  > {
  checked: boolean;
  onChange: (next: boolean) => void;
  size?: ToggleSwitchSize;
  tone?: ToggleSwitchTone;
  label?: React.ReactNode;
  description?: React.ReactNode;
  ariaLabel?: string;
  disabled?: boolean;
}
// Proporzioni iOS-style: knob = track height − 4px (padding 2px per lato),
// quindi cerchio perfetto centrato nel track.
const SIZE_TRACK: Record<ToggleSwitchSize, string> = {
  sm: 'h-5 w-9',    // 36 × 20
  md: 'h-6 w-11',   // 44 × 24
  lg: 'h-8 w-14',   // 56 × 32
};
const SIZE_KNOB: Record<ToggleSwitchSize, string> = {
  sm: 'w-4 h-4',    // 16 (track 20 − 4 padding)
  md: 'w-5 h-5',    // 20 (track 24 − 4 padding)
  lg: 'w-7 h-7',    // 28 (track 32 − 4 padding)
};
// Traslazione del knob in "on" = track width − knob width − 4px padding.
const SIZE_TRANSLATE: Record<ToggleSwitchSize, string> = {
  sm: 'translate-x-4',   // 36 − 16 − 4 = 16 px
  md: 'translate-x-5',   // 44 − 20 − 4 = 20 px
  lg: 'translate-x-6',   // 56 − 28 − 4 = 24 px
};
const TONE_ON: Record<ToggleSwitchTone, string> = {
  brand: 'bg-brand-primary',
  accent: 'bg-brand-accent',
  success: 'bg-state-success',
};
const TONE_GLOW: Record<ToggleSwitchTone, string> = {
  brand:
    'shadow-[inset_0_0_0_1px_rgba(0,0,0,0.25),0_0_0_3px_rgba(220,38,38,0.18)]',
  accent:
    'shadow-[inset_0_0_0_1px_rgba(0,0,0,0.25),0_0_0_3px_rgba(168,85,247,0.22)]',
  success:
    'shadow-[inset_0_0_0_1px_rgba(0,0,0,0.25),0_0_0_3px_rgba(52,211,153,0.22)]',
};
const TRACK_OFF =
  'bg-surface-3 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.25)]';
const ToggleSwitchControl = forwardRef<HTMLButtonElement, ToggleSwitchProps>(
  function ToggleSwitchControl(
    {
      checked,
      onChange,
      size = 'md',
      tone = 'brand',
      disabled,
      ariaLabel,
      label,
      description, // eslint-disable-line @typescript-eslint/no-unused-vars
      className = '',
      onClick,
      ...rest
    },
    ref,
  ) {
    const trackBase =
      // NB: NON usare `tv-focus-dense` qui: applica `min-h-[44px]` che
      // farebbe diventare il track quadrato/cerchio sui size sm/md/lg.
      // Riproduciamo lo stesso focus (outline brand 2px + offset) ma
      // senza il min-height: il touch target è garantito dalla riga form.
      'group relative inline-flex items-center flex-shrink-0 ' +
      'rounded-full transition-colors duration-200 ease-[cubic-bezier(.4,0,.2,1)] ' +
      'outline-none align-middle p-[2px] ' +
      'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ' +
      'focus-visible:outline-[var(--color-brand-primary)]';
    const disabledCls = disabled
      ? 'opacity-50 cursor-not-allowed'
      : 'cursor-pointer';
    return (
      <button
        ref={ref}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={!label ? ariaLabel : undefined}
        disabled={disabled}
        onClick={(e) => {
          if (disabled) return;
          onChange(!checked);
          onClick?.(e);
        }}
        className={[
          trackBase,
          SIZE_TRACK[size],
          checked ? `${TONE_ON[tone]} ${TONE_GLOW[tone]}` : TRACK_OFF,
          disabledCls,
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        {...rest}
      >
        <span
          aria-hidden="true"
          className={[
            'pointer-events-none inline-block rounded-full bg-white',
            'shadow-elev-2 ring-1 ring-black/10',
            'transform transition-transform duration-200 ease-[cubic-bezier(.4,0,.2,1)]',
            'group-active:scale-x-110 group-active:scale-y-95',
            SIZE_KNOB[size],
            checked ? SIZE_TRANSLATE[size] : 'translate-x-0',
          ].join(' ')}
        />
      </button>
    );
  },
);
const ToggleSwitch = forwardRef<HTMLButtonElement, ToggleSwitchProps>(
  function ToggleSwitch(props, ref) {
    const { label, description, disabled } = props;
    if (!label && !description) {
      return <ToggleSwitchControl ref={ref} {...props} />;
    }
    const labelId = React.useId();
    return (
      <label
        className={[
          'flex items-center justify-between gap-4 w-full',
          disabled ? 'cursor-not-allowed' : 'cursor-pointer',
        ].join(' ')}
      >
        <span className="flex-1 min-w-0">
          {label && (
            <span
              id={labelId}
              className="block text-sm font-medium text-content-primary"
            >
              {label}
            </span>
          )}
          {description && (
            <span className="block text-xs text-content-muted mt-0.5">
              {description}
            </span>
          )}
        </span>
        <ToggleSwitchControl
          ref={ref}
          {...props}
          aria-labelledby={label ? labelId : undefined}
        />
      </label>
    );
  },
);
export default ToggleSwitch;
