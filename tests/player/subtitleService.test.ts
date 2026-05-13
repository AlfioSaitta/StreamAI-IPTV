// Tests for services/subtitleService — D.4 sideload SRT/VTT.

import { describe, expect, it } from 'vitest';
import {
  detectSubtitleFormat,
  normaliseVtt,
  srtToVtt,
} from '../../services/subtitleService';

const SAMPLE_SRT = `1
00:00:01,000 --> 00:00:03,500
Hello world

2
00:01:23,456 --> 00:01:25,000
Second cue
on two lines

3
00:02:00,000 --> 00:02:02,000
Third`;

describe('srtToVtt', () => {
  it('converts a well-formed SRT body to VTT', () => {
    const vtt = srtToVtt(SAMPLE_SRT);
    expect(vtt.startsWith('WEBVTT')).toBe(true);
    expect(vtt).toContain('00:00:01.000 --> 00:00:03.500');
    expect(vtt).toContain('Hello world');
    expect(vtt).toContain('00:01:23.456 --> 00:01:25.000');
    expect(vtt).toContain('Second cue\non two lines');
    expect(vtt).toContain('00:02:00.000 --> 00:02:02.000');
  });

  it('handles CRLF line endings and BOM', () => {
    const crlf = '\uFEFF1\r\n00:00:01,000 --> 00:00:02,000\r\nHi\r\n';
    const vtt = srtToVtt(crlf);
    expect(vtt).toContain('00:00:01.000 --> 00:00:02.000');
    expect(vtt).toContain('Hi');
  });

  it('skips malformed cues without throwing', () => {
    const broken = `1
not-a-timestamp
Skip me

2
00:00:05,000 --> 00:00:06,000
Keep me`;
    const vtt = srtToVtt(broken);
    expect(vtt).not.toContain('Skip me');
    expect(vtt).toContain('Keep me');
  });

  it('accepts timestamps with a dot instead of comma', () => {
    const dotted = `1
00:00:01.000 --> 00:00:02.000
Hi`;
    expect(srtToVtt(dotted)).toContain('00:00:01.000 --> 00:00:02.000');
  });

  it('produces exactly one cue header per cue', () => {
    const vtt = srtToVtt(SAMPLE_SRT);
    const matches = vtt.match(/-->/g) ?? [];
    expect(matches.length).toBe(3);
  });
});

describe('normaliseVtt', () => {
  it('returns the body untouched when WEBVTT header is present', () => {
    const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi\n';
    expect(normaliseVtt(vtt)).toBe(vtt);
  });

  it('prepends WEBVTT header when missing', () => {
    const broken = '00:00:01.000 --> 00:00:02.000\nHi';
    expect(normaliseVtt(broken).startsWith('WEBVTT')).toBe(true);
  });

  it('strips BOM and normalises CRLF', () => {
    const crlf = '\uFEFFWEBVTT\r\n\r\n00:00:01.000 --> 00:00:02.000\r\nHi\r\n';
    const out = normaliseVtt(crlf);
    expect(out.startsWith('WEBVTT')).toBe(true);
    expect(out).not.toContain('\r');
  });
});

describe('detectSubtitleFormat', () => {
  it('detects .srt by extension', () => {
    expect(detectSubtitleFormat('movie.it.srt', '')).toBe('srt');
  });
  it('detects .vtt by extension', () => {
    expect(detectSubtitleFormat('movie.vtt', '')).toBe('vtt');
  });
  it('falls back to content sniffing', () => {
    expect(detectSubtitleFormat('mystery.txt', 'WEBVTT\n')).toBe('vtt');
    expect(detectSubtitleFormat('mystery.txt', '1\n00:00:01,000 --> 00:00:02,000\nHi')).toBe('srt');
    expect(detectSubtitleFormat('mystery.txt', 'random text')).toBe('unknown');
  });
});

