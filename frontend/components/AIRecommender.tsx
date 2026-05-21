import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, Loader2, Play, Search, X, Tv, Film, Clapperboard } from 'lucide-react';
import { getRecommendations, isAiAvailable } from '../services/geminiService.ts';
import { Channel, Recommendation, StreamType, WatchHistoryItem } from '../types.ts';
import { useFocusTrap } from '../hooks/useTvFocus.ts';
import { Chip, IconButton } from './shared';

interface AIRecommenderProps {
  channels: Channel[];
  onPlayChannel: (name: string) => void;
  activeTab: StreamType;
  history: WatchHistoryItem[];
  aiCaching?: boolean;
  geminiApiKey?: string;
  profileId?: string;
  profileLanguage?: string;
}

const AIRecommender: React.FC<AIRecommenderProps> = ({ channels, onPlayChannel, activeTab, history, aiCaching = true, geminiApiKey, profileId, profileLanguage = 'it' }) => {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const aiAvailable = isAiAvailable(geminiApiKey);

  useFocusTrap(isOpen && aiAvailable, panelRef, { onEscape: () => setIsOpen(false), initialSelector: '[data-initial-focus="true"]' });

  // Focus input when opened
  useEffect(() => {
    if (isOpen && aiAvailable && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, aiAvailable]);

  if (!aiAvailable) {
    return null;
  }

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

    const results = await getRecommendations(channels, query, activeTab, history, aiCaching, geminiApiKey, {
      language: profileLanguage,
      profileId,
    });
    setRecommendations(results);
    setLoading(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
    if (e.key === 'Escape') setIsOpen(false);
  };

  const getChannelDetails = (name: string) => channels.find(c => c.name === name);

  const Icon = activeTab === 'movie' ? Film : activeTab === 'series' ? Clapperboard : Tv;

  // Stato chiuso: pulsante "Chiedi all'AI" — usa colore accent (viola) perché feature AI/smart.
  if (!isOpen) {
    return (
      <div className="absolute bottom-6 right-6 z-40">
        <button
          onClick={() => setIsOpen(true)}
          className="tv-focus flex items-center gap-3 bg-surface-1 backdrop-blur-xl border border-DEFAULT hover:border-brand-accent/50 rounded-full pl-4 pr-5 py-3 shadow-elev-3 transition-all hover:scale-105 group"
          aria-label="Apri assistente AI"
        >
          <div className="bg-brand-accent/20 p-2 rounded-full">
            <Sparkles className="w-icon-sm h-icon-sm text-brand-accent animate-pulse" aria-hidden="true" />
          </div>
          <span className="text-sm text-content-muted group-hover:text-content-primary transition-colors">
            Chiedi all'AI...
          </span>
        </button>
      </div>
    );
  }

  return (
    <div
      ref={panelRef}
      className="absolute bottom-6 right-6 z-40 w-[420px] max-w-[95vw] bg-surface-1 backdrop-blur-xl border border-DEFAULT rounded-card shadow-elev-3 flex flex-col overflow-hidden max-h-[70vh] animate-slide-up"
      role="dialog"
      aria-modal="false"
      aria-label="Assistente AI"
    >
      {/* Header con Search integrata */}
      <div className="p-3 bg-brand-accent/10 border-b border-subtle">
        <div className="flex items-center gap-2 bg-surface-2 border border-DEFAULT focus-within:border-brand-accent focus-within:ring-2 focus-within:ring-brand-accent/30 rounded-control px-3 py-2 transition-colors">
          <Sparkles className="w-icon-md h-icon-md text-brand-accent shrink-0" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Cerca ${activeTab === 'live' ? 'canali' : activeTab === 'movie' ? 'film' : 'serie'} con AI...`}
            className="tv-focus-dense flex-1 bg-transparent text-sm text-content-primary placeholder:text-content-muted focus:outline-none min-w-0"
            data-initial-focus="true"
            aria-label="Prompt assistente AI"
          />
          {prompt ? (
            <IconButton
              icon={X}
              aria-label="Cancella testo"
              variant="ghost"
              size="sm"
              onClick={() => setPrompt('')}
            />
          ) : null}
          <button
            onClick={() => handleSearch()}
            disabled={loading || !prompt.trim()}
            className="tv-focus p-1.5 bg-brand-accent hover:bg-brand-accent-hover text-white rounded-control disabled:opacity-50 disabled:bg-surface-3 transition-colors"
            aria-label="Cerca con AI"
          >
            <Search className="w-icon-sm h-icon-sm" aria-hidden="true" />
          </button>
          <IconButton
            icon={X}
            aria-label="Chiudi assistente AI"
            variant="ghost"
            size="sm"
            onClick={() => setIsOpen(false)}
          />
        </div>

        {/* Suggerimenti rapidi inline */}
        {recommendations.length === 0 && !loading && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {getSuggestions().map(s => (
              <Chip key={s} size="sm" onClick={() => handleSearch(s)}>
                {s}
              </Chip>
            ))}
          </div>
        )}
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {/* Loading State */}
        {loading && (
          <div className="flex items-center justify-center gap-3 py-8 text-brand-accent">
            <Loader2 className="w-icon-md h-icon-md animate-spin" aria-hidden="true" />
            <span className="text-sm font-medium">Cerco...</span>
          </div>
        )}

        {/* Empty State */}
        {recommendations.length === 0 && !loading && (
          <div className="p-4 text-center text-content-muted text-sm">
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
                  className="tv-focus w-full group bg-surface-2 hover:bg-brand-accent/15 rounded-control border border-subtle hover:border-brand-accent/40 transition-all overflow-hidden flex flex-row text-left"
                >
                  {/* Poster/Icon */}
                  <div className="w-16 h-16 bg-surface-3 shrink-0 relative flex items-center justify-center">
                    {details?.logo ? (
                      <img
                        src={details.logo}
                        className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"
                        alt=""
                      />
                    ) : (
                      <Icon className="w-icon-lg h-icon-lg text-content-muted" aria-hidden="true" />
                    )}
                  </div>

                  {/* Text Info */}
                  <div className="p-2 flex-1 flex flex-col justify-center min-w-0">
                    <h4 className="font-semibold text-content-primary truncate text-sm">{rec.channelName}</h4>
                    <p className="text-xs text-content-muted leading-snug line-clamp-2">{rec.reason}</p>
                  </div>

                  {/* Play Icon */}
                  <div className="w-10 flex items-center justify-center text-brand-accent group-hover:text-white transition-colors">
                    <Play className="w-icon-sm h-icon-sm fill-current" aria-hidden="true" />
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
