import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, Loader2, Play, Search, X, Tv, Film, Clapperboard } from 'lucide-react';
import { getRecommendations, isAiAvailable } from '../services/geminiService.ts';
import { Channel, Recommendation, StreamType, WatchHistoryItem } from '../types.ts';

interface AIRecommenderProps {
  channels: Channel[];
  onPlayChannel: (name: string) => void;
  activeTab: StreamType;
  history: WatchHistoryItem[];
  aiCaching?: boolean;
  geminiApiKey?: string;
}

const AIRecommender: React.FC<AIRecommenderProps> = ({ channels, onPlayChannel, activeTab, history, aiCaching = true, geminiApiKey }) => {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Check if AI is available (Circuit Breaker)
  if (!isAiAvailable()) {
    return null;
  }

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
        setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Context-aware suggestions based on history if available
  const getSuggestions = () => {
      if (history.length > 0) {
          return ["In base a cosa ho visto", "Simile all'ultimo", "Sorprendimi"];
      }
      switch (activeTab) {
          case 'movie':
              return ["Film anni 90", "Azione", "Commedia", "Horror"];
          case 'series':
              return ["Serie Crime", "Sitcom", "Documentari"];
          case 'live':
          default:
              return ["News", "Sport", "Cartoni", "Musica"];
      }
  };

  const handleSearch = async (customPrompt?: string) => {
    const query = customPrompt || prompt;
    if (!query.trim()) return;
    
    setLoading(true);
    setRecommendations([]);
    setPrompt(query);
    
    const results = await getRecommendations(channels, query, activeTab, history, aiCaching, geminiApiKey);
    setRecommendations(results);
    setLoading(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') handleSearch();
      if (e.key === 'Escape') setIsOpen(false);
  };

  const getChannelDetails = (name: string) => {
      return channels.find(c => c.name === name);
  };

  const Icon = activeTab === 'movie' ? Film : activeTab === 'series' ? Clapperboard : Tv;

  // Stato chiuso: mostra solo la barra di ricerca compatta
  if (!isOpen) {
      return (
          <div className="absolute bottom-6 right-6 z-40">
              <button
                onClick={() => setIsOpen(true)}
                className="flex items-center gap-3 bg-gray-900/95 backdrop-blur-xl border border-white/10 hover:border-purple-500/50 rounded-full pl-4 pr-5 py-3 shadow-2xl transition-all hover:scale-105 group"
              >
                  <div className="bg-purple-500/20 p-2 rounded-full">
                      <Sparkles className="w-4 h-4 text-purple-400 animate-pulse" />
                  </div>
                  <span className="text-sm text-gray-400 group-hover:text-white transition-colors">
                      Chiedi all'AI...
                  </span>
              </button>
          </div>
      )
  }

  return (
    <div className="absolute bottom-6 right-6 z-40 w-[420px] max-w-[95vw] bg-gray-900/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden max-h-[70vh]">

      {/* Header con Search integrata */}
      <div className="p-3 bg-gradient-to-r from-purple-900/50 to-indigo-900/50 border-b border-white/10">
        <div className="flex items-center gap-2 bg-black/40 border border-gray-700 focus-within:border-purple-500 rounded-xl px-3 py-2 transition-colors">
            <Sparkles className="w-5 h-5 text-purple-400 shrink-0" />
            <input
                ref={inputRef}
                type="text"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={`Cerca ${activeTab === 'live' ? 'canali' : activeTab === 'movie' ? 'film' : 'serie'} con AI...`}
                className="flex-1 bg-transparent text-sm text-white placeholder-gray-500 focus:outline-none min-w-0"
            />
            {prompt ? (
                <button
                    onClick={() => setPrompt('')}
                    className="p-1 text-gray-500 hover:text-white transition-colors"
                >
                    <X className="w-4 h-4" />
                </button>
            ) : null}
            <button
                onClick={() => handleSearch()}
                disabled={loading || !prompt.trim()}
                className="p-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg disabled:opacity-50 disabled:bg-gray-700 transition-colors"
            >
                <Search className="w-4 h-4" />
            </button>
            <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 text-gray-500 hover:text-white hover:bg-white/10 rounded-lg transition-colors ml-1"
            >
                <X className="w-4 h-4" />
            </button>
        </div>

        {/* Suggerimenti rapidi inline */}
        {recommendations.length === 0 && !loading && (
            <div className="flex flex-wrap gap-1.5 mt-2">
                {getSuggestions().map(s => (
                    <button
                        key={s}
                        onClick={() => handleSearch(s)}
                        className="text-xs bg-white/5 hover:bg-purple-600 hover:text-white border border-white/10 text-gray-400 px-2.5 py-1 rounded-full transition-all"
                    >
                        {s}
                    </button>
                ))}
            </div>
        )}
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">

        {/* Loading State */}
        {loading && (
            <div className="flex items-center justify-center gap-3 py-8 text-purple-400">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-sm font-medium">Cerco...</span>
            </div>
        )}

        {/* Empty State */}
        {recommendations.length === 0 && !loading && (
            <div className="p-4 text-center text-gray-500 text-sm">
                <p>Descrivi cosa vuoi guardare e l'AI troverà i contenuti perfetti per te.</p>
            </div>
        )}

        {/* Results List */}
        {recommendations.length > 0 && (
            <div className="p-2 space-y-2">
                {recommendations.map((rec, idx) => {
                    const details = getChannelDetails(rec.channelName);
                    return (
                        <button
                            key={idx}
                            onClick={() => onPlayChannel(rec.channelName)}
                            className="w-full group bg-gray-800/40 hover:bg-purple-600/20 rounded-xl border border-white/5 hover:border-purple-500/30 transition-all overflow-hidden flex flex-row text-left"
                        >
                            {/* Poster/Icon */}
                            <div className="w-16 h-16 bg-gray-900 shrink-0 relative flex items-center justify-center">
                                {details?.logo ? (
                                    <img src={details.logo} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" alt="" />
                                ) : (
                                    <Icon className="w-6 h-6 text-gray-600" />
                                )}
                            </div>
                            
                            {/* Text Info */}
                            <div className="p-2 flex-1 flex flex-col justify-center min-w-0">
                                <h4 className="font-semibold text-gray-100 truncate text-sm">{rec.channelName}</h4>
                                <p className="text-xs text-gray-400 leading-snug line-clamp-2">{rec.reason}</p>
                            </div>

                            {/* Play Icon */}
                            <div className="w-10 flex items-center justify-center text-purple-400 group-hover:text-white transition-colors">
                                <Play className="w-4 h-4 fill-current" />
                            </div>
                        </button>
                    );
                })}
            </div>
        )}
      </div>
    </div>
  );
};

export default AIRecommender;
