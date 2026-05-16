// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { formatTime, sanitizeStreamUrl } from '../../components/player/playerUtils';

describe('formatTime', () => {
  it.each([
    [0, '0:00'],
    [9, '0:09'],
    [65, '1:05'],
    [3599, '59:59'],
    [3600, '1:00:00'],
    [3661, '1:01:01'],
  ])('formats %d seconds as "%s"', (input, expected) => {
    expect(formatTime(input)).toBe(expected);
  });

  it('returns "0:00" for non-finite or negative input', () => {
    expect(formatTime(NaN)).toBe('0:00');
    expect(formatTime(Infinity)).toBe('0:00');
    expect(formatTime(-10)).toBe('0:00');
  });
});

describe('sanitizeStreamUrl', () => {
  it('redacts sensitive query parameters', () => {
    const out = sanitizeStreamUrl(
      'https://iptv.example.com/get.php?username=alice&password=secret&type=m3u'
    );
    expect(out).toContain('username=***');
    expect(out).toContain('password=***');
    expect(out).not.toContain('alice');
    expect(out).not.toContain('secret');
    expect(out).toContain('type=m3u');
  });

  it('redacts Xtream-style credentials in the path', () => {
    const out = sanitizeStreamUrl(
      'http://server.example:8080/live/myuser/mypassword/1234.ts'
    );
    expect(out).toContain('/live/***/***/');
    expect(out).not.toContain('myuser');
    expect(out).not.toContain('mypassword');
    expect(out).toContain('1234.ts');
  });

  it('strips the URL hash', () => {
    const out = sanitizeStreamUrl('https://x.test/a.m3u8#token=foo');
    expect(out).not.toContain('#token=foo');
  });

  it('falls back to regex substitution for malformed URLs', () => {
    const out = sanitizeStreamUrl('not a url?token=abc&foo=bar');
    expect(out).toContain('token=***');
    expect(out).toContain('foo=bar');
  });
});

// detectStreamSource depends on Hls.isSupported() and mpegts.isSupported().
// We mock both to simulate environments without MediaSource (typical Node test).
describe('detectStreamSource', () => {
  it('detects HLS by .m3u8 extension', async () => {
    vi.resetModules();
    vi.doMock('hls.js', () => ({ default: { isSupported: () => true } }));
    vi.doMock('mpegts.js', () => ({ default: { isSupported: () => true } }));
    const { detectStreamSource } = await import('../../components/player/playerUtils');
    const info = detectStreamSource('https://x.test/stream/index.m3u8', 'live');
    expect(info.protocol).toBe('hls');
    expect(info.engine).toBe('hlsjs');
    expect(info.label).toBe('HLS (.m3u8)');
    expect(info.isLive).toBe(true);
  });

  it('detects MPEG-TS for Xtream live without extension', async () => {
    vi.resetModules();
    vi.doMock('hls.js', () => ({ default: { isSupported: () => true } }));
    vi.doMock('mpegts.js', () => ({ default: { isSupported: () => true } }));
    const { detectStreamSource } = await import('../../components/player/playerUtils');
    const info = detectStreamSource('http://srv.test:80/live/user/pass/123', 'live');
    expect(info.protocol).toBe('mpegts');
    expect(info.engine).toBe('mpegts');
    expect(info.isXtreamLike).toBe(true);
    expect(info.isLive).toBe(true);
  });

  it('assumes MP4 for Xtream VOD without extension', async () => {
    vi.resetModules();
    vi.doMock('hls.js', () => ({ default: { isSupported: () => true } }));
    vi.doMock('mpegts.js', () => ({ default: { isSupported: () => true } }));
    const { detectStreamSource } = await import('../../components/player/playerUtils');
    const info = detectStreamSource('http://srv.test/movie/u/p/42', 'movie');
    expect(info.protocol).toBe('mp4');
    expect(info.engine).toBe('videojs');
  });

  it('falls back to videojs engine when hls.js is unsupported', async () => {
    vi.resetModules();
    vi.doMock('hls.js', () => ({ default: { isSupported: () => false } }));
    vi.doMock('mpegts.js', () => ({ default: { isSupported: () => false } }));
    const { detectStreamSource } = await import('../../components/player/playerUtils');
    const info = detectStreamSource('https://x.test/a.m3u8');
    expect(info.protocol).toBe('hls');
    expect(info.engine).toBe('videojs');
  });

  // MED-1 (Step 3-ter): MKV/Matroska riconosciuto come container progressivo.
  it('detects MKV / Matroska VOD URLs', async () => {
    vi.resetModules();
    vi.doMock('hls.js', () => ({ default: { isSupported: () => true } }));
    vi.doMock('mpegts.js', () => ({ default: { isSupported: () => true } }));
    const { detectStreamSource } = await import('../../components/player/playerUtils');
    const a = detectStreamSource('http://srv.test/movie/u/p/42.mkv', 'movie');
    expect(a.protocol).toBe('mkv');
    expect(a.mimeType).toBe('video/x-matroska');
    expect(a.label).toBe('MKV/Matroska');
    const b = detectStreamSource('https://x.test/file.matroska?token=abc');
    expect(b.protocol).toBe('mkv');
  });
});

