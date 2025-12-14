
import React, { useState, useEffect, useRef } from 'react';
import { CacheService } from '../services/cacheService.ts';

interface CachedImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
}

const CachedImage: React.FC<CachedImageProps> = ({ src, className, alt, ...props }) => {
  const [imgSrc, setImgSrc] = useState<string>('');
  const [loaded, setLoaded] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    let objectUrl: string | null = null;

    const load = async () => {
        if (!src) return;

        // 1. Try Cache
        const cachedUrl = await CacheService.getImage(src);
        
        if (!mounted.current) return;

        if (cachedUrl) {
            setImgSrc(cachedUrl);
            setLoaded(true);
            objectUrl = cachedUrl;
        } else {
            // 2. Fallback to network (CacheService doesn't have it yet)
            // We set the src directly to the URL to let the browser load it normally
            // AND we can trigger a save in background if we want, but usually
            // the DownloadManager handles the bulk. 
            // For individual view, let browser handle cache or load.
            setImgSrc(src);
            
            // Optional: If we want to aggressively cache viewed items:
            /*
            fetch(src).then(res => res.blob()).then(blob => {
                CacheService.saveImage(src, blob);
            });
            */
        }
    };

    load();

    return () => {
        mounted.current = false;
        // Cleanup object URL to avoid memory leaks
        if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  return (
    <div className={`relative overflow-hidden ${className}`}>
        {/* Placeholder / Skeleton */}
        {!loaded && (
            <div className="absolute inset-0 bg-[#202020] animate-pulse flex items-center justify-center">
               <span className="text-xs text-gray-700 font-bold opacity-20">IMG</span>
            </div>
        )}
        
        {imgSrc && (
            <img 
                src={imgSrc} 
                alt={alt} 
                className={`w-full h-full object-cover transition-opacity duration-500 ${loaded ? 'opacity-100' : 'opacity-0'}`}
                onLoad={() => setLoaded(true)}
                loading="lazy"
                decoding="async"
                {...props}
            />
        )}
    </div>
  );
};

export default React.memo(CachedImage);
