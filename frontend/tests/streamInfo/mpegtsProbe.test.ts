import { describe, expect, it } from 'vitest';
import {
  isLikelyMpegTs,
  mapMpegTsStreamType,
  analyzeMpegTsProgramMap,
} from '../../services/streamInfo/mpegtsProbe';

describe('isLikelyMpegTs', () => {
  it('returns true when sync byte 0x47 is present every 188 bytes', () => {
    const buf = new Uint8Array(564); // 3 packets
    buf[0] = 0x47;
    buf[188] = 0x47;
    buf[376] = 0x47;
    expect(isLikelyMpegTs(buf)).toBe(true);
  });

  it('returns false when sync byte is missing', () => {
    const buf = new Uint8Array(200);
    buf[0] = 0xff;
    expect(isLikelyMpegTs(buf)).toBe(false);
  });

  it('returns false for buffers smaller than one packet', () => {
    expect(isLikelyMpegTs(new Uint8Array(50))).toBe(false);
  });
});

describe('mapMpegTsStreamType', () => {
  it.each([
    [0x01, 'video', 'MPEG-2 Video'],
    [0x02, 'video', 'MPEG-2 Video'],
    [0x1b, 'video', 'H.264/AVC'],
    [0x24, 'video', 'H.265/HEVC'],
    [0x0f, 'audio', 'AAC'],
    [0x81, 'audio', 'AC-3 (Dolby Digital)'],
    [0x87, 'audio', 'E-AC-3 (Dolby Digital Plus)'],
  ])('maps stream_type 0x%s to %s/%s', (streamType, expectedKind, expectedCodec) => {
    const result = mapMpegTsStreamType(streamType);
    expect(result.kind).toBe(expectedKind);
    expect(result.codec).toBe(expectedCodec);
  });

  it('returns unknown for unmapped stream types', () => {
    expect(mapMpegTsStreamType(0x99).kind).toBe('unknown');
  });
});

/**
 * Build a minimal valid MPEG-TS sample with:
 *  - 1 PAT packet on PID 0 (program 1 → PMT PID 0x100)
 *  - 1 PMT packet on PID 0x100 (video H.264 elementary stream PID 0x101)
 *  - 1 padding packet on PID 0x1FFF
 *
 * The encoded bytes mirror real ISO/IEC 13818-1 PSI structure but skip the
 * trailing CRC32 because the parser ignores it (it uses sectionEnd math).
 */
function buildMinimalTs(): Uint8Array {
  const PACKET = 188;
  const out = new Uint8Array(PACKET * 3).fill(0xff);

  // ---- PAT packet on PID 0 ----
  let p = 0;
  out[p + 0] = 0x47;
  out[p + 1] = 0x40; // payload_unit_start=1, PID high=0
  out[p + 2] = 0x00; // PID low=0
  out[p + 3] = 0x10; // adaptation=01 (payload only), continuity=0
  out[p + 4] = 0x00; // pointer_field = 0 → table starts immediately
  // PAT section header
  out[p + 5] = 0x00; // table_id=0 (PAT)
  // section_length high nibble (reserved+section_length[11:8])
  // section_length total = (5 header + 4 program-entry + 4 CRC) = 13 → 0x00D
  out[p + 6] = 0xb0; // 1011 0000 — section_syntax_indicator=1, reserved=1, length high=0
  out[p + 7] = 0x0d; // length low = 13
  out[p + 8] = 0x00; // transport_stream_id high
  out[p + 9] = 0x01; // transport_stream_id low
  out[p + 10] = 0xc1; // version + current_next_indicator
  out[p + 11] = 0x00; // section_number
  out[p + 12] = 0x00; // last_section_number
  // Program entry: program_number=1, PMT_PID=0x100
  out[p + 13] = 0x00;
  out[p + 14] = 0x01;
  out[p + 15] = 0xe1; // reserved + PMT_PID high
  out[p + 16] = 0x00; // PMT_PID low
  // CRC (4 bytes) — content irrelevant for parser
  out[p + 17] = 0x00;
  out[p + 18] = 0x00;
  out[p + 19] = 0x00;
  out[p + 20] = 0x00;

  // ---- PMT packet on PID 0x100 ----
  p = PACKET;
  out[p + 0] = 0x47;
  out[p + 1] = 0x41; // payload_unit_start=1, PID high=0x01
  out[p + 2] = 0x00; // PID low=0x00 → PID = 0x100
  out[p + 3] = 0x10;
  out[p + 4] = 0x00; // pointer_field
  out[p + 5] = 0x02; // table_id=0x02 (PMT)
  // section_length = 9 header + 5 ES descriptor + 4 CRC = 18 → 0x012
  out[p + 6] = 0xb0;
  out[p + 7] = 0x12;
  out[p + 8] = 0x00; // program_number high
  out[p + 9] = 0x01; // program_number low
  out[p + 10] = 0xc1;
  out[p + 11] = 0x00;
  out[p + 12] = 0x00;
  out[p + 13] = 0xe1; // reserved + PCR_PID high
  out[p + 14] = 0x00; // PCR_PID low
  out[p + 15] = 0xf0; // program_info_length high
  out[p + 16] = 0x00; // program_info_length low = 0
  // Elementary stream loop (5 bytes per entry, no ES descriptors here):
  out[p + 17] = 0x1b; // stream_type = H.264
  out[p + 18] = 0xe1; // reserved + ES_PID high
  out[p + 19] = 0x01; // ES_PID low → 0x101
  out[p + 20] = 0xf0; // reserved + ES_info_length high
  out[p + 21] = 0x00; // ES_info_length low = 0
  // CRC
  out[p + 22] = 0; out[p + 23] = 0; out[p + 24] = 0; out[p + 25] = 0;

  // ---- Third packet on PID 0x1FFF (padding) ----
  p = PACKET * 2;
  out[p + 0] = 0x47;
  out[p + 1] = 0x1f;
  out[p + 2] = 0xff;
  out[p + 3] = 0x10;

  return out;
}

describe('analyzeMpegTsProgramMap', () => {
  it('returns null for non-TS buffers', () => {
    expect(analyzeMpegTsProgramMap(new Uint8Array(200))).toBeNull();
  });

  it('extracts H.264 video codec from a minimal PAT+PMT stream', () => {
    const buf = buildMinimalTs();
    const result = analyzeMpegTsProgramMap(buf);
    expect(result).not.toBeNull();
    expect(result!.videoCodec).toBe('H.264/AVC');
    expect(result!.videoCodecId).toBe('avc1');
  });
});

