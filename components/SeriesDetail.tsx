
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Channel, XtreamCredentials, WatchHistoryItem } from '../types.ts';
import { getSeriesInfo } from '../services/xtream.ts';
import { MetadataService } from '../services/metadata.ts';
import { useLanguage } from '../contexts/LanguageContext.tsx';
import { Play, ArrowLeft, Loader2, Film, BookmarkPlus, BookmarkCheck } from 'lucide-react';

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

  // Focus helper
  const handleElementFocus = (e: React.FocusEvent<HTMLElement>) => {
      e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  useEffect(() => {
    // Auto-focus container to capture keys immediately if needed
    containerRef.current?.focus();
    
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
            let result = null;
            if (series.cleanName) result = await MetadataService.searchTMDB(series.cleanName, 'series', series.year, language);
            if (!result && series.name) result = await MetadataService.searchTMDB(series.name, 'series', series.year, language);
            if (result && result.id) {
                const fullDetails = await MetadataService.getDetails(result.id, 'series', language);
                setTmdbData(fullDetails);
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

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#141414] text-white h-full z-50 fixed inset-0">
        <Loader2 className="w-16 h-16 animate-spin text-red-600 mb-6" />
        <p className="text-2xl text-gray-400">{t.loading}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#141414] text-white h-full z-50 fixed inset-0">
        <p className="text-3xl text-red-400 mb-8">{error}</p>
        <button onClick={onBack} className="tv-focus text-xl bg-gray-800 px-8 py-4 rounded-lg">{t.back}</button>
      </div>
    );
  }

  const seasons = Object.keys(episodes).sort((a, b) => Number(a) - Number(b));
  const currentEpisodes = episodes[activeSeason] || [];
  const isInWatchlist = watchlistIds.includes(series.id);

  const backdrop = MetadataService.getImageUrl(tmdbData?.backdrop_path, 'original') || info?.backdrop_path?.[0] || info?.cover || series.logo;
  const poster = MetadataService.getImageUrl(tmdbData?.poster_path) || info?.cover || series.logo;
  const plot = tmdbData?.overview || info?.plot || series.description;
  const rating = tmdbData?.vote_average ? String(tmdbData.vote_average).substring(0,3) : (info?.rating || info?.rating_5based);

  return (
    <div ref={containerRef} className="fixed inset-0 bg-[#141414] text-white overflow-y-auto z-40 outline-none" tabIndex={-1}>
      
      {/* Background */}
      <div className="absolute inset-0 z-0 h-[80vh]">
          <img src={backdrop} alt="" className="w-full h-full object-cover opacity-40" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#141414] via-[#141414]/60 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#141414] via-[#141414]/80 to-transparent" />
      </div>

      <div className="relative z-10 flex flex-col md:flex-row min-h-screen pt-20 px-8 md:px-16 gap-12">
          {/* Left Panel */}
          <div className="w-full md:w-1/3 flex flex-col pb-10">
              <button 
                  onClick={onBack} 
                  className="tv-focus self-start flex items-center gap-2 text-gray-300 hover:text-white mb-8 px-3 py-1.5 rounded transition-colors text-sm font-semibold uppercase tracking-wider border border-white/20 hover:bg-white/10"
              >
                  <ArrowLeft className="w-4 h-4" /> {t.back}
              </button>
              
              <img src={poster} className="w-2/3 md:w-3/4 rounded-md shadow-2xl mb-8 self-center md:self-start" alt="Cover" />

              <h1 className="text-4xl md:text-5xl font-bold text-white mb-4 leading-tight">{tmdbData?.name || info?.name || series.name}</h1>
              
              <div className="flex flex-wrap items-center gap-4 text-base text-gray-300 mb-6 font-medium">
                {rating && <span className="text-green-400 font-bold">Match {Number(rating) * 10}%</span>}
                {series.year && <span>{series.year}</span>}
                <span className="border border-gray-600 px-1 text-xs">HD</span>
              </div>

              <div className="flex items-center gap-3 mb-8">
                  <button
                    onClick={() => onToggleWatchlist(series.id)}
                    className="tv-focus flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg border border-white/10 transition-colors"
                  >
                      {isInWatchlist ? <BookmarkCheck className="w-4 h-4" /> : <BookmarkPlus className="w-4 h-4" />}
                      <span className="text-sm font-semibold">{isInWatchlist ? t.removeFromList : t.addToList}</span>
                  </button>
              </div>

              <p className="text-lg text-gray-300 leading-relaxed font-light mb-8">{plot}</p>
          </div>

          {/* Right Panel */}
          <div className="flex-1 pb-20">
              <div className="flex items-center justify-between mb-6">
                  <h3 className="text-2xl font-bold text-white">{t.episodes}</h3>

                  {/* Seasons */}
                  <div className="flex gap-2 overflow-x-auto pb-2 max-w-full no-scrollbar">
                    {seasons.map(season => (
                      <button
                        key={season}
                        onClick={() => setActiveSeason(season)}
                        onFocus={handleElementFocus}
                        className={`tv-focus px-4 py-2 text-lg font-bold transition-all border-b-4 whitespace-nowrap ${activeSeason === season ? 'border-red-600 text-white' : 'border-transparent text-gray-500 hover:text-gray-300'}`}
                      >
                        Season {season}
                      </button>
                    ))}
                  </div>
              </div>

              {/* Episodes */}
              <div className="flex flex-col gap-4">
                {currentEpisodes.map((ep, idx) => {
                  const historyItem = history.find(h => h.channelId === ep.id);
                  const progress = historyItem?.progress || 0;
                  
                  return (
                    <button
                        key={ep.id}
                        onClick={() => handlePlay({...ep, season: Number(activeSeason)})}
                        onFocus={handleElementFocus}
                        className="tv-focus group flex items-center gap-6 p-4 rounded hover:bg-[#333] transition-colors text-left border-b border-gray-800 hover:border-transparent relative overflow-hidden"
                    >
                        <span className="text-2xl font-light text-gray-500 w-8 text-center">{idx + 1}</span>
                        <div className="relative w-32 aspect-video bg-gray-800 rounded overflow-hidden shrink-0">
                            {ep.info?.movie_image ? (
                                <img src={ep.info.movie_image} className="w-full h-full object-cover" alt="" />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-gray-700"><Film className="w-8 h-8" /></div>
                            )}
                            
                            {/* Progress Bar */}
                            {progress > 0 && (
                                <div className="absolute bottom-0 left-0 right-0 h-1 bg-gray-700/50">
                                    <div 
                                        className="h-full bg-red-600 shadow-[0_0_4px_rgba(220,38,38,0.8)]" 
                                        style={{ width: `${Math.min(progress * 100, 100)}%` }} 
                                    />
                                </div>
                            )}
                        </div>
                        <div className="flex-1 min-w-0">
                            <h4 className="font-bold text-white text-base truncate pr-4">{ep.title}</h4>
                            <p className="text-xs text-gray-400 line-clamp-2">{ep.info?.plot}</p>
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
