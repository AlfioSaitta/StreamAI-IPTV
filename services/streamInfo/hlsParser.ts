// HLS manifest parsing helpers (master + media playlists).
// Pure string parsing. Extracted from services/streamInfoService.ts during refactor B.2.

import { parseCodecList } from './codecParser';
import type { StreamCodecInfo } from './types';

/**
 * Analizza un manifest HLS (variant o master) ed estrae codec, risoluzione,
 * bitrate e frame rate dichiarati. Confidenza `high` se trova codec, altrimenti `medium`.
 */
export function analyzeHlsManifestText(text: string): Partial<StreamCodecInfo> {
  const info: Partial<StreamCodecInfo> = {
    protocol: 'HLS',
    container: 'HLS (m3u8)',
    rawInfo: {},
    detectionMethod: 'hls-manifest-fetch',
    confidence: 'medium',
  };

  const codecMatch = text.match(/CODECS="([^"]+)"/i);
  if (codecMatch) {
    Object.assign(info, parseCodecList(codecMatch[1]));
    info.rawInfo = { ...info.rawInfo, manifestCodecs: codecMatch[1] };
    if (info.videoCodec || info.audioCodec) info.confidence = 'high';
  }

  const resolutionMatch = text.match(/RESOLUTION=(\d+)x(\d+)/i);
  if (resolutionMatch) {
    info.width = Number(resolutionMatch[1]);
    info.height = Number(resolutionMatch[2]);
  }

  const bandwidthMatch = text.match(/(?:AVERAGE-)?BANDWIDTH=(\d+)/i);
  if (bandwidthMatch) info.bitrate = Number(bandwidthMatch[1]);

  const frameRateMatch = text.match(/FRAME-RATE=([0-9.]+)/i);
  if (frameRateMatch) info.frameRate = Number(frameRateMatch[1]);

  return info;
}

/**
 * Risolve la prima URL referenziata in un manifest HLS (master → variant o
 * variant → segment) usando `baseUrl` come ancora.
 */
export function resolveHlsReference(baseUrl: string, manifestText: string): string | null {
  const line = manifestText
    .split(/\r?\n/)
    .map(value => value.trim())
    .find(value => value && !value.startsWith('#'));

  if (!line) return null;

  try {
    return new URL(line, baseUrl).toString();
  } catch {
    return null;
  }
}

