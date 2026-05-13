// Subtitle service: sideload SRT/VTT files into the web player.
// Singleton holding the currently active subtitle source as a Blob URL,
// plus pure parsers usable from tests.
//
// Scope (MVP, D.4 first slice — 2026-05-13):
//  - SRT → VTT conversion (most common community-shared format).
//  - VTT pass-through with light validation.
//  - One active track at a time. No styling options yet.
//  - No persistence across reloads (user re-selects file per session).

const SRT_TIME_RE = /^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})$/;

const padMs = (ms: string): string => (ms + '000').slice(0, 3);

/**
 * Convert a single SRT timestamp to a VTT timestamp.
 * "00:01:23,456" → "00:01:23.456"
 */
const srtTimeToVtt = (raw: string): string | null => {
  const m = SRT_TIME_RE.exec(raw.trim());
  if (!m) return null;
  const [, hh, mm, ss, ms] = m;
  return `${hh.padStart(2, '0')}:${mm}:${ss}.${padMs(ms)}`;
};

/**
 * Parse an SRT file body and return a WebVTT body.
 * Tolerant: skips malformed cues instead of throwing, strips BOM,
 * normalises CRLF and tab separators.
 */
export const srtToVtt = (srt: string): string => {
  const text = srt.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  const blocks = text.split(/\n\s*\n/);
  const cues: string[] = [];

  for (const block of blocks) {
    const lines = block.split('\n').filter(l => l.length > 0);
    if (lines.length < 2) continue;

    // First line might be a cue number; second line should be the timing.
    let timingLine = lines[0];
    let payloadStart = 1;
    if (!/-->/.test(timingLine)) {
      timingLine = lines[1];
      payloadStart = 2;
    }
    if (!/-->/.test(timingLine)) continue;

    const parts = timingLine.split(/\s*-->\s*/);
    if (parts.length !== 2) continue;
    const startStr = parts[0].trim();
    const endStr = parts[1].split(/\s+/)[0].trim(); // strip positioning hints
    const start = srtTimeToVtt(startStr);
    const end = srtTimeToVtt(endStr);
    if (!start || !end) continue;

    const payload = lines.slice(payloadStart).join('\n').trim();
    if (!payload) continue;

    cues.push(`${start} --> ${end}\n${payload}`);
  }

  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
};

/**
 * Light VTT validation — ensures the header is present, normalises CRLF.
 * Does NOT attempt to fix invalid timings; the browser will reject those.
 */
export const normaliseVtt = (vtt: string): string => {
  const text = vtt.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (/^WEBVTT/.test(text.trim())) return text;
  // Pretend a missing header — prepend one to be tolerant.
  return `WEBVTT\n\n${text.trim()}\n`;
};

export type SubtitleFormat = 'srt' | 'vtt' | 'unknown';

export const detectSubtitleFormat = (filename: string, content: string): SubtitleFormat => {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.vtt')) return 'vtt';
  if (lower.endsWith('.srt')) return 'srt';
  // Content sniffing fallback.
  if (/^\s*WEBVTT/i.test(content)) return 'vtt';
  if (/-->/m.test(content) && /\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}/.test(content)) return 'srt';
  return 'unknown';
};

export interface ActiveSubtitle {
  id: string;
  label: string;
  format: SubtitleFormat;
  /** Blob URL pointing at the VTT body. Caller is responsible for revoking
   *  it when the subtitle is replaced or detached. */
  blobUrl: string;
  /** Approximate cue count, for diagnostics. */
  cueCount: number;
}

const countCues = (vtt: string): number => {
  const matches = vtt.match(/-->/g);
  return matches ? matches.length : 0;
};

/**
 * Read a File picked by the user, convert to VTT, return an ActiveSubtitle.
 * The Blob URL must be revoked by the caller (or `subtitleService.detach()`).
 */
export const loadSubtitleFromFile = async (file: File): Promise<ActiveSubtitle> => {
  const text = await file.text();
  const format = detectSubtitleFormat(file.name, text);
  let vtt: string;
  if (format === 'srt') vtt = srtToVtt(text);
  else if (format === 'vtt') vtt = normaliseVtt(text);
  else throw new Error(`Formato sottotitoli non riconosciuto: ${file.name}`);
  const blob = new Blob([vtt], { type: 'text/vtt' });
  return {
    id: `sub-${Date.now()}`,
    label: file.name.replace(/\.[^.]+$/, ''),
    format,
    blobUrl: URL.createObjectURL(blob),
    cueCount: countCues(vtt),
  };
};

class SubtitleServiceImpl {
  private active: ActiveSubtitle | null = null;

  getActive(): ActiveSubtitle | null { return this.active; }

  setActive(sub: ActiveSubtitle | null): void {
    if (this.active && this.active.blobUrl !== sub?.blobUrl) {
      try { URL.revokeObjectURL(this.active.blobUrl); } catch { /* noop */ }
    }
    this.active = sub;
  }

  detach(): void {
    if (this.active) {
      try { URL.revokeObjectURL(this.active.blobUrl); } catch { /* noop */ }
    }
    this.active = null;
  }
}

export const subtitleService = new SubtitleServiceImpl();

