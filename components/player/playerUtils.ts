// Pure utility functions for the video player.
// Extracted from components/VideoPlayerNew.tsx during refactor B.1.
// Keep this file free of React and DOM event handlers.

import Hls from 'hls.js';
import mpegts from 'mpegts.js';
import type { Channel } from '../../types';
import {
  MAX_PLAYBACK_RETRIES,
  PlaybackErrorState,
  PlayerEngine,
  StreamSourceInfo,
} from './playerTypes';

export const formatTime = (seconds: number): string => {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0
    ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
    : `${m}:${s.toString().padStart(2, '0')}`;
};

export const sanitizeStreamUrl = (rawUrl: string): string => {
  try {
    const url = new URL(rawUrl);
    const sensitiveParams = ['username', 'user', 'password', 'pass', 'token', 'key', 'api_key'];
    sensitiveParams.forEach(param => {
      if (url.searchParams.has(param)) url.searchParams.set(param, '***');
    });

    const parts = url.pathname.split('/');
    const xtreamIndex = parts.findIndex(part => ['live', 'movie', 'series'].includes(part.toLowerCase()));
    if (xtreamIndex >= 0) {
      if (parts[xtreamIndex + 1]) parts[xtreamIndex + 1] = '***';
      if (parts[xtreamIndex + 2]) parts[xtreamIndex + 2] = '***';
    }
    url.pathname = parts.join('/');
    url.hash = '';
    return url.toString();
  } catch {
    return rawUrl.replace(/([?&](?:username|user|password|pass|token|key|api_key)=)[^&]+/gi, '$1***');
  }
};

export const detectStreamSource = (url: string, channelType?: Channel['type']): StreamSourceInfo => {
  const lowerUrl = url.toLowerCase();
  const path = (() => {
    try { return new URL(url).pathname.toLowerCase(); } catch { return lowerUrl; }
  })();
  const isXtreamLike = /\/(live|movie|series)\//.test(path) || lowerUrl.includes('player_api.php');
  const isExtensionless = !/\.[a-z0-9]{2,5}(?:$|[?#])/.test(lowerUrl);
  const isLive = channelType === 'live' || path.includes('/live/');

  if (lowerUrl.includes('.m3u8')) {
    return { protocol: 'hls', mimeType: 'application/x-mpegURL', engine: Hls.isSupported() ? 'hlsjs' : 'videojs', isXtreamLike, isExtensionless, isLive, label: 'HLS (.m3u8)' };
  }
  if (lowerUrl.includes('.mpd')) {
    return { protocol: 'dash', mimeType: 'application/dash+xml', engine: 'videojs', isXtreamLike, isExtensionless, isLive, label: 'DASH (.mpd)' };
  }
  if (/\.(ts|mpeg|mpg)(?:$|[?#])/.test(lowerUrl) || (isXtreamLike && isLive)) {
    return { protocol: 'mpegts', mimeType: 'video/mp2t', engine: mpegts.isSupported() ? 'mpegts' : 'videojs', isXtreamLike, isExtensionless, isLive, label: 'MPEG-TS' };
  }
  if (/\.(webm)(?:$|[?#])/.test(lowerUrl)) {
    return { protocol: 'webm', mimeType: 'video/webm', engine: 'videojs', isXtreamLike, isExtensionless, isLive, label: 'WebM progressivo' };
  }
  // MED-1 (Step 3-ter): MKV/Matroska supportato nativamente da Media3 su Android.
  // Sul web rimane "best effort" (i browser ne supportano un subset via <video>).
  if (/\.(mkv|matroska)(?:$|[?#])/.test(lowerUrl)) {
    return { protocol: 'mkv', mimeType: 'video/x-matroska', engine: 'videojs', isXtreamLike, isExtensionless, isLive, label: 'MKV/Matroska' };
  }

  const shouldAssumeMp4 = /\.(mp4|m4v|mov)(?:$|[?#])/.test(lowerUrl) || (isXtreamLike && (channelType === 'movie' || channelType === 'series')) || isExtensionless;
  return {
    protocol: shouldAssumeMp4 ? 'mp4' : 'unknown',
    mimeType: shouldAssumeMp4 ? 'video/mp4' : 'application/octet-stream',
    engine: 'videojs',
    isXtreamLike,
    isExtensionless,
    isLive,
    label: shouldAssumeMp4 ? 'MP4/progressivo' : 'Formato non rilevato',
  };
};

export const classifyPlaybackError = (
  err: { code?: number; message?: string } | null,
  sourceInfo: StreamSourceInfo,
  url: string,
  retryCount: number,
  engine: PlayerEngine,
  extra?: unknown
): PlaybackErrorState => {
  const code = err?.code;
  const details = [
    `Motore: ${engine}`,
    `Protocollo: ${sourceInfo.label}`,
    `MIME: ${sourceInfo.mimeType}`,
    `URL: ${sanitizeStreamUrl(url)}`,
  ];
  if (code) details.push(`MediaError code: ${code}`);
  if (err?.message) details.push(`MediaError message: ${err.message}`);
  if (extra) details.push(`Dettaglio: ${String(extra)}`);

  const extraText = String(extra || '').toLowerCase();
  if (extraText.includes('401') || extraText.includes('unauthorized')) {
    return { title: 'Credenziali non autorizzate', message: 'Il server IPTV ha rifiutato lo stream. Verifica username/password o scadenza dell’abbonamento.', category: 'network', canRetry: retryCount < MAX_PLAYBACK_RETRIES, retryCount, technicalDetails: details };
  }
  if (extraText.includes('403') || extraText.includes('forbidden')) {
    return { title: 'Accesso negato allo stream', message: 'Il server ha negato l’accesso allo stream. Potrebbe essere un limite account, geoblock o token scaduto.', category: 'network', canRetry: retryCount < MAX_PLAYBACK_RETRIES, retryCount, technicalDetails: details };
  }
  if (extraText.includes('404') || extraText.includes('not found')) {
    return { title: 'Stream non trovato', message: 'Il canale o VOD non è più disponibile sul server IPTV.', category: 'network', canRetry: false, retryCount, technicalDetails: details };
  }
  if (extraText.includes('timeout')) {
    return { title: 'Timeout dello stream', message: 'Il player non ha ricevuto dati in tempo utile. Controlla la connessione o riprova.', category: 'timeout', canRetry: retryCount < MAX_PLAYBACK_RETRIES, retryCount, technicalDetails: details };
  }

  if (code === MediaError.MEDIA_ERR_NETWORK) {
    return { title: 'Errore di rete', message: 'Lo stream non risponde o la connessione è instabile. Riprova tra poco o controlla il server IPTV.', category: 'network', canRetry: retryCount < MAX_PLAYBACK_RETRIES, retryCount, technicalDetails: details };
  }
  if (code === MediaError.MEDIA_ERR_DECODE) {
    return { title: 'Errore codec/decodifica', message: 'Il video potrebbe usare un codec non supportato o un flusso corrotto. Se è HEVC/H.265, verifica i codec del sistema.', category: 'decode', canRetry: retryCount < MAX_PLAYBACK_RETRIES, retryCount, technicalDetails: details };
  }
  if (code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
    // MKV-specific hint: con il bypass di Video.js attivo, un
    // SRC_NOT_SUPPORTED su MKV indica quasi sempre un codec interno non
    // decodificabile dal Chromium di Electron (tipicamente HEVC/H.265 o
    // AV1 senza supporto hardware). Suggeriamo di verificare i codec
    // (script `npm run postinstall` rifa il patch FFmpeg BranchBit).
    if (sourceInfo.protocol === 'mkv') {
      return {
        title: 'MKV non riproducibile',
        message: 'Il container MKV è stato accettato ma il codec video o audio interno non è supportato dal player. Probabilmente è HEVC/H.265 o AV1 senza decoder hardware/software disponibile. Verifica i codec di sistema o usa lo script `npm run postinstall` per rigenerare la patch FFmpeg con HEVC.',
        category: 'decode',
        canRetry: retryCount < MAX_PLAYBACK_RETRIES,
        retryCount,
        technicalDetails: details,
      };
    }
    return { title: 'Formato non supportato', message: `Il formato ${sourceInfo.label} non è stato accettato dal player corrente. Prova un altro stream o verifica codec/protocollo.`, category: 'unsupported', canRetry: retryCount < MAX_PLAYBACK_RETRIES, retryCount, technicalDetails: details };
  }
  if (sourceInfo.protocol === 'mpegts' && engine === 'videojs') {
    return { title: 'MPEG-TS non gestito nativamente', message: 'Questo stream TS diretto richiede supporto MediaSource/mpegts. Il dispositivo potrebbe non supportarlo.', category: 'unsupported', canRetry: retryCount < MAX_PLAYBACK_RETRIES, retryCount, technicalDetails: details };
  }

  return { title: 'Errore di riproduzione', message: 'La riproduzione si è interrotta. Puoi riprovare o aprire i dettagli tecnici.', category: 'unknown', canRetry: retryCount < MAX_PLAYBACK_RETRIES, retryCount, technicalDetails: details };
};

