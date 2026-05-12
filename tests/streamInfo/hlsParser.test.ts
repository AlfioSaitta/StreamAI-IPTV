import { describe, expect, it } from 'vitest';
import {
  analyzeHlsManifestText,
  resolveHlsReference,
} from '../../services/streamInfo/hlsParser';

const SAMPLE_MASTER = `#EXTM3U
#EXT-X-VERSION:6
#EXT-X-STREAM-INF:BANDWIDTH=5000000,AVERAGE-BANDWIDTH=4500000,RESOLUTION=1920x1080,FRAME-RATE=25.000,CODECS="avc1.640028,mp4a.40.2"
1080p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720,CODECS="avc1.4d401f,mp4a.40.2"
720p/index.m3u8
`;

const SAMPLE_MEDIA = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXT-X-MEDIA-SEQUENCE:0
#EXTINF:9.5,
segment0.ts
#EXTINF:10.0,
segment1.ts
`;

describe('analyzeHlsManifestText', () => {
  it('extracts codec, resolution, bitrate and frame-rate from a master manifest', () => {
    const info = analyzeHlsManifestText(SAMPLE_MASTER);
    expect(info.protocol).toBe('HLS');
    expect(info.container).toBe('HLS (m3u8)');
    expect(info.videoCodec).toBe('H.264/AVC');
    expect(info.audioCodec).toBe('AAC');
    expect(info.width).toBe(1920);
    expect(info.height).toBe(1080);
    expect(info.bitrate).toBe(5000000); // First BANDWIDTH= match wins (peak)
    expect(info.frameRate).toBe(25);
    expect(info.confidence).toBe('high');
  });

  it('falls back to medium confidence when no CODECS attribute is present', () => {
    const info = analyzeHlsManifestText(SAMPLE_MEDIA);
    expect(info.protocol).toBe('HLS');
    expect(info.videoCodec).toBeUndefined();
    expect(info.confidence).toBe('medium');
  });
});

describe('resolveHlsReference', () => {
  it('resolves a relative variant URI against a base URL', () => {
    const resolved = resolveHlsReference(
      'https://cdn.example.com/master.m3u8',
      SAMPLE_MASTER
    );
    expect(resolved).toBe('https://cdn.example.com/1080p/index.m3u8');
  });

  it('resolves an absolute URI ignoring the base URL', () => {
    const resolved = resolveHlsReference(
      'https://cdn.example.com/master.m3u8',
      '#EXTM3U\nhttps://other.example/foo.m3u8\n'
    );
    expect(resolved).toBe('https://other.example/foo.m3u8');
  });

  it('returns null when the manifest has no non-comment line', () => {
    expect(resolveHlsReference('https://x.test/m.m3u8', '#EXTM3U\n#EXT-X-VERSION:3\n')).toBeNull();
  });
});

