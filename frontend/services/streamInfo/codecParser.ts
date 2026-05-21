// Codec string parsing + capability probing helpers.
// Pure functions. Extracted from services/streamInfoService.ts during refactor B.2.

import { AV1_PROFILES, CODEC_MAP, H264_PROFILES, HEVC_PROFILES } from './codecMap';
import type { StreamCodecInfo } from './types';

export interface ParsedCodec {
  id: string;
  name: string;
  profile?: string;
  level?: string;
  bitDepth?: number;
  isHDR?: boolean;
  colorSpace?: string;
  tier?: string;
}

/**
 * Rileva il codec dal codec string (es. "avc1.42E01E") - VERSIONE AVANZATA
 */
export function parseCodecString(codecString: string): ParsedCodec {
  const parts = codecString.split('.');
  const id = parts[0].toLowerCase();
  const name = CODEC_MAP[id] || id.toUpperCase();

  let profile: string | undefined;
  let level: string | undefined;
  let bitDepth: number | undefined;
  let isHDR = false;
  let colorSpace: string | undefined;
  let tier: string | undefined;

  // Parse H.264 profile/level (es. avc1.42E01E, avc1.640028)
  if (id.startsWith('avc') && parts.length > 1) {
    const hex = parts[1];
    if (hex.length >= 6) {
      const profileIdc = parseInt(hex.substring(0, 2), 16);
      const constraintSet = parseInt(hex.substring(2, 4), 16);
      const levelIdc = parseInt(hex.substring(4, 6), 16);

      profile = H264_PROFILES[profileIdc] || `Profile ${profileIdc}`;
      level = (levelIdc / 10).toFixed(1);

      if (profileIdc === 110) bitDepth = 10;
      else if (profileIdc === 122 || profileIdc === 244) bitDepth = 10;
      else bitDepth = 8;

      if (constraintSet & 0x40) profile += ' (Constrained)';
    }
  }

  // Parse HEVC profile/level (es. hev1.1.6.L93.B0, hvc1.2.4.L120.90)
  if ((id === 'hev1' || id === 'hvc1') && parts.length >= 2) {
    const profileSpace = parseInt(parts[1]) || 1;
    profile = HEVC_PROFILES[profileSpace] || `Profile ${profileSpace}`;

    if (profileSpace === 2 || profileSpace === 8 || profileSpace === 11 || profileSpace === 13) bitDepth = 10;
    else bitDepth = 8;

    if (parts.length >= 4) {
      const tierFlag = parts[2];
      const levelStr = parts[3];
      tier = (tierFlag === '4' || tierFlag === '6') ? 'High' : 'Main';
      if (levelStr.startsWith('L')) {
        const levelNum = parseInt(levelStr.substring(1));
        level = (levelNum / 30).toFixed(1);
      }
    }

    if (parts.length >= 5) {
      const constraints = parts[4];
      if (profileSpace === 2 && (constraints === 'B0' || constraints === '90')) {
        isHDR = true;
        colorSpace = 'HDR10/HLG';
      }
    }
  }

  // Parse Dolby Vision (es. dvh1.05.06, dvhe.05.06)
  if (id.startsWith('dvh') || id.startsWith('dva')) {
    isHDR = true;
    colorSpace = 'Dolby Vision';
    bitDepth = 10;

    if (parts.length >= 2) {
      const dvProfile = parseInt(parts[1]);
      const dvProfiles: Record<number, string> = {
        4: 'Profile 4 (HDR10 compatible)',
        5: 'Profile 5 (HDR10 compatible)',
        7: 'Profile 7 (HDR10+ compatible)',
        8: 'Profile 8 (HDR10+ compatible, HLG)',
      };
      profile = dvProfiles[dvProfile] || `Profile ${dvProfile}`;
    }
  }

  // Parse AV1 (es. av01.0.05M.08, av01.0.05M.10)
  if (id === 'av01' && parts.length >= 4) {
    const profileNum = parseInt(parts[1]);
    profile = AV1_PROFILES[profileNum] || `Profile ${profileNum}`;

    const levelTier = parts[2];
    const levelMatch = levelTier.match(/(\d+)([MH]?)/);
    if (levelMatch) {
      const levelNum = parseInt(levelMatch[1]);
      level = (levelNum / 10 + (levelNum % 10) * 0.1).toFixed(1);
      tier = levelMatch[2] === 'H' ? 'High' : 'Main';
    }

    const bitDepthStr = parts[3];
    if (bitDepthStr === '08') {
      bitDepth = 8;
    } else if (bitDepthStr === '10') {
      bitDepth = 10;
      isHDR = true;
    } else if (bitDepthStr === '12') {
      bitDepth = 12;
      isHDR = true;
    }

    if (parts.length >= 5) {
      const colorPrimaries = parseInt(parts[4]);
      if (colorPrimaries === 9) { colorSpace = 'BT.2020'; isHDR = true; }
      else if (colorPrimaries === 1) colorSpace = 'BT.709';
    }
  }

  // Parse VP9 (es. vp09.00.10.08)
  if (id === 'vp09' && parts.length >= 4) {
    const vp9Profile = parseInt(parts[1]);
    const vp9Profiles: Record<number, string> = {
      0: 'Profile 0 (8-bit, 4:2:0)',
      1: 'Profile 1 (8-bit, 4:2:2/4:4:4)',
      2: 'Profile 2 (10/12-bit, 4:2:0)',
      3: 'Profile 3 (10/12-bit, 4:2:2/4:4:4)',
    };
    profile = vp9Profiles[vp9Profile] || `Profile ${vp9Profile}`;

    const vp9Level = parseInt(parts[2]);
    level = (vp9Level / 10).toFixed(1);

    const vp9BitDepth = parseInt(parts[3]);
    bitDepth = vp9BitDepth;
    if (vp9BitDepth >= 10) isHDR = true;
  }

  // Parse Audio AAC dettagliato (es. mp4a.40.2)
  if (id === 'mp4a' && parts.length >= 3) {
    const objectType = parseInt(parts[2]);
    const aacProfiles: Record<number, string> = {
      1: 'AAC Main',
      2: 'AAC-LC',
      3: 'AAC SSR',
      4: 'AAC LTP',
      5: 'HE-AAC (SBR)',
      6: 'AAC Scalable',
      29: 'HE-AAC v2 (SBR+PS)',
      39: 'AAC ELD',
      42: 'xHE-AAC (USAC)',
    };
    profile = aacProfiles[objectType] || `Object Type ${objectType}`;
  }

  return { id, name, profile, level, bitDepth, isHDR, colorSpace, tier };
}

/**
 * Verifica supporto base via HTMLVideoElement.canPlayType.
 */
export function checkCodecSupport(mimeType: string): { supported: boolean; probably: boolean } {
  const video = document.createElement('video');
  const result = video.canPlayType(mimeType);
  return { supported: result !== '', probably: result === 'probably' };
}

/**
 * Estrae il primo codec video e il primo codec audio da una lista codec HLS
 * tipo `CODECS="avc1.4D4028,mp4a.40.2"`.
 */
export function parseCodecList(codecList: string): Partial<StreamCodecInfo> {
  const info: Partial<StreamCodecInfo> = {};
  const codecs = codecList.split(',').map(codec => codec.trim()).filter(Boolean);

  for (const codecStr of codecs) {
    const parsed = parseCodecString(codecStr);
    const id = parsed.id.toLowerCase();
    const isVideo = id.startsWith('avc') || id.startsWith('hev') || id.startsWith('hvc') ||
                    id.startsWith('dvh') || id.startsWith('dva') || id.startsWith('av0') ||
                    id === 'av1' || id.startsWith('vp9') || id.startsWith('vp09') ||
                    id.startsWith('vp8') || id.startsWith('vp08') || id.startsWith('mp2v');
    const isAudio = id.startsWith('mp4a') || id.includes('ac-3') || id.includes('ec-3') ||
                    id.includes('ac3') || id.includes('ec3') || id.startsWith('opus') ||
                    id.startsWith('vorbis') || id.startsWith('flac') || id.startsWith('mp3');

    if (isVideo && !info.videoCodec) {
      info.videoCodec = parsed.name;
      info.videoCodecId = codecStr;
      info.videoProfile = parsed.profile || null;
      info.videoLevel = parsed.level || null;
      info.videoBitDepth = parsed.bitDepth || null;
      info.videoColorSpace = parsed.colorSpace || null;
      info.videoHDR = parsed.isHDR || false;
      info.isH264 = id.startsWith('avc');
      info.isHEVC = id.startsWith('hev') || id.startsWith('hvc');
      info.isAV1 = id.startsWith('av0') || id === 'av1';
      info.isVP9 = id.startsWith('vp9') || id.startsWith('vp09');
      info.isVP8 = id.startsWith('vp8') || id.startsWith('vp08');
      info.isDolbyVision = id.startsWith('dvh') || id.startsWith('dva');
    }

    if (isAudio && !info.audioCodec) {
      info.audioCodec = parsed.name;
      info.audioCodecId = codecStr;
    }
  }

  return info;
}

/**
 * Verifica avanzata con Media Capabilities API.
 * Fornisce info su hardware acceleration e power efficiency.
 */
export async function checkMediaCapabilities(config: {
  videoCodec?: string;
  width?: number;
  height?: number;
  bitrate?: number;
  framerate?: number;
  audioCodec?: string;
  audioChannels?: number;
  audioSamplerate?: number;
}): Promise<{
  supported: boolean;
  smooth: boolean;
  powerEfficient: boolean;
  hardwareAccelerated: boolean;
}> {
  const defaultResult = {
    supported: false,
    smooth: false,
    powerEfficient: false,
    hardwareAccelerated: false,
  };

  if (!('mediaCapabilities' in navigator)) return defaultResult;

  try {
    const mediaConfig: MediaDecodingConfiguration = {
      type: 'media-source',
      video: config.videoCodec ? {
        contentType: `video/mp4; codecs="${config.videoCodec}"`,
        width: config.width || 1920,
        height: config.height || 1080,
        bitrate: config.bitrate || 5000000,
        framerate: config.framerate || 30,
      } : undefined,
      audio: config.audioCodec ? {
        contentType: `audio/mp4; codecs="${config.audioCodec}"`,
        channels: String(config.audioChannels || 2),
        samplerate: config.audioSamplerate || 48000,
        bitrate: 128000,
      } : undefined,
    };

    if (!mediaConfig.video) delete mediaConfig.video;
    if (!mediaConfig.audio) delete mediaConfig.audio;

    if (!mediaConfig.video && !mediaConfig.audio) return defaultResult;

    const result = await navigator.mediaCapabilities.decodingInfo(mediaConfig);

    return {
      supported: result.supported,
      smooth: result.smooth,
      powerEfficient: result.powerEfficient,
      // Stima hardware acceleration: se è smooth e power efficient, probabilmente HW
      hardwareAccelerated: result.smooth && result.powerEfficient,
    };
  } catch (error) {
    console.warn('[MediaCapabilities] Error:', error);
    return defaultResult;
  }
}

