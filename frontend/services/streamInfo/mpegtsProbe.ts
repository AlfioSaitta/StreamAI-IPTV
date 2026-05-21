// MPEG-TS probing: PAT/PMT scanning to extract video/audio codecs from raw bytes.
// Pure byte parsing. Extracted from services/streamInfoService.ts during refactor B.2.

export interface MpegTsStreamMapping {
  codec?: string;
  codecId?: string;
  kind: 'video' | 'audio' | 'unknown';
}

export interface MpegTsProgramMapResult {
  videoCodec?: string;
  videoCodecId?: string;
  audioCodec?: string;
  audioCodecId?: string;
}

/**
 * Heuristic check: does the buffer start with valid MPEG-TS sync bytes (0x47) every 188 bytes.
 */
export function isLikelyMpegTs(data: Uint8Array): boolean {
  return data.length >= 188 &&
    data[0] === 0x47 &&
    (data.length < 376 || data[188] === 0x47 || data[376] === 0x47);
}

/**
 * Maps the MPEG-TS stream_type byte (ISO/IEC 13818-1) to a human codec descriptor.
 */
export function mapMpegTsStreamType(streamType: number): MpegTsStreamMapping {
  switch (streamType) {
    case 0x01:
    case 0x02:
      return { kind: 'video', codec: 'MPEG-2 Video', codecId: 'mp2v' };
    case 0x10:
      return { kind: 'video', codec: 'MPEG-4 Part 2', codecId: 'mp4v' };
    case 0x1B:
      return { kind: 'video', codec: 'H.264/AVC', codecId: 'avc1' };
    case 0x24:
      return { kind: 'video', codec: 'H.265/HEVC', codecId: 'hvc1' };
    case 0x03:
    case 0x04:
      return { kind: 'audio', codec: 'MP3/MPEG Audio', codecId: 'mp3' };
    case 0x0F:
    case 0x11:
      return { kind: 'audio', codec: 'AAC', codecId: 'mp4a' };
    case 0x81:
      return { kind: 'audio', codec: 'AC-3 (Dolby Digital)', codecId: 'ac-3' };
    case 0x87:
      return { kind: 'audio', codec: 'E-AC-3 (Dolby Digital Plus)', codecId: 'ec-3' };
    default:
      return { kind: 'unknown' };
  }
}

/**
 * Walks MPEG-TS packets looking for PAT (table_id 0x00) + PMT (table_id 0x02)
 * to identify the first video/audio elementary stream codecs.
 * Returns null if no codecs could be derived from the available buffer.
 */
export function analyzeMpegTsProgramMap(data: Uint8Array): MpegTsProgramMapResult | null {
  if (!isLikelyMpegTs(data)) return null;

  const pmtPids = new Set<number>();
  const packetSize = 188;

  for (let offset = 0; offset + packetSize <= data.length; offset += packetSize) {
    if (data[offset] !== 0x47) continue;

    const payloadUnitStart = (data[offset + 1] & 0x40) !== 0;
    const pid = ((data[offset + 1] & 0x1f) << 8) | data[offset + 2];
    const adaptationControl = (data[offset + 3] >> 4) & 0x03;
    if (adaptationControl === 0 || adaptationControl === 2) continue;

    let payloadOffset = offset + 4;
    if (adaptationControl === 3) payloadOffset += 1 + data[payloadOffset];
    if (payloadOffset >= offset + packetSize) continue;

    if (payloadUnitStart) payloadOffset += 1 + data[payloadOffset];
    if (payloadOffset >= offset + packetSize) continue;

    const tableId = data[payloadOffset];
    const sectionLength = ((data[payloadOffset + 1] & 0x0f) << 8) | data[payloadOffset + 2];
    const sectionEnd = Math.min(payloadOffset + 3 + sectionLength - 4, offset + packetSize);

    if (pid === 0 && tableId === 0x00) {
      for (let pos = payloadOffset + 8; pos + 4 <= sectionEnd; pos += 4) {
        const programNumber = (data[pos] << 8) | data[pos + 1];
        if (programNumber === 0) continue;
        pmtPids.add(((data[pos + 2] & 0x1f) << 8) | data[pos + 3]);
      }
      continue;
    }

    if (pmtPids.has(pid) && tableId === 0x02) {
      const programInfoLength = ((data[payloadOffset + 10] & 0x0f) << 8) | data[payloadOffset + 11];
      const result: MpegTsProgramMapResult = {};

      for (let pos = payloadOffset + 12 + programInfoLength; pos + 5 <= sectionEnd;) {
        const streamType = data[pos];
        const esInfoLength = ((data[pos + 3] & 0x0f) << 8) | data[pos + 4];
        const mapped = mapMpegTsStreamType(streamType);

        if (mapped.kind === 'video' && !result.videoCodec) {
          result.videoCodec = mapped.codec;
          result.videoCodecId = mapped.codecId;
        } else if (mapped.kind === 'audio' && !result.audioCodec) {
          result.audioCodec = mapped.codec;
          result.audioCodecId = mapped.codecId;
        }

        pos += 5 + esInfoLength;
      }

      return result.videoCodec || result.audioCodec ? result : null;
    }
  }

  return null;
}

