import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Channel, XtreamCredentials, WatchHistoryItem } from '../types.ts';
import { getSeriesInfo } from '../services/xtream.ts';
import { MetadataService } from '../services/metadata.ts';
import { useLanguage } from '../contexts/LanguageContext.tsx';
import { ArrowLeft, Film, CheckCircle2, Calendar, Tv } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  LoadingState,
  WatchlistButton,
} from './shared';
import { useMediaImages } from '../hooks/useMediaImages.ts';
import { useMediaMetadata } from '../hooks/useMediaMetadata.ts';
import { useFocusTrap } from '../hooks/useTvFocus.ts';

interface SeriesDetailProps {
  series: Channel;
  creds: XtreamCredentials;
  onPlayEpisode: (channel: Channel, playlist?: Channel[]) => void;
  onBack: () => void;
  history: WatchHistoryItem[];
  watchlistIds: string[];
  onToggleWatchlist: (channelId: string) => void;
}

interface Episode {
  id: string;
  episode_num: string;
  title: string;
  container_extension: string;
  info: any;
  season: number;
}

const SeriesDetail: React.FC<SeriesDetailProps> = ({ series, creds, onPlayEpisode, onBack, history, watchlistIds, onToggleWatchlist }) => {
  const { language, t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [info, setInfo] = useState<any>(null);
  const [episodes, setEpisodes] = useState<Record<string, Episode[]>>({});
  const [activeSeason, setActiveSeason] = useState<string>("1");
  const [error, setError] = useState<string | null>(null);
  const [tmdbData, setTmdbData] = useState<any>(null);
  
  const containerRef = useRef<HTMLDivElement>(null);

  useFocusTrap(!loading && !error, containerRef, { onEscape: onBack, initialSelector: '[data-initial-focus="true"]' });

  // Focus helper
  const handleElementFocus = (e: React.FocusEvent<HTMLElement>) => {
      e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  useEffect(() => {
    const fetchDetails = async () => {
      if (!series.seriesId) {
        setError("Invalid Series ID");
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        const data = await getSeriesInfo(creds, series.seriesId);
        setInfo(data.info);
        setEpisodes(data.episodes || {});
        const firstSeason = Object.keys(data.episodes || {})[0];
        if (firstSeason) setActiveSeason(firstSeason);

        const fetchTmdb = async () => {
            const searchTitle = series.cleanName || series.name;
            const details = await MetadataService.getDetailsByTitle(searchTitle, 'series', series.year, language);
            if (details) {
                setTmdbData(details);
            }
        };
        fetchTmdb();

      } catch (err) {
        console.error(err);
        setError("Failed to load episodes.");
      } finally {
        setLoading(false);
      }
    };
    fetchDetails();
  }, [series, creds, language]);

  const createChannelFromEpisode = useCallback((ep: Episode): Channel => {
      let baseUrl = creds.url.trim().replace(/\/$/, '');
      if (!/^https?:\/\//i.test(baseUrl)) baseUrl = `http://${baseUrl}`;
      const ext = ep.container_extension || 'mp4';
      const url = `${baseUrl}/series/${creds.username}/${creds.password}/${ep.id}.${ext}`;
      let year = undefined;
      const releaseDate = ep.info?.releasedate || ep.info?.release_date || info?.releaseDate;
      if (releaseDate) year = releaseDate.split('-')[0];

      return {
        id: ep.id,
        name: `S${ep.season} E${ep.episode_num} - ${ep.title}`,
        url: url,
        type: 'series',
        group: series.name,
        logo: ep.info?.movie_image || info?.cover || series.logo,
        description: ep.info?.plot || info?.plot || series.description,
        rating: ep.info?.rating || info?.rating_5based || info?.rating,
        year: year,
        genre: info?.genre || series.genre,
        cast: info?.cast || series.cast,
        director: info?.director || series.director
      };
  }, [creds, info, series]);

  const handlePlay = (ep: Episode) => {
    const currentChannel = createChannelFromEpisode({...ep, season: Number(activeSeason)});
    const sortedSeasons = Object.keys(episodes).sort((a, b) => Number(a) - Number(b));
    const fullPlaylist: Channel[] = [];
    sortedSeasons.forEach(seasonKey => {
        const seasonEps = episodes[seasonKey];
        if (Array.isArray(seasonEps)) {
            seasonEps.forEach(e => {
                fullPlaylist.push(createChannelFromEpisode({ ...e, season: Number(seasonKey) }));
            });
        }
    });
    onPlayEpisode(currentChannel, fullPlaylist);
  };

  const seasons = Object.keys(episodes).sort((a, b) => Number(a) - Number(b));
  const currentEpisodes = episodes[activeSeason] || [];

  // Use shared hooks for images and metadata. Devono restare prima dei return condizionali
  // per rispettare l'ordine stabile degli hook React tra loading e schermata dettagli.
  const { backdrop, poster } = useMediaImages({
    tmdbData,
    fallbackLogo: series.logo,
    type: 'series',
    serverCover: info?.cover
  });

  const { rating, plot } = useMediaMetadata({
    tmdbData,
    channel: series,
    serverInfo: info
  });

  const seriesName = info?.name || series.name || tmdbData?.name;

  if (loading) {
    return <LoadingState message={t.loading} variant="series" />;
  }

  if (error) {
    return <ErrorState message={error} buttonText={t.back} onButtonClick={onBack} variant="series" />;
  }

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 bg-surface-0 text-content-primary overflow-y-auto z-40 outline-none safe-area-screen"
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={`Dettagli ${seriesName}`}
    >

      {/* Background */}
      <div className="absolute inset-0 z-0 h-[80vh]">
          <img src={backdrop || ''} alt="" className="w-full h-full object-cover opacity-40" />
          <div className="absolute inset-0 bg-gradient-to-t from-surface-0 via-surface-0/60 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-surface-0 via-surface-0/80 to-transparent" />
      </div>

      <div className="relative z-10 flex flex-col md:flex-row min-h-screen pt-20 px-8 md:px-16 gap-12">
          {/* Left Panel */}
          <div className="w-full md:w-1/3 flex flex-col pb-10">
              <Button
                  onClick={onBack}
                  variant="secondary"
                  size="sm"
                  leftIcon={ArrowLeft}
                  className="self-start mb-8 uppercase tracking-wider"
                  data-initial-focus="true"
              >
                  {t.back}
              </Button>

              <img src={poster || ''} className="w-2/3 md:w-3/4 rounded-card shadow-elev-3 mb-8 self-center md:self-start border border-DEFAULT" alt="Cover" />

              <h1 className="text-4xl md:text-5xl font-bold text-content-primary mb-4 leading-tight">{seriesName}</h1>

              <div className="flex flex-wrap items-center gap-2 mb-6">
                {rating && <Badge tone="success" icon={CheckCircle2}>Match {Number(rating) * 10}%</Badge>}
                {series.year && <Badge tone="neutral" icon={Calendar}>{series.year}</Badge>}
                <Badge tone="neutral" icon={Tv}>HD</Badge>
              </div>

              <div className="flex items-center gap-3 mb-8">
                  <WatchlistButton
                    isInWatchlist={watchlistIds.includes(series.id)}
                    onToggle={() => onToggleWatchlist(series.id)}
                    addText={t.addToList}
                    removeText={t.removeFromList}
                    variant="series"
                  />
              </div>

              <p className="text-lg text-content-secondary leading-relaxed font-light mb-8">{plot}</p>

              {!MetadataService.isConfigured() && (
                <Card
                  elevation="flat"
                  padding="sm"
                  className="!border-state-warning/30 !bg-state-warning/10"
                >
                  <p className="text-sm text-state-warning">
                    TMDB non configurato: metadata e immagini arricchite possono essere limitati ai dati del provider IPTV.
                  </p>
                </Card>
              )}
          </div>

          {/* Right Panel */}
          <div className="flex-1 pb-20">
              <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
                  <h3 className="text-2xl font-bold text-content-primary">{t.episodes}</h3>

                  {/* Seasons */}
                  <div className="flex gap-2 overflow-x-auto pb-2 max-w-full no-scrollbar">
                    {seasons.map(season => (
                      <Chip
                        key={season}
                        selected={activeSeason === season}
                        onClick={() => setActiveSeason(season)}
                        onFocus={handleElementFocus}
                      >
                        Season {season}
                      </Chip>
                    ))}
                  </div>
              </div>

              {/* Episodes */}
              <div className="flex flex-col gap-4">
                {currentEpisodes.length === 0 ? (
                  <EmptyState
                    icon={Film}
                    title="Nessun episodio disponibile"
                    description="Il server non ha restituito episodi per questa stagione. Prova un'altra stagione o torna al catalogo."
                    actions={[{ label: t.back, onClick: onBack }]}
                    className="min-h-[45vh]"
                  />
                ) : currentEpisodes.map((ep, idx) => {
                  const historyItem = history.find(h => h.channelId === ep.id);
                  const progress = historyItem?.progress || 0;

                  return (
                    <button
                        key={ep.id}
                        onClick={() => handlePlay({...ep, season: Number(activeSeason)})}
                        onFocus={handleElementFocus}
                        className="tv-focus-dense group flex items-center gap-6 p-4 rounded-control hover:bg-surface-2 transition-colors text-left border-b border-subtle hover:border-transparent relative overflow-hidden"
                    >
                        <span className="text-2xl font-light text-content-muted w-8 text-center">{idx + 1}</span>
                        <div className="relative w-32 aspect-video bg-surface-2 rounded-control overflow-hidden shrink-0">
                            {ep.info?.movie_image ? (
                                <img src={ep.info.movie_image} className="w-full h-full object-cover" alt="" />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-content-disabled">
                                    <Film className="w-icon-xl h-icon-xl" />
                                </div>
                            )}

                            {/* Progress Bar */}
                            {progress > 0 && (
                                <div className="absolute bottom-0 left-0 right-0 h-1 bg-surface-3">
                                    <div
                                        className="h-full bg-brand-primary shadow-glow-brand"
                                        style={{ width: `${Math.min(progress * 100, 100)}%` }}
                                    />
                                </div>
                            )}
                        </div>
                        <div className="flex-1 min-w-0">
                            <h4 className="font-bold text-content-primary text-base truncate pr-4">{ep.title}</h4>
                            <p className="text-xs text-content-muted line-clamp-2">{ep.info?.plot}</p>
                        </div>
                    </button>
                  );
                })}
              </div>
          </div>
      </div>
    </div>
  );
};

export default SeriesDetail;