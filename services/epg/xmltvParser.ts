// XMLTV parser + EPG indexing — D.1 IMPROVEMENT_PLAN_V2.
// Pure functions: no React, no DOM events.

import type { EpgProgramme } from '../../types.ts';

const RE_PROGRAMME = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/gi;
const RE_TITLE = /<title[^>]*>([\s\S]*?)<\/title>/i;
const RE_DESC = /<desc[^>]*>([\s\S]*?)<\/desc>/i;
const RE_CATEGORY = /<category[^>]*>([\s\S]*?)<\/category>/i;
const RE_ATTR = /\b([a-z][\w-]*)\s*=\s*"([^"]*)"/gi;

const ENTITY_MAP: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/**
 * Decode common XML entities — keep it light, full HTML decode is overkill
 * for XMLTV which only escapes &amp; &lt; &gt; &quot; &apos; in practice.
 */
const decodeEntities = (s: string): string =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, name) => ENTITY_MAP[name] ?? `&${name};`);

const extractTag = (block: string, re: RegExp): string | undefined => {
  const m = block.match(re);
  return m && m[1] ? decodeEntities(m[1]).trim() : undefined;
};

/**
 * Parse an XMLTV `start`/`stop` timestamp.
 *
 * Format: `YYYYMMDDHHMMSS [+/-HHMM]` — the timezone offset is optional and
 * may be missing on cheap providers (treated as UTC).
 *
 * Returns epoch milliseconds or `null` on parse failure.
 */
export const parseXmltvDate = (raw: string | undefined): number | null => {
  if (!raw) return null;
  const cleaned = raw.trim();
  // Accept compact form YYYYMMDDHHMMSS optionally followed by +HHMM / -HHMM
  const m = cleaned.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-]\d{4}))?/);
  if (!m) return null;
  const [, Y, Mo, D, H, Mi, S, tz] = m;
  // Use Date.UTC then adjust for the offset that was meant to be the local one.
  const utc = Date.UTC(
    Number(Y),
    Number(Mo) - 1,
    Number(D),
    Number(H),
    Number(Mi),
    Number(S),
  );
  if (!Number.isFinite(utc)) return null;
  if (!tz) return utc;
  const sign = tz[0] === '-' ? 1 : -1; // "+0200" means the wall clock is 2h ahead of UTC
  const tzMinutes = sign * (Number(tz.slice(1, 3)) * 60 + Number(tz.slice(3, 5)));
  return utc + tzMinutes * 60_000;
};

const parseAttrs = (attrString: string): Record<string, string> => {
  const out: Record<string, string> = {};
  let m: RegExpExecArray | null;
  RE_ATTR.lastIndex = 0;
  while ((m = RE_ATTR.exec(attrString)) !== null) {
    out[m[1].toLowerCase()] = m[2];
  }
  return out;
};

/**
 * Streaming-style XMLTV parser: walks `<programme>` blocks via regex (avoids
 * building a full DOM tree for 50MB+ documents) and returns a list of
 * normalized programmes.
 *
 * Returns programmes in document order. Caller is responsible for indexing
 * and pruning past programmes.
 */
export const parseXmltvProgrammes = (xml: string): EpgProgramme[] => {
  if (!xml) return [];
  const programmes: EpgProgramme[] = [];

  let match: RegExpExecArray | null;
  RE_PROGRAMME.lastIndex = 0;
  while ((match = RE_PROGRAMME.exec(xml)) !== null) {
    const attrs = parseAttrs(match[1]);
    const body = match[2];

    const start = parseXmltvDate(attrs.start);
    const stop = parseXmltvDate(attrs.stop);
    const channel = attrs.channel;
    if (!start || !stop || !channel || stop <= start) continue;

    programmes.push({
      channelId: channel,
      start,
      stop,
      title: extractTag(body, RE_TITLE) || '',
      description: extractTag(body, RE_DESC),
      category: extractTag(body, RE_CATEGORY),
    });
  }

  return programmes;
};

