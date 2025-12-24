import { useMemo } from 'react';
import { MetadataService } from '../services/metadata';

interface UseMediaImagesProps {
  tmdbData: any;
  fallbackLogo?: string;
  type: 'movie' | 'series';
  serverCover?: string;
}

interface MediaImages {
  backdrop: string | null;
  poster: string | null;
}

/**
 * Custom hook for resolving media images (backdrop and poster).
 * 
 * The fallback order differs between movies and series due to data source priorities:
 * - Movies: Prefer logo from IPTV server (often higher quality) → TMDB backdrop → TMDB images
 * - Series: Prefer TMDB backdrop (more consistent) → server cover → logo fallback
 * 
 * This difference reflects the typical data quality patterns in IPTV servers where
 * movie logos are often well-maintained, while series benefit from TMDB's standardized data.
 */
export const useMediaImages = ({ 
  tmdbData, 
  fallbackLogo, 
  type,
  serverCover 
}: UseMediaImagesProps): MediaImages => {
  const backdrop = useMemo(() => {
    // Define fallback priority arrays for clarity
    const movieBackdropFallbacks = [
      fallbackLogo,
      MetadataService.getImageUrl(tmdbData?.backdrop_path, 'original'),
      tmdbData?.images?.backdrops?.[0]?.file_path && MetadataService.getImageUrl(tmdbData.images.backdrops[0].file_path, 'original')
    ];
    
    const seriesBackdropFallbacks = [
      MetadataService.getImageUrl(tmdbData?.backdrop_path, 'original'),
      serverCover,
      fallbackLogo
    ];
    
    const fallbacks = type === 'movie' ? movieBackdropFallbacks : seriesBackdropFallbacks;
    return fallbacks.find(img => img) || null;
  }, [tmdbData, fallbackLogo, type, serverCover]);

  const poster = useMemo(() => {
    // Define fallback priority arrays for clarity
    const moviePosterFallbacks = [
      fallbackLogo,
      MetadataService.getImageUrl(tmdbData?.poster_path),
      tmdbData?.images?.posters?.[0]?.file_path && MetadataService.getImageUrl(tmdbData.images.posters[0].file_path)
    ];
    
    const seriesPosterFallbacks = [
      serverCover,
      MetadataService.getImageUrl(tmdbData?.poster_path),
      fallbackLogo
    ];
    
    const fallbacks = type === 'movie' ? moviePosterFallbacks : seriesPosterFallbacks;
    return fallbacks.find(img => img) || null;
  }, [tmdbData, fallbackLogo, type, serverCover]);

  return { backdrop, poster };
};
