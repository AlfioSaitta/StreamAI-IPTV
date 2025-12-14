import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, Loader2, Play, ChevronRight, Tv, Film, Clapperboard } from 'lucide-react';
import { getRecommendations } from '../services/geminiService.ts';
import { Channel, Recommendation, StreamType, WatchHistoryItem } from '../types.ts';

interface AIRecommenderProps {
  channels: Channel[];
  onPlayChannel: (name: string) => void;
  activeTab: StreamType;
  history: WatchHistoryItem[];
}

const AIRecommender: React.FC<AIRecommenderProps> = ({ channels, onPlayChannel, activeTab, history }) => {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
        setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Context-aware suggestions based on history if available
  const getSuggestions = () => {
      // If we have history, maybe suggest something related
      if (history.length > 0) {
          return ["In base a cosa ho visto", "Qualcosa di simile all'ultimo film", "Sorprendimi", "Nuove uscite"];
      }

      switch (activeTab) {
          case 'movie':
              return ["Film anni 90", "Azione con rating alto", "Commedia divertente", "Horror spaventoso"];
          case 'series':
              return ["Serie Crime", "Sitcom da ridere", "Documentari natura", "Serie premiate"];
          case 'live':
          default:
              return ["Canali News", "Sport in diretta", "Cartoni animati", "Musica Pop"];
      }
  };

  const handleSearch = async (customPrompt?: string) => {
    const query = customPrompt || prompt;
    if (!query.trim()) return;
    
    setLoading(true);
    setRecommendations([]);
    setPrompt(query);
    
    // Pass history to the service
    const results = await getRecommendations(channels, query, activeTab, history);
    setRecommendations(results);
    setLoading(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') handleSearch();
  };

  // Find the full channel object for the recommendation to display logo/image
  const getChannelDetails = (name: string) => {
      return channels.find(c => c.name === name);
  };

  const Icon = activeTab === 'movie' ? Film : activeTab === 'series' ? Clapperboard : Tv;

  if (!isOpen) {
      return (
          <button 
            onClick={() => setIsOpen(true)}
            className="absolute bottom-6 right-6 z-40 bg-gradient-to-r from-purple-600 to-indigo-600 text-white p-4 rounded-full shadow-xl hover:scale-110 transition-transform group border border-white/20"
            title="AI Assistant"
          >
              <Sparkles className="w-6 h-6 animate-pulse group-hover:rotate-12 transition-transform" />
          </button>
      )
  }

  return (
    <div className="absolute bottom-6 right-6 z-40 w-[450px] max-w-[95vw] bg-gray-900/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden max-h-[80vh] animation-slide-up">
      
      {/* Header */}
      <div className="p-5 bg-gradient-to-r from-purple-900/50 to-indigo-900/50 border-b border-white/10 flex justify-between items-center">
        <div className="flex items-center gap-3">
            <div className="bg-purple-500/20 p-2 rounded-lg">
                <Sparkles className="w-5 h-5 text-purple-400" />
            </div>
            <div>
                <h3 className="font-bold text-white leading-none">AI Assistant</h3>
                <span className="text-xs text-purple-300 font-medium tracking-wide opacity-80 uppercase">
                    {activeTab === 'live' ? 'Live TV' : activeTab === 'movie' ? 'VOD Expert' : 'Series Expert'}
                </span>
            </div>
        </div>
        <button 
            onClick={() => setIsOpen(false)} 
            className="text-gray-400 hover:text-white hover:bg-white/10 p-1.5 rounded-lg transition-colors"
        >
            &times;
        </button>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-4">
        
        {/* Welcome / Suggestions */}
        {recommendations.length === 0 && !loading && (
            <div className="space-y-4">
                <p className="text-gray-300 text-sm leading-relaxed">
                    {history.length > 0 
                     ? "Bentornato! Conosco i tuoi gusti. Chiedimi consigli basati su ciò che hai visto." 
                     : "Ciao! Sono il tuo assistente intelligente. Analizzo trame, generi e valutazioni per trovare il contenuto perfetto per te."}
                </p>
                <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase mb-3">Suggerimenti Rapidi</p>
                    <div className="flex flex-wrap gap-2">
                        {getSuggestions().map(s => (
                            <button
                                key={s}
                                onClick={() => handleSearch(s)}
                                className="text-xs bg-white/5 hover:bg-purple-600 hover:text-white border border-white/10 text-gray-300 px-3 py-1.5 rounded-full transition-all"
                            >
                                {s}
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        )}

        {/* Loading State */}
        {loading && (
            <div className="flex flex-col items-center justify-center py-8 text-purple-400 space-y-3">
                <Loader2 className="w-8 h-8 animate-spin" />
                <span className="text-sm font-medium animate-pulse">Analisi del catalogo in corso...</span>
            </div>
        )}

        {/* Results List */}
        {recommendations.length > 0 && (
            <div className="space-y-4">
                {recommendations.map((rec, idx) => {
                    const details = getChannelDetails(rec.channelName);
                    return (
                        <div key={idx} className="group bg-gray-800/40 hover:bg-gray-800/80 rounded-xl border border-white/5 hover:border-purple-500/30 transition-all overflow-hidden flex flex-row">
                            {/* Poster/Icon */}
                            <div className="w-20 bg-gray-900 shrink-0 relative">
                                {details?.logo ? (
                                    <img src={details.logo} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" alt="" />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-gray-600">
                                        <Icon className="w-8 h-8" />
                                    </div>
                                )}
                            </div>
                            
                            {/* Text Info */}
                            <div className="p-3 flex-1 flex flex-col justify-center min-w-0">
                                <h4 className="font-bold text-gray-100 truncate text-sm mb-1">{rec.channelName}</h4>
                                <p className="text-xs text-gray-400 leading-snug line-clamp-2">{rec.reason}</p>
                            </div>

                            {/* Play Button */}
                            <button 
                                onClick={() => onPlayChannel(rec.channelName)}
                                className="w-12 flex items-center justify-center bg-white/5 hover:bg-purple-600 text-purple-400 hover:text-white transition-colors border-l border-white/5"
                                title="Play"
                            >
                                <Play className="w-5 h-5 fill-current" />
                            </button>
                        </div>
                    );
                })}
            </div>
        )}
      </div>

      {/* Input Area */}
      <div className="p-4 bg-gray-900 border-t border-white/10">
        <div className="flex items-center gap-2 bg-black/40 border border-gray-700 focus-within:border-purple-500 rounded-xl px-3 py-2 transition-colors">
            <Sparkles className="w-4 h-4 text-purple-500" />
            <input 
                ref={inputRef}
                type="text"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={`Cosa vuoi guardare in ${activeTab === 'live' ? 'TV' : activeTab === 'movie' ? 'Film' : 'Serie'}?`}
                className="flex-1 bg-transparent text-sm text-white placeholder-gray-500 focus:outline-none"
            />
            <button 
                onClick={() => handleSearch()}
                disabled={loading || !prompt.trim()}
                className="p-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg disabled:opacity-50 disabled:bg-gray-700 transition-colors"
            >
                <ChevronRight className="w-4 h-4" />
            </button>
        </div>
      </div>
    </div>
  );
};

export default AIRecommender;