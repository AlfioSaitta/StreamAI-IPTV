
import React, { useState, useEffect, useRef } from 'react';
import { DownloadManager } from '../services/downloadManager.ts';

interface CachedImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  priority?: number; // 0 = bassa, 1 = normale, 2 = alta (visibile)
}

const CachedImage: React.FC<CachedImageProps> = ({ src, className, alt, priority = 1, ...props }) => {
  const [imgSrc, setImgSrc] = useState<string>('');
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [isNearViewport, setIsNearViewport] = useState(priority >= 2);
  const containerRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);

  useEffect(() => {
    if (priority >= 2) {
      setIsNearViewport(true);
      return;
    }

    const element = containerRef.current;
    if (!element || typeof IntersectionObserver === 'undefined') {
      setIsNearViewport(true);
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some(entry => entry.isIntersecting)) {
        setIsNearViewport(true);
        observer.disconnect();
      }
    }, { rootMargin: '700px 900px' });

    observer.observe(element);
    return () => observer.disconnect();
  }, [priority, src]);

  useEffect(() => {
    mounted.current = true;
    setLoaded(false);
    setError(false);
    setImgSrc('');

    if (!isNearViewport) return;
    if (!src) return;

    // Se DownloadManager è in pausa (es. durante streaming live), NON caricare nuove immagini
    // per non consumare banda
    if (DownloadManager.isPaused()) {
      // Non impostare imgSrc - l'immagine mostrerà solo il placeholder
      return;
    }

    // Richiedi l'immagine tramite DownloadManager
    DownloadManager.requestImage(src, priority).then(cachedUrl => {
      if (!mounted.current) return;

      // Ricontrolla se nel frattempo è stato messo in pausa
      if (DownloadManager.isPaused()) return;

      if (cachedUrl) {
        setImgSrc(cachedUrl);
      } else {
        // Fallback all'URL originale
        setImgSrc(src);
      }
    });

    return () => {
      mounted.current = false;
    };
  }, [src, priority, isNearViewport]);

  const handleLoad = () => {
    if (mounted.current) {
      setLoaded(true);
      setError(false);
    }
  };

  const handleError = () => {
    if (mounted.current && imgSrc !== src) {
      // Se fallisce dalla cache, prova l'URL originale
      setImgSrc(src);
    } else {
      setError(true);
    }
  };

  return (
    <div ref={containerRef} className={`relative overflow-hidden ${className}`}>
      {/* Placeholder / Skeleton */}
      {!loaded && !error && (
        <div className="absolute inset-0 bg-[#202020] animate-pulse flex items-center justify-center">
          <span className="text-xs text-gray-700 font-bold opacity-20">IMG</span>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="absolute inset-0 bg-[#1a1a1a] flex items-center justify-center">
          <span className="text-xs text-gray-600 opacity-50">✗</span>
        </div>
      )}

      {imgSrc && !error && (
        <img
          src={imgSrc}
          alt={alt}
          className={`w-full h-full object-cover transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
          onLoad={handleLoad}
          onError={handleError}
          loading={priority >= 2 ? 'eager' : 'lazy'}
          fetchPriority={priority >= 2 ? 'high' : 'low'}
          decoding="async"
          {...props}
        />
      )}
    </div>
  );
};

export default React.memo(CachedImage);
