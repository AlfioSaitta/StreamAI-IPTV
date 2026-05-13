import React from 'react';
import { BookmarkPlus, BookmarkCheck } from 'lucide-react';
import Button, { ButtonSize } from './Button';

interface WatchlistButtonProps {
  isInWatchlist: boolean;
  onToggle: () => void;
  addText: string;
  removeText: string;
  variant?: 'movie' | 'series';
}

const SIZE_BY_VARIANT: Record<NonNullable<WatchlistButtonProps['variant']>, ButtonSize> = {
  movie: 'lg',
  series: 'md',
};

const WatchlistButton: React.FC<WatchlistButtonProps> = ({
  isInWatchlist,
  onToggle,
  addText,
  removeText,
  variant = 'movie',
}) => {
  return (
    <Button
      onClick={onToggle}
      variant="secondary"
      size={SIZE_BY_VARIANT[variant]}
      leftIcon={isInWatchlist ? BookmarkCheck : BookmarkPlus}
      aria-pressed={isInWatchlist}
    >
      {isInWatchlist ? removeText : addText}
    </Button>
  );
};

export default WatchlistButton;
