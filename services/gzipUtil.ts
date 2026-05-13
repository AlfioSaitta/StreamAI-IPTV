// Lightweight gzip helper used by the API response cache (E.5).
// Wraps `CompressionStream` / `DecompressionStream` when available and
// falls back to a no-op on environments where they're missing (very old
// WebViews, Node without `node:stream/web` polyfill).

const hasStreams = () =>
  typeof CompressionStream !== 'undefined' &&
  typeof DecompressionStream !== 'undefined';

/** Encode a JSON-serialisable value to a Uint8Array, optionally gzipped. */
export const encodeMaybeGzip = async (
  data: unknown,
  options: { minBytes?: number } = {},
): Promise<{ bytes: Uint8Array; compressed: boolean }> => {
  const minBytes = options.minBytes ?? 4096; // ~4 KB break-even for gzip overhead
  const json = JSON.stringify(data);
  const raw = new TextEncoder().encode(json);
  if (!hasStreams() || raw.byteLength < minBytes) {
    return { bytes: raw, compressed: false };
  }
  try {
    const blob = new Blob([raw.buffer as ArrayBuffer]);
    const stream = blob.stream().pipeThrough(new CompressionStream('gzip'));
    const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
    // Don't bother keeping the compressed copy if the saving is < 5%.
    if (compressed.byteLength > raw.byteLength * 0.95) {
      return { bytes: raw, compressed: false };
    }
    return { bytes: compressed, compressed: true };
  } catch {
    return { bytes: raw, compressed: false };
  }
};

/** Reverse of `encodeMaybeGzip`. Returns the parsed JSON value. */
export const decodeMaybeGzip = async (
  bytes: Uint8Array,
  compressed: boolean,
): Promise<unknown> => {
  let raw: Uint8Array = bytes;
  if (compressed && hasStreams()) {
    try {
      const blob = new Blob([bytes.buffer as ArrayBuffer]);
      const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
      raw = new Uint8Array(await new Response(stream).arrayBuffer());
    } catch (e) {
      throw new Error(`gunzip failed: ${(e as Error).message}`);
    }
  } else if (compressed) {
    throw new Error('Compressed payload but DecompressionStream is unavailable');
  }
  const text = new TextDecoder().decode(raw);
  return JSON.parse(text);
};

export const gzipSupported = hasStreams;

