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
