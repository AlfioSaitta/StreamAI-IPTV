// Unit tests for the XMLTV parser (D.1 IMPROVEMENT_PLAN_V2).
// Mirrors the structure of the streamInfo / player tests.

import { describe, expect, it } from 'vitest';
import { parseXmltvDate, parseXmltvProgrammes } from '../../services/epg/xmltvParser';

describe('parseXmltvDate', () => {
  it('parses a compact date with +0000 offset (UTC)', () => {
    const ts = parseXmltvDate('20260512100000 +0000');
    expect(ts).toBe(Date.UTC(2026, 4, 12, 10, 0, 0));
  });

  it('parses a date with positive offset (CEST)', () => {
    // 12:00 wall clock at +0200 == 10:00 UTC
    const ts = parseXmltvDate('20260512120000 +0200');
    expect(ts).toBe(Date.UTC(2026, 4, 12, 10, 0, 0));
  });

  it('parses a date with negative offset', () => {
    // 06:00 wall clock at -0500 == 11:00 UTC
    const ts = parseXmltvDate('20260512060000 -0500');
    expect(ts).toBe(Date.UTC(2026, 4, 12, 11, 0, 0));
  });

  it('returns null on garbage input', () => {
    expect(parseXmltvDate(undefined)).toBeNull();
    expect(parseXmltvDate('')).toBeNull();
    expect(parseXmltvDate('not a date')).toBeNull();
    expect(parseXmltvDate('2026/05/12')).toBeNull();
  });

  it('treats missing timezone as UTC', () => {
    const ts = parseXmltvDate('20260512100000');
    expect(ts).toBe(Date.UTC(2026, 4, 12, 10, 0, 0));
  });
});

describe('parseXmltvProgrammes', () => {
  it('returns an empty array for empty / malformed input', () => {
    expect(parseXmltvProgrammes('')).toEqual([]);
    expect(parseXmltvProgrammes('<tv></tv>')).toEqual([]);
  });

  it('parses a basic programme entry', () => {
    const xml = `
      <tv>
        <programme start="20260512100000 +0000" stop="20260512113000 +0000" channel="bbc1.uk">
          <title>News</title>
          <desc>Daily bulletin</desc>
          <category>Information</category>
        </programme>
      </tv>
    `;
    const result = parseXmltvProgrammes(xml);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      channelId: 'bbc1.uk',
      title: 'News',
      description: 'Daily bulletin',
      category: 'Information',
    });
    expect(result[0].stop).toBeGreaterThan(result[0].start);
  });

  it('decodes XML entities and CDATA in titles/descriptions', () => {
    const xml = `
      <programme start="20260512100000 +0000" stop="20260512110000 +0000" channel="ch">
        <title>Tom &amp; Jerry</title>
        <desc><![CDATA[Long & wild adventure]]></desc>
      </programme>
    `;
    const result = parseXmltvProgrammes(xml);
    expect(result[0].title).toBe('Tom & Jerry');
    expect(result[0].description).toBe('Long & wild adventure');
  });

  it('skips programmes with missing/invalid times', () => {
    const xml = `
      <programme start="" stop="20260512110000 +0000" channel="ch">
        <title>Bad start</title>
      </programme>
      <programme start="20260512120000 +0000" stop="20260512110000 +0000" channel="ch">
        <title>Inverted</title>
      </programme>
      <programme start="20260512100000 +0000" stop="20260512110000 +0000" channel="">
        <title>No channel</title>
      </programme>
    `;
    expect(parseXmltvProgrammes(xml)).toEqual([]);
  });

  it('parses multiple programmes preserving document order', () => {
    const xml = `
      <programme start="20260512100000 +0000" stop="20260512110000 +0000" channel="ch1">
        <title>A</title>
      </programme>
      <programme start="20260512110000 +0000" stop="20260512120000 +0000" channel="ch1">
        <title>B</title>
      </programme>
      <programme start="20260512110000 +0000" stop="20260512120000 +0000" channel="ch2">
        <title>C</title>
      </programme>
    `;
    const result = parseXmltvProgrammes(xml);
    expect(result.map(p => p.title)).toEqual(['A', 'B', 'C']);
    expect(result.map(p => p.channelId)).toEqual(['ch1', 'ch1', 'ch2']);
  });

  it('handles single-quoted attributes loosely (regex is double-quote only — should fail gracefully)', () => {
    // XMLTV spec uses double quotes; single quotes are technically invalid.
    // We just want to make sure the parser doesn't throw or pick garbage.
    const xml = `<programme start='20260512100000 +0000' stop='20260512110000 +0000' channel='ch'><title>X</title></programme>`;
    const result = parseXmltvProgrammes(xml);
    expect(result).toEqual([]);
  });
});

