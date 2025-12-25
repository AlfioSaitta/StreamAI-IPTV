import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Channel, WatchHistoryItem } from '../types.ts';
import { MetadataService } from '../services/metadata.ts';
import { useLanguage } from '../contexts/LanguageContext.tsx';
import { Play, X, ThumbsUp, Sparkles } from 'lucide-react';
import LoadingState from './shared/LoadingState.tsx';
import ErrorState from './shared/ErrorState.tsx';
import WatchlistButton from './shared/WatchlistButton.tsx';
import { useMediaImages } from '../hooks/useMediaImages.ts';
import { useMediaMetadata } from '../hooks/useMediaMetadata.ts';
import { getMovieEnrichment, MovieEnrichment, isAiAvailable } from '../services/geminiService.ts';

interface MovieDetailProps {
  movie: Channel;
  onClose: () => void;
  onPlay: (channel: Channel, options?: { resetProgress?: boolean }) => void;
  watchlistIds: string[];
  onToggleWatchlist: (channelId: string) => void;
  allChannels: Channel[];
  onShowDetails?: (channel: Channel) => void;
  history: WatchHistoryItem[];
}

const MovieDetail: React.FC<MovieDetailProps> = ({ movie, onClose, onPlay, watchlistIds, onToggleWatchlist, allChannels, onShowDetails, history }) => {
  const { language, t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [tmdbData, setTmdbData] = useState<any>(null);
  const [aiData, setAiData] = useState<MovieEnrichment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [liked, setLiked] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);

  // 1. Fetch TMDB Data (Fast & Essential)
  useEffect(() => {
    const fetchDetails = async () => {
      try {
        setLoading(true);
        setError(null);
        setTmdbData(null);

        if (movie.tmdbId) {
          const details = await MetadataService.getDetails(movie.tmdbId, 'movie', language);
          setTmdbData(details);
        } else {
          const searchTitle = movie.cleanName || movie.name;
          const details = await MetadataService.getDetailsByTitle(searchTitle, 'movie', movie.year, language);
          setTmdbData(details);
        }
      } catch (err) {
        console.error(err);
        setError(t.loading);
      } finally {
        setLoading(false);
      }
    };

    fetchDetails();
  }, [movie, language, t]);

  // Use shared hooks for images and metadata
  const { backdrop, poster } = useMediaImages({ 
    tmdbData, 
    fallbackLogo: movie.logo, 
    type: 'movie' 
  });

  const { cast, director, genre, rating, plot } = useMediaMetadata({ 
    tmdbData, 
    channel: movie 
  });

  // 2. Fetch AI Enrichment (Background & Optional)
  useEffect(() => {
    const fetchAiData = async () => {
      if (!movie || !isAiAvailable()) return;
      
      try {
        setAiLoading(true);
        setAiData(null);
        const movieTitle = movie.cleanName || movie.name;
        
        // Non-blocking call
        const enrichment = await getMovieEnrichment(movieTitle);
        setAiData(enrichment);
      } catch (e) {
        console.warn("AI Enrichment failed silently:", e);
      } finally {
        setAiLoading(false);
      }
    };

    // Start AI fetch only after initial render to prioritize UI
    const timer = setTimeout(fetchAiData, 100);
    return () => clearTimeout(timer);
  }, [movie]);

  const year = movie.year || tmdbData?.release_date?.split('-')[0];

  const findMatchingChannel = useCallback((title: string) => {
    if (!title) return null;
    const cleaned = MetadataService.cleanTitle(title).toLowerCase();

    return (
      allChannels.find(ch => MetadataService.cleanTitle(ch.cleanName || ch.name).toLowerCase() === cleaned && ch.type === 'movie') ||
      allChannels.find(ch => MetadataService.cleanTitle(ch.cleanName || ch.name).toLowerCase().includes(cleaned) && ch.type === 'movie') ||
      null
    );
  }, [allChannels]);

  const isVod = movie.type === 'movie' || movie.type === 'series';

  // Similar content (TMDB, solo con match locale, robusto)
  const similarContent = useMemo(() => {
    if (!tmdbData || !isVod) return [];
    const sim = MetadataService.getSimilar(tmdbData, movie.type === 'series' ? 'series' : 'movie');
    // Mostra solo i suggerimenti che hanno un canale locale corrispondente e id diverso dal corrente
    return sim.map(item => {
      const match = allChannels.find(ch => {
        if (ch.id === movie.id) return false;
        const t1 = MetadataService.cleanTitle(ch.cleanName || ch.name).toLowerCase();
        const t2 = MetadataService.cleanTitle(item.title).toLowerCase();
        return t1 === t2 || t1.includes(t2) || t2.includes(t1);
      });
      return match ? { ...item, channel: match } : null;
    }).filter(Boolean);
  }, [tmdbData, allChannels, movie.id, movie.type, isVod]);

  const aiSimilarChannels = useMemo(() => {
    if (!aiData?.similarMovies) return [];
    const matches: Channel[] = [];
    aiData.similarMovies.forEach(title => {
      const match = findMatchingChannel(title);
      if (match && !matches.find(m => m.id === match.id)) {
        matches.push(match);
      }
    });
    return matches.slice(0, 5);
  }, [aiData, findMatchingChannel]);

  const historyItem = useMemo(() => history.find(h => h.channelId === movie.id), [history, movie.id]);
  const progress = historyItem?.progress || 0;
  const hasProgress = progress > 0.01;

  if (loading) {
    return <LoadingState message={t.loading} variant="movie" />;
  }

  if (error) {
    return <ErrorState message={error} buttonText={t.close} onButtonClick={onClose} variant="movie" />;
  }

  return (
    <div className="fixed inset-0 z-[90] text-white overflow-y-auto bg-[#0b0b0bcc] backdrop-blur-md">
      {/* Background */}
      {backdrop && (
        <div className="absolute inset-0 opacity-50">
          <img src={backdrop} alt="backdrop" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0b0b0b] via-[#0b0b0b]/60 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#0b0b0b] via-[#0b0b0b]/60 to-transparent" />
        </div>
      )}

      <div className="relative z-10 min-h-screen px-6 md:px-16 pt-14 pb-20">
        <div className="flex justify-end mb-6">
          <button onClick={onClose} className="tv-focus w-10 h-10 rounded-full bg-black/50 border border-white/10 flex items-center justify-center hover:bg-white/10" aria-label="Chiudi modale">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex flex-col lg:flex-row gap-10">
          {/* Poster */}
          <div className="w-full lg:w-1/3 max-w-sm mx-auto lg:mx-0">
            {poster ? (
              <img src={poster} alt={movie.name} className="w-full rounded-2xl shadow-2xl border border-white/10" />
            ) : (
              <div className="w-full h-[450px] bg-white/5 rounded-2xl border border-white/10" />
            )}
          </div>

          {/* Details */}
          <div className="flex-1 space-y-6">
            <div className="space-y-3">
              <p className="text-sm uppercase tracking-[0.3em] text-gray-400">{t.movies}</p>
              <h1 className="text-4xl md:text-5xl font-extrabold leading-tight drop-shadow-lg">
                {movie.cleanName || movie.name || tmdbData?.title}
              </h1>
              <div className="flex flex-wrap items-center gap-3 text-gray-300 text-sm font-medium">
                {rating && <span className="bg-green-600/90 text-white px-2 py-1 rounded-full text-xs font-bold">Match {Math.min(100, Math.round(Number(rating) * 10))}%</span>}
                {year && <span className="text-white/90 font-semibold">{year}</span>}
                <span className="border border-white/20 px-2 py-0.5 rounded text-[11px]">HD</span>
                {genre && <span className="text-gray-300">{genre}</span>}
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => { onPlay(movie, hasProgress ? { resetProgress: true } : undefined); onClose(); }}
                className="tv-focus flex items-center gap-3 bg-white text-black px-6 py-3 rounded-lg font-bold text-lg shadow-lg hover:bg-gray-200"
              >
                <Play className="w-5 h-5 fill-black" /> {hasProgress ? t.watchNow : t.play}
              </button>

              {hasProgress && (
                <button
                  onClick={() => { onPlay(movie); onClose(); }}
                  className="tv-focus flex items-center gap-3 bg-red-600 text-white px-6 py-3 rounded-lg font-bold text-lg shadow-lg hover:bg-red-500"
                >
                  <Play className="w-5 h-5 fill-white" /> {t.resume}
                </button>
              )}

              <WatchlistButton
                isInWatchlist={watchlistIds.includes(movie.id)}
                onToggle={() => onToggleWatchlist(movie.id)}
                addText={t.addToList}
                removeText={t.removeFromList}
                variant="movie"
              />

              <button
                onClick={() => setLiked(prev => !prev)}
                className={`tv-focus flex items-center gap-2 px-5 py-3 rounded-lg border ${liked ? 'bg-red-600 border-red-500' : 'bg-white/5 border-white/10 hover:bg-white/15'} transition-colors`}
              >
                <ThumbsUp className="w-5 h-5" />
                <span className="text-sm font-semibold">{liked ? '✓' : '👍'}</span>
              </button>
            </div>

            <p className="text-lg text-gray-200 leading-relaxed max-w-3xl">{plot}</p>

            {/* AI Fun Fact */}
            {aiData?.funFact ? (
              <div className="p-4 bg-blue-900/30 border border-blue-500/30 rounded-lg flex items-start gap-3 animate-in fade-in slide-in-from-bottom-2">
                <Sparkles className="w-5 h-5 text-blue-400 flex-shrink-0 mt-1" />
                <p className="text-sm text-blue-200"><strong className="text-blue-300">AI Fun Fact:</strong> {aiData.funFact}</p>
              </div>
            ) : aiLoading ? (
              <div className="h-16 bg-white/5 rounded-lg animate-pulse" />
            ) : null}

            {hasProgress && (
              <p className="text-sm text-gray-400">{Math.round(progress * 100)}%</p>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-300">
              {cast && <div><span className="text-gray-400">{t.castActors}: </span>{cast}</div>}
              {director && <div><span className="text-gray-400">{t.director}: </span>{director}</div>}
              {movie.group && <div><span className="text-gray-400">{t.genre}: </span>{movie.group}</div>}
              {movie.url && <div className="text-gray-500">Stream ID: {movie.id}</div>}
            </div>
          </div>
        </div>

        {/* AI Similar Movies */}
        {aiSimilarChannels.length > 0 && (
          <div className="mt-12 animate-in fade-in slide-in-from-bottom-4">
            <h3 className="text-2xl font-bold mb-4 flex items-center gap-2"><Sparkles className="w-6 h-6 text-purple-400" /> Consigliati dall'AI</h3>
            <div className="flex gap-4 overflow-x-auto no-scrollbar pb-4">
              {aiSimilarChannels.map(ch => (
                <button
                  key={ch.id}
                  onClick={() => onShowDetails ? onShowDetails(ch) : onPlay(ch)}
                  className="tv-focus flex-none w-[180px] md:w-[200px] rounded-lg overflow-hidden bg-white/5 border border-white/10 hover:border-white/30 shadow-lg text-left"
                >
                  {ch.logo ? (
                    <img src={ch.logo} alt={ch.name} className="w-full h-48 object-cover" />
                  ) : (
                    <div className="w-full h-48 flex items-center justify-center text-gray-500 text-sm">{ch.cleanName || ch.name}</div>
                  )}
                  <div className="p-3">
                    <p className="text-sm font-semibold line-clamp-2">{ch.cleanName || ch.name}</p>
                    {ch.year && <p className="text-xs text-gray-400 mt-1">{ch.year}</p>}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* TMDB Similar Movies/Series: solo se VOD */}
        {isVod && similarContent.length > 0 && (
          <div className="mt-12">
            <h3 className="text-2xl font-bold mb-4">{t.similarContent}</h3>
            <div className="flex gap-4 overflow-x-auto no-scrollbar pb-4">
              {similarContent.map(sim => (
                <button
                  key={sim.id}
                  onClick={() => sim.channel && onShowDetails && onShowDetails(sim.channel)}
                  className={`tv-focus flex-none w-[180px] md:w-[200px] rounded-lg overflow-hidden bg-white/5 border border-white/10 hover:border-white/30 shadow-lg text-left ${!sim.channel ? 'opacity-60 cursor-not-allowed' : ''}`}
                  disabled={!sim.channel}
                >
                  {sim.poster ? (
                    <img src={sim.poster} alt={sim.title} className="w-full h-48 object-cover" />
                  ) : (
                    <div className="w-full h-48 flex items-center justify-center text-gray-500 text-sm">{sim.title}</div>
                  )}
                  <div className="p-3">
                    <p className="text-sm font-semibold line-clamp-2">{sim.title}</p>
                    {sim.channel?.year && <p className="text-xs text-gray-400 mt-1">{sim.channel.year}</p>}
                    {sim.overview && <p className="text-xs text-gray-400 mt-1 line-clamp-3">{sim.overview}</p>}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default MovieDetail;

