import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Channel, WatchHistoryItem } from '../types.ts';
import { MetadataService } from '../services/metadata.ts';
import { useLanguage } from '../contexts/LanguageContext.tsx';
import { Play, X, ThumbsUp, Sparkles } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  IconButton,
  LoadingState,
  WatchlistButton,
} from './shared';
import { useMediaImages } from '../hooks/useMediaImages.ts';
import { useMediaMetadata } from '../hooks/useMediaMetadata.ts';
import { getMovieEnrichment, MovieEnrichment, isAiAvailable } from '../services/geminiService.ts';
import { useFocusTrap } from '../hooks/useTvFocus.ts';

interface MovieDetailProps {
  movie: Channel;
  onClose: () => void;
  onPlay: (channel: Channel, options?: { resetProgress?: boolean }) => void;
  watchlistIds: string[];
  onToggleWatchlist: (channelId: string) => void;
  allChannels: Channel[];
  onShowDetails?: (channel: Channel) => void;
  history: WatchHistoryItem[];
  geminiApiKey?: string;
}

const MovieDetail: React.FC<MovieDetailProps> = ({ movie, onClose, onPlay, watchlistIds, onToggleWatchlist, allChannels, onShowDetails, history, geminiApiKey }) => {
  const { language, t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [tmdbData, setTmdbData] = useState<any>(null);
  const [aiData, setAiData] = useState<MovieEnrichment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [liked, setLiked] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  useFocusTrap(!loading && !error, modalRef, { onEscape: onClose, initialSelector: '[data-initial-focus="true"]' });

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
      if (!movie || !isAiAvailable(geminiApiKey)) return;

      try {
        setAiLoading(true);
        setAiData(null);
        const movieTitle = movie.cleanName || movie.name;
        
        // Non-blocking call
        const enrichment = await getMovieEnrichment(movieTitle, true, geminiApiKey);
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
  }, [movie, geminiApiKey]);

  const year = movie.year || tmdbData?.release_date?.split('-')[0];

  const findMatchingChannel = useCallback((title: string) => {
    if (!title) return null;

    return (
      allChannels.find(ch => ch.type === 'movie' && MetadataService.isTitleMatch(ch.cleanName || ch.name, title, movie.year, ch.year)) ||
      null
    );
  }, [allChannels, movie.year]);

  const isVod = movie.type === 'movie' || movie.type === 'series';

  // Similar content (TMDB, solo con match locale, robusto)
  const similarContent = useMemo(() => {
    if (!tmdbData || !isVod) return [];
    const sim = MetadataService.getSimilar(tmdbData, movie.type === 'series' ? 'series' : 'movie');
    // Mostra solo i suggerimenti che hanno un canale locale corrispondente e id diverso dal corrente
    return sim.map(item => {
      const match = allChannels.find(ch => {
        if (ch.id === movie.id) return false;
        return MetadataService.isTitleMatch(ch.cleanName || ch.name, item.title, movie.year, ch.year);
      });
      return match ? { ...item, channel: match } : null;
    }).filter((item): item is NonNullable<typeof item> => item !== null);
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
    <div
      ref={modalRef}
      className="fixed inset-0 z-[90] text-content-primary overflow-y-auto bg-surface-overlay-hard backdrop-blur-md safe-area-screen"
      role="dialog"
      aria-modal="true"
      aria-label={`Dettagli ${movie.cleanName || movie.name}`}
    >
      {/* Background */}
      {backdrop && (
        <div className="absolute inset-0 opacity-50">
          <img src={backdrop} alt="backdrop" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-surface-0 via-surface-0/60 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-surface-0 via-surface-0/60 to-transparent" />
        </div>
      )}

      <div className="relative z-10 min-h-screen px-6 md:px-16 pt-14 pb-20">
        <div className="flex justify-end mb-6">
          <IconButton
            icon={X}
            aria-label="Chiudi modale"
            variant="secondary"
            size="md"
            onClick={onClose}
            className="!rounded-full"
          />
        </div>

        <div className="flex flex-col lg:flex-row gap-10">
          {/* Poster */}
          <div className="w-full lg:w-1/3 max-w-sm mx-auto lg:mx-0">
            {poster ? (
              <img
                src={poster}
                alt={movie.name}
                className="w-full rounded-card shadow-elev-3 border border-DEFAULT"
              />
            ) : (
              <div className="w-full h-[450px] bg-surface-1 rounded-card border border-DEFAULT" />
            )}
          </div>

          {/* Details */}
          <div className="flex-1 space-y-6">
            <div className="space-y-3">
              <p className="text-xs uppercase tracking-widest text-content-muted font-semibold">{t.movies}</p>
              <h1 className="text-4xl md:text-5xl font-extrabold leading-tight drop-shadow-lg">
                {movie.cleanName || movie.name || tmdbData?.title}
              </h1>
              <div className="flex flex-wrap items-center gap-2 text-content-secondary text-sm font-medium">
                {rating && (
                  <Badge tone="success">
                    Match {Math.min(100, Math.round(Number(rating) * 10))}%
                  </Badge>
                )}
                {year && <Badge tone="neutral">{year}</Badge>}
                <Badge tone="neutral">HD</Badge>
                {genre && <span className="text-content-secondary ml-1">{genre}</span>}
              </div>
              {!MetadataService.isConfigured() && (
                <Card
                  elevation="flat"
                  padding="sm"
                  className="!border-state-warning/30 !bg-state-warning/10"
                >
                  <p className="text-sm text-state-warning">
                    TMDB non configurato: poster, trama e suggerimenti arricchiti possono usare solo i dati del provider IPTV. Imposta{' '}
                    <code className="text-state-warning font-mono">VITE_TMDB_API_KEY</code> per abilitarli.
                  </p>
                </Card>
              )}
            </div>

            <div className="flex flex-wrap gap-3">
              <Button
                onClick={() => {
                  onPlay(movie, hasProgress ? { resetProgress: true } : undefined);
                  onClose();
                }}
                leftIcon={Play}
                variant="primary"
                size="lg"
                data-initial-focus="true"
              >
                {hasProgress ? t.watchNow : t.play}
              </Button>

              {hasProgress && (
                <Button
                  onClick={() => {
                    onPlay(movie);
                    onClose();
                  }}
                  leftIcon={Play}
                  variant="primary"
                  size="lg"
                >
                  {t.resume}
                </Button>
              )}

              <WatchlistButton
                isInWatchlist={watchlistIds.includes(movie.id)}
                onToggle={() => onToggleWatchlist(movie.id)}
                addText={t.addToList}
                removeText={t.removeFromList}
                variant="movie"
              />

              <Button
                onClick={() => setLiked((prev) => !prev)}
                leftIcon={ThumbsUp}
                variant={liked ? 'primary' : 'secondary'}
                size="lg"
                aria-pressed={liked}
                aria-label={liked ? 'Rimuovi mi piace' : 'Aggiungi mi piace'}
              >
                {liked ? '✓' : '👍'}
              </Button>
            </div>

            <p className="text-lg text-content-secondary leading-relaxed max-w-3xl">{plot}</p>

            {/* AI Fun Fact */}
            {aiData?.funFact ? (
              <Card
                elevation="flat"
                padding="sm"
                className="!border-state-info/30 !bg-state-info/10 animate-fade-in"
              >
                <div className="flex items-start gap-3">
                  <Sparkles
                    className="w-icon-md h-icon-md text-state-info shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <p className="text-sm text-state-info">
                    <strong className="text-state-info">AI Fun Fact:</strong> {aiData.funFact}
                  </p>
                </div>
              </Card>
            ) : aiLoading ? (
              <div className="h-16 bg-surface-1 rounded-card animate-pulse" />
            ) : null}

            {hasProgress && (
              <p className="text-sm text-content-muted">{Math.round(progress * 100)}%</p>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-content-secondary">
              {cast && (
                <div>
                  <span className="text-content-muted">{t.castActors}: </span>
                  {cast}
                </div>
              )}
              {director && (
                <div>
                  <span className="text-content-muted">{t.director}: </span>
                  {director}
                </div>
              )}
              {movie.group && (
                <div>
                  <span className="text-content-muted">{t.genre}: </span>
                  {movie.group}
                </div>
              )}
              {movie.url && <div className="text-content-disabled">Stream ID: {movie.id}</div>}
            </div>
          </div>
        </div>

        {/* AI Similar Movies */}
        {aiSimilarChannels.length > 0 && (
          <div className="mt-12 animate-fade-in">
            <h3 className="text-2xl font-bold mb-4 flex items-center gap-2">
              <Sparkles className="w-icon-lg h-icon-lg text-brand-accent" aria-hidden="true" /> Consigliati dall'AI
            </h3>
            <div className="flex gap-4 overflow-x-auto no-scrollbar pb-4">
              {aiSimilarChannels.map(ch => (
                <button
                  key={ch.id}
                  onClick={() => onShowDetails ? onShowDetails(ch) : onPlay(ch)}
                  className="tv-focus flex-none w-[180px] md:w-[200px] rounded-card overflow-hidden bg-surface-1 border border-DEFAULT hover:border-strong shadow-elev-2 text-left"
                >
                  {ch.logo ? (
                    <img src={ch.logo} alt={ch.name} className="w-full h-48 object-cover" />
                  ) : (
                    <div className="w-full h-48 flex items-center justify-center text-content-muted text-sm">{ch.cleanName || ch.name}</div>
                  )}
                  <div className="p-3">
                    <p className="text-sm font-semibold line-clamp-2">{ch.cleanName || ch.name}</p>
                    {ch.year && <p className="text-xs text-content-muted mt-1">{ch.year}</p>}
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
                  className={`tv-focus flex-none w-[180px] md:w-[200px] rounded-card overflow-hidden bg-surface-1 border border-DEFAULT hover:border-strong shadow-elev-2 text-left ${!sim.channel ? 'opacity-60 cursor-not-allowed' : ''}`}
                  disabled={!sim.channel}
                >
                  {sim.poster ? (
                    <img src={sim.poster} alt={sim.title} className="w-full h-48 object-cover" />
                  ) : (
                    <div className="w-full h-48 flex items-center justify-center text-content-muted text-sm">{sim.title}</div>
                  )}
                  <div className="p-3">
                    <p className="text-sm font-semibold line-clamp-2">{sim.title}</p>
                    {sim.channel?.year && <p className="text-xs text-content-muted mt-1">{sim.channel.year}</p>}
                    {sim.overview && <p className="text-xs text-content-muted mt-1 line-clamp-3">{sim.overview}</p>}
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

