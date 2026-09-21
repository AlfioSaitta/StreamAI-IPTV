
import React, { useState, useEffect, useRef } from 'react';
import { DownloadManager } from '../services/downloadManager.ts';
import { proxyImageURL } from '../services/proxyFetch.ts';

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
  /**
   * Ripieghi già tentati per questa `src`: 0 = valore del DownloadManager,
   * 1 = proxy, 2 = URL originale.
   *
   * Un contatore esplicito serve perché i ripieghi sono tre e gli ultimi due
   * puntano a URL diversi della stessa immagine: senza sapere a che punto si è,
   * un proxy che fallisce e un originale che fallisce si rimbalzerebbero
   * l'un l'altro all'infinito (`onError` → nuovo `src` → `onError` → …).
   */
  const fallbackStep = useRef(0);

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
    fallbackStep.current = 0;

    if (!isNearViewport) return;
    if (!src) return;

    const controller = new AbortController();

    // Il valore che torna dal DownloadManager non è sempre una copia da
    // mostrare: sui percorsi di rifiuto e di fallimento è l'URL originale, cioè
    // un invito a ripiegare su di esso. Ripiegare sull'originale salterebbe il
    // proxy — e quindi la cache su disco, che è il motivo per cui l'immagine
    // finirebbe per non essere mai memorizzata — oltre a essere la strada che su
    // un webview con mixed content non carica affatto un'immagine http. Si
    // ripiega quindi sul proxy; l'URL originale resta l'ultima spiaggia di
    // `handleError`.
    const resolveSrc = (fromManager: string | null): string => {
      if (fromManager && fromManager !== src) return fromManager;
      // Durante un live il DownloadManager rifiuta il prefetch: l'immagine deve
      // restare un segnaposto, non un `<img>` che scarica comunque (via proxy)
      // la banda che lo stream sta usando.
      if (DownloadManager.isDownloadBlockedWhilePlaying(priority)) return '';
      return proxyImageURL(src);
    };

    // Durante un live (download in pausa) si fa un giro diverso, in due passi:
    //
    //  1. "ce l'hai già?" — cache del webview, poi sonda alla cache su disco del
    //     proxy. Se c'è, si mostra senza toccare la rete: è il caso più
    //     frequente, e non costa banda;
    //  2. se non c'è, la si scarica lo stesso — ma con meno connessioni e solo
    //     perché è sotto gli occhi dell'utente — e finisce nella cache su disco
    //     condivisa, quindi la si paga una volta sola.
    //
    // Il segnaposto resta solo per il tempo del download, non per sempre.
    if (DownloadManager.isPaused()) {
      void (async () => {
        const inCache = await DownloadManager.requestCachedImage(src);
        if (!mounted.current || controller.signal.aborted) return;
        if (inCache) {
          setImgSrc(inCache);
          return;
        }

        const scaricata = await DownloadManager.requestImage(src, priority, controller.signal);
        if (!mounted.current || controller.signal.aborted) return;
        setImgSrc(resolveSrc(scaricata));
      })();
      return;
    }

    // Richiedi l'immagine tramite DownloadManager
    DownloadManager.requestImage(src, priority, controller.signal).then(cachedUrl => {
      if (!mounted.current || controller.signal.aborted) return;
      setImgSrc(resolveSrc(cachedUrl));
    });

    return () => {
      mounted.current = false;
      controller.abort();
    };
  }, [src, priority, isNearViewport]);

  const handleLoad = () => {
    if (mounted.current) {
      setLoaded(true);
      setError(false);
    }
  };

  const handleError = () => {
    if (!mounted.current) return;

    // Ordine dei ripieghi: copia locale (object URL) → proxy → URL originale.
    // Il proxy sta **prima** dell'originale perché una copia può essere un
    // object URL revocato (le voci scadono) e, sui webview che li bloccano, gli
    // URL http remoti non si caricano affatto: il proxy è l'unica strada che
    // funziona in tutti e due i casi — ed è quella che riempie la cache su disco.
    if (fallbackStep.current === 0) {
      fallbackStep.current = 1;
      const viaProxy = proxyImageURL(src);
      if (viaProxy && viaProxy !== imgSrc) {
        setImgSrc(viaProxy);
        return;
      }
    }

    if (fallbackStep.current === 1 && src && src !== imgSrc) {
      fallbackStep.current = 2;
      setImgSrc(src);
      return;
    }

    setError(true);
  };

  return (
    <div ref={containerRef} className={`relative overflow-hidden ${className}`}>
      {/* Placeholder / Skeleton — pulsa per un tempo limitato (vedi
          `.placeholder-pulse` in index.css): su un catalogo intero le
          animazioni infinite sono centinaia, e una copertina che non arriva
          non smetteva mai di pulsare. */}
      {!loaded && !error && (
        <div className="absolute inset-0 bg-[#202020] placeholder-pulse flex items-center justify-center">
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
