import React from 'react';
import { X } from 'lucide-react';
// @ts-ignore
import { List as VirtualList } from 'react-window';
import { Channel } from '../../types';
import PlaylistRow from './PlaylistRow';

interface PlaylistSidebarProps {
  show: boolean;
  onClose: () => void;
  playlist: Channel[];
  currentChannelId: string | number | undefined;
  onChannelSelect: (channel: Channel) => void;
}

export const PlaylistSidebar: React.FC<PlaylistSidebarProps> = ({
  show,
  onClose,
  playlist,
  currentChannelId,
  onChannelSelect
}) => {
  return (
    <div className={`absolute top-0 right-0 bottom-0 w-80 bg-black/90 backdrop-blur-xl border-l border-white/10 z-[60] transform transition-transform duration-300 flex flex-col ${show ? 'translate-x-0' : 'translate-x-full'}`}>
      <div className="p-4 border-b border-white/10 flex items-center justify-between">
        <h3 className="font-bold text-white">Canali ({playlist.length})</h3>
        <button 
          onClick={onClose} 
          aria-label="Chiudi lista canali" 
          className="tv-focus touch-target p-2 rounded-full hover:bg-white/10"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="flex-1 p-2 overflow-hidden">
        <VirtualList
          style={{ height: window.innerHeight - 100 }}
          className="scrollbar-hide"
          rowCount={playlist.length}
          rowHeight={64}
          rowComponent={PlaylistRow as any}
          rowProps={{ playlist, currentChannelId, onChannelSelect } as any}
        />
      </div>
    </div>
  );
};

export default PlaylistSidebar;
