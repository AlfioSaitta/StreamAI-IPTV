import React from 'react';

/**
 * StreamAI Design System — Spinner (UI-1.3.3)
 *
 * Sostituisce le 4 implementazioni indipendenti di spinner trovate in
 * UI-1.1 (XtreamLogin, AIRecommender, ProfileSettings Save, ecc.).
 */

export type SpinnerSize = 'sm' | 'md' | 'lg' | 'xl';
export type SpinnerTone = 'default' | 'brand' | 'accent' | 'inverted';

export interface SpinnerProps {
  size?: SpinnerSize;
  tone?: SpinnerTone;
  className?: string;
  label?: string;
}

const SIZE_CLASSES: Record<SpinnerSize, string> = {
  sm: 'w-icon-sm h-icon-sm border-2',
  md: 'w-icon-md h-icon-md border-2',
  lg: 'w-icon-lg h-icon-lg border-[3px]',
  xl: 'w-icon-xl h-icon-xl border-4',
};

const TONE_CLASSES: Record<SpinnerTone, string> = {
  default: 'border-white/20 border-t-content-primary',
  brand: 'border-white/20 border-t-brand-primary',
  accent: 'border-white/20 border-t-brand-accent',
  inverted: 'border-black/30 border-t-black',
};

const Spinner: React.FC<SpinnerProps> = ({ size = 'md', tone = 'default', className = '', label }) => {
  return (
    <span
      role={label ? 'status' : undefined}
      aria-live={label ? 'polite' : undefined}
      aria-label={label}
      className={`inline-flex items-center justify-center ${className}`}
    >
      <span
        aria-hidden="true"
        className={`animate-spin rounded-full ${SIZE_CLASSES[size]} ${TONE_CLASSES[tone]}`}
      />
      {label && <span className="sr-only">{label}</span>}
    </span>
  );
};

export default Spinner;

