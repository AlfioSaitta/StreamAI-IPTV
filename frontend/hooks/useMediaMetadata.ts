import { useMemo } from 'react';
import { Channel } from '../types';

interface UseMediaMetadataProps {
  tmdbData: any;
  channel: Channel;
  serverInfo?: any;
}

interface MediaMetadata {
  cast: string;
  director: string | null;
  genre: string | null;
  rating: string | null;
  plot: string;
}

export const useMediaMetadata = ({ 
  tmdbData, 
  channel,
  serverInfo 
}: UseMediaMetadataProps): MediaMetadata => {
  const cast = useMemo(() => {
    // First use server data
    if (channel.cast) return channel.cast;
    if (serverInfo?.cast) return serverInfo.cast;
    // Fallback to TMDB
    const castList = tmdbData?.credits?.cast?.slice(0, 6).map((c: any) => c.name) || [];
    return castList.join(', ');
  }, [tmdbData, channel.cast, serverInfo]);

  const director = useMemo(() => {
    // First use server data
    if (channel.director) return channel.director;
    if (serverInfo?.director) return serverInfo.director;
    // Fallback to TMDB
    const crew = tmdbData?.credits?.crew || [];
    const dir = crew.find((c: any) => c.job === 'Director');
    return dir?.name || null;
  }, [tmdbData, channel.director, serverInfo]);

  const genre = useMemo(() => {
    // First use server data
    if (channel.genre) return channel.genre;
    if (serverInfo?.genre) return serverInfo.genre;
    // Fallback to TMDB
    if (tmdbData?.genres?.length) return tmdbData.genres.map((g: any) => g.name).join(' • ');
    return null;
  }, [tmdbData, channel.genre, serverInfo]);

  const rating = useMemo(() => {
    // First use server data
    if (channel.rating) return channel.rating;
    if (serverInfo?.rating || serverInfo?.rating_5based) {
      return serverInfo.rating || serverInfo.rating_5based;
    }
    // Fallback to TMDB
    if (tmdbData?.vote_average) return Number(tmdbData.vote_average).toFixed(1);
    return null;
  }, [tmdbData, channel.rating, serverInfo]);

  const plot = useMemo(() => {
    return channel.description || serverInfo?.plot || tmdbData?.overview || '';
  }, [channel.description, serverInfo, tmdbData]);

  return { cast, director, genre, rating, plot };
};
