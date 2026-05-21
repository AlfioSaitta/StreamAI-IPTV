import { describe, expect, it } from 'vitest';
import {
  parseCodecString,
  parseCodecList,
} from '../../services/streamInfo/codecParser';

describe('parseCodecString', () => {
  it('parses H.264 High profile, level 4.0', () => {
    // avc1.640028 → profile_idc=0x64 (100=High), level_idc=0x28 (40 → 4.0)
    const parsed = parseCodecString('avc1.640028');
    expect(parsed.id).toBe('avc1');
    expect(parsed.name).toBe('H.264/AVC');
    expect(parsed.profile).toBe('High');
    expect(parsed.level).toBe('4.0');
    expect(parsed.bitDepth).toBe(8);
  });

  it('parses H.264 Baseline profile with constrained flag', () => {
    // avc1.42E01E → profile_idc=0x42 (66=Baseline), constraint=0xE0 (bit 0x40 → Constrained),
    // level_idc=0x1E (30 → 3.0)
    const parsed = parseCodecString('avc1.42E01E');
    expect(parsed.profile).toBe('Baseline (Constrained)');
    expect(parsed.level).toBe('3.0');
    expect(parsed.bitDepth).toBe(8);
  });

  it('parses HEVC Main 10 with Level 4.0', () => {
    // hev1.2.4.L120 → profile=2 (Main 10), tier=4 (High), level=120/30=4.0
    const parsed = parseCodecString('hev1.2.4.L120');
    expect(parsed.name).toBe('H.265/HEVC');
    expect(parsed.profile).toBe('Main 10');
    expect(parsed.tier).toBe('High');
    expect(parsed.level).toBe('4.0');
    expect(parsed.bitDepth).toBe(10);
  });

  it('parses Dolby Vision profile 5 as HDR', () => {
    const parsed = parseCodecString('dvh1.05.06');
    expect(parsed.name).toBe('Dolby Vision (HEVC)');
    expect(parsed.isHDR).toBe(true);
    expect(parsed.colorSpace).toBe('Dolby Vision');
    expect(parsed.bitDepth).toBe(10);
    expect(parsed.profile).toContain('Profile 5');
  });

  it('parses AV1 10-bit as HDR', () => {
    // av01.0.05M.10 → profile 0 (Main), level 5.0 Main tier, 10-bit
    const parsed = parseCodecString('av01.0.05M.10');
    expect(parsed.name).toBe('AV1');
    expect(parsed.profile).toBe('Main');
    expect(parsed.tier).toBe('Main');
    expect(parsed.bitDepth).toBe(10);
    expect(parsed.isHDR).toBe(true);
  });

  it('parses VP9 Profile 0 8-bit', () => {
    const parsed = parseCodecString('vp09.00.10.08');
    expect(parsed.name).toBe('VP9');
    expect(parsed.profile).toContain('Profile 0');
    expect(parsed.bitDepth).toBe(8);
    expect(parsed.isHDR).toBeFalsy();
  });

  it('parses AAC-LC (mp4a.40.2)', () => {
    const parsed = parseCodecString('mp4a.40.2');
    expect(parsed.name).toBe('AAC');
    expect(parsed.profile).toBe('AAC-LC');
  });

  it('falls back to uppercase id for unknown codec', () => {
    const parsed = parseCodecString('xyz.99');
    expect(parsed.name).toBe('XYZ');
    expect(parsed.profile).toBeUndefined();
  });
});

describe('parseCodecList', () => {
  it('extracts video + audio from a typical HLS CODECS attribute', () => {
    const info = parseCodecList('avc1.4d401f,mp4a.40.2');
    expect(info.videoCodec).toBe('H.264/AVC');
    expect(info.isH264).toBe(true);
    expect(info.audioCodec).toBe('AAC');
  });

  it('marks HEVC + Dolby Vision flags correctly', () => {
    const info = parseCodecList('hvc1.2.4.L120,mp4a.40.2');
    expect(info.isHEVC).toBe(true);
    expect(info.isH264).toBeFalsy();
    expect(info.videoBitDepth).toBe(10);
  });

  it('detects Dolby Vision and HDR', () => {
    const info = parseCodecList('dvhe.05.06');
    expect(info.isDolbyVision).toBe(true);
    expect(info.videoHDR).toBe(true);
  });

  it('ignores extra whitespace and empty entries', () => {
    const info = parseCodecList(' avc1.64001f , , mp4a.40.2 ');
    expect(info.videoCodec).toBe('H.264/AVC');
    expect(info.audioCodec).toBe('AAC');
  });

  it('returns empty info for unknown codecs', () => {
    const info = parseCodecList('foo.1,bar.2');
    expect(info.videoCodec).toBeUndefined();
    expect(info.audioCodec).toBeUndefined();
  });
});

