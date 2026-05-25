import React from 'react';
import { Channel } from '../../types';

interface PlaylistRowProps {
  index: number;
  style: React.CSSProperties;
  playlist: Channel[];
  currentChannelId: string | number | undefined;
  onChannelSelect?: (channel: Channel) => void;
}

export const PlaylistRow: React.FC<PlaylistRowProps> = ({ 
  index, 
  style, 
  playlist, 
  currentChannelId, 
  onChannelSelect 
}) => {
  const c = playlist[index];
  if (!c) return null;
  
  const isActive = c.id === currentChannelId;
  
  return (
    <div style={style} className="px-1 py-1">
      <button 
        onClick={() => onChannelSelect && onChannelSelect(c)}
        className={`tv-focus w-full text-left p-3 rounded-lg flex items-center gap-3 transition-colors ${isActive ? 'bg-brand-primary text-white' : 'hover:bg-white/10 text-gray-300'}`}
      >
          {c.logo && <img src={c.logo} alt={c.name} className="w-8 h-8 object-contain bg-black rounded" loading="lazy" />}
          <span className="truncate text-sm font-medium">{c.cleanName || c.name}</span>
      </button>
    </div>
  );
};

export default PlaylistRow;
