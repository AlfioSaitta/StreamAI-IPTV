import React from 'react';
import { LucideIcon, LucideProps } from 'lucide-react';

/**
 * StreamAI Design System — Icon (UI-1.3.5)
 *
 * Wrapper su qualunque icona `lucide-react` per garantire una scala
 * coerente (icon-xs..xl) e impostare aria-hidden di default.
 */

export type IconSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface IconProps extends Omit<LucideProps, 'size'> {
  icon: LucideIcon;
  size?: IconSize;
  /** Forza `aria-hidden=false` quando l'icona è semantica e necessita di label. */
  decorative?: boolean;
}

const SIZE_CLASSES: Record<IconSize, string> = {
  xs: 'w-icon-xs h-icon-xs',
  sm: 'w-icon-sm h-icon-sm',
  md: 'w-icon-md h-icon-md',
  lg: 'w-icon-lg h-icon-lg',
  xl: 'w-icon-xl h-icon-xl',
};

const Icon: React.FC<IconProps> = ({
  icon: Component,
  size = 'md',
  decorative = true,
  className = '',
  ...rest
}) => {
  return (
    <Component
      className={`${SIZE_CLASSES[size]} ${className}`}
      aria-hidden={decorative || undefined}
      {...rest}
    />
  );
};

export default Icon;

