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
    if (type === 'movie') {
      return (
        fallbackLogo ||
        MetadataService.getImageUrl(tmdbData?.backdrop_path, 'original') ||
        (tmdbData?.images?.backdrops?.[0]?.file_path && MetadataService.getImageUrl(tmdbData.images.backdrops[0].file_path, 'original')) ||
        null
      );
    } else {
      return (
        MetadataService.getImageUrl(tmdbData?.backdrop_path, 'original') ||
        serverCover ||
        fallbackLogo ||
        null
      );
    }
  }, [tmdbData, fallbackLogo, type, serverCover]);

  const poster = useMemo(() => {
    if (type === 'movie') {
      return (
        fallbackLogo ||
        MetadataService.getImageUrl(tmdbData?.poster_path) ||
        (tmdbData?.images?.posters?.[0]?.file_path && MetadataService.getImageUrl(tmdbData.images.posters[0].file_path)) ||
        null
      );
    } else {
      return (
        serverCover ||
        MetadataService.getImageUrl(tmdbData?.poster_path) ||
        fallbackLogo ||
        null
      );
    }
  }, [tmdbData, fallbackLogo, type, serverCover]);

  return { backdrop, poster };
};
