import React from 'react';

/**
 * StreamAI Design System — Card (UI-1.3.3)
 *
 * Wrap "panel" coerente: surface-2 + border subtle + rounded-card.
 * Sostituisce le combinazioni ad-hoc bg-white/5 + bg-white/10 + rounded-2xl/xl.
 */

export type CardElevation = 'flat' | 'raised' | 'overlay';
export type CardPadding = 'none' | 'sm' | 'md' | 'lg';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  elevation?: CardElevation;
  padding?: CardPadding;
  interactive?: boolean;
  as?: React.ElementType;
}

const ELEVATION_CLASSES: Record<CardElevation, string> = {
  flat: 'bg-surface-1 border border-subtle',
  raised: 'bg-surface-2 border border-DEFAULT shadow-elev-2',
  overlay: 'bg-surface-overlay-hard backdrop-blur-md border border-DEFAULT shadow-elev-3',
};

const PADDING_CLASSES: Record<CardPadding, string> = {
  none: '',
  sm: 'p-3',
  md: 'p-5',
  lg: 'p-7',
};

const Card: React.FC<CardProps> = ({
  elevation = 'flat',
  padding = 'md',
  interactive = false,
  as: Tag = 'div',
  className = '',
  children,
  ...rest
}) => {
  return React.createElement(
    Tag,
    {
      className: [
        'rounded-card',
        ELEVATION_CLASSES[elevation],
        PADDING_CLASSES[padding],
        interactive ? 'tv-focus transition-colors hover:bg-surface-3' : '',
        className,
      ]
        .filter(Boolean)
        .join(' '),
      ...rest,
    },
    children,
  );
};

export default Card;


