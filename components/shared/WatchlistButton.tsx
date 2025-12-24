import React from 'react';
import { BookmarkPlus, BookmarkCheck } from 'lucide-react';

interface WatchlistButtonProps {
  isInWatchlist: boolean;
  onToggle: () => void;
  addText: string;
  removeText: string;
  variant?: 'movie' | 'series';
}

const WatchlistButton: React.FC<WatchlistButtonProps> = ({ 
  isInWatchlist, 
  onToggle, 
  addText, 
  removeText,
  variant = 'movie'
}) => {
  const isMovie = variant === 'movie';
  const iconSize = isMovie ? 'w-5 h-5' : 'w-4 h-4';
  
  return (
    <button
      onClick={onToggle}
      className="tv-focus flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg border border-white/10 transition-colors"
    >
      {isInWatchlist ? <BookmarkCheck className={iconSize} /> : <BookmarkPlus className={iconSize} />}
      <span className="text-sm font-semibold">{isInWatchlist ? removeText : addText}</span>
    </button>
  );
};

export default WatchlistButton;
