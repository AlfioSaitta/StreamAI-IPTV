// Raw video byte analysis: NAL unit / OBU / VP9 header sniffing for codec detection
// when manifest metadata is not available (typical for MPEG-TS live).
// Pure byte parsing. Extracted from services/streamInfoService.ts during refactor B.2.

import { H264_PROFILES } from './codecMap';
import { analyzeMpegTsProgramMap } from './mpegtsProbe';

export interface VideoByteAnalysis {
  codec?: string;
  codecId?: string;
  audioCodec?: string;
  audioCodecId?: string;
  profile?: string;
  level?: string;
  bitDepth?: number;
}

/**
 * Analizza i byte iniziali di un chunk video per rilevare il codec.
 * Utile per stream MPEG-TS dove i metadati non sono disponibili a livello manifest.
 */
export function analyzeVideoBytes(data: Uint8Array): VideoByteAnalysis | null {
  if (data.length < 10) return null;

  const tsInfo = analyzeMpegTsProgramMap(data);
  if (tsInfo?.videoCodec || tsInfo?.audioCodec) {
    return {
      codec: tsInfo.videoCodec,
      codecId: tsInfo.videoCodecId,
      audioCodec: tsInfo.audioCodec,
      audioCodecId: tsInfo.audioCodecId,
    };
  }

  // Cerca NAL unit start codes (H.264/HEVC)
  for (let i = 0; i < data.length - 5; i++) {
    // Start code: 00 00 00 01 o 00 00 01
    if ((data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 1) ||
        (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1)) {
      const nalOffset = data[i + 2] === 1 ? i + 3 : i + 4;
      const nalByte = data[nalOffset];

      // H.264 NAL unit type (5 bits) — SPS = type 7
      const h264NalType = nalByte & 0x1F;
      if (h264NalType === 7 && data.length > nalOffset + 4) {
        const profileIdc = data[nalOffset + 1];
        const levelIdc = data[nalOffset + 3];
        return {
          codec: 'H.264/AVC',
          profile: H264_PROFILES[profileIdc] || `Profile ${profileIdc}`,
          level: (levelIdc / 10).toFixed(1),
          bitDepth: profileIdc === 110 ? 10 : 8,
        };
      }

      // HEVC NAL unit type (6 bits, shifted) — VPS = 32, SPS = 33
      const hevcNalType = (nalByte >> 1) & 0x3F;
      if ((hevcNalType === 32 || hevcNalType === 33) && data.length > nalOffset + 4) {
        return {
          codec: 'H.265/HEVC',
          // Profile e bit depth richiederebbero parsing completo dell'SPS.
        };
      }
    }
  }

  // Cerca AV1 OBU — Sequence Header OBU (type 1)
  for (let i = 0; i < data.length - 4; i++) {
    const obuType = (data[i] >> 3) & 0x0F;
    if (obuType === 1) {
      return { codec: 'AV1', profile: 'Main' };
    }
  }

  // Cerca VP9 frame header (sync byte 0x82/0x83)
  if (data[0] === 0x82 || data[0] === 0x83) {
    const profile = (data[0] & 0x01) | ((data[1] >> 7) & 0x02);
    return {
      codec: 'VP9',
      profile: `Profile ${profile}`,
      bitDepth: profile >= 2 ? 10 : 8,
    };
  }

  return null;
}

