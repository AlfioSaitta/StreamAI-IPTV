#!/usr/bin/env node
/**
 * MED-1 CI guard — fallisce se trova residui dell'API ExoPlayer 2 (deprecata)
 * dopo la migrazione a AndroidX Media3 1.10.1.
 *
 * Verifica:
 *  - Nessun import `com.google.android.exoplayer2.*` in `android/plugins/`.
 *  - Nessun riferimento a `MediaSessionCompat` / `MediaSessionConnector` /
 *    `StyledPlayerView` / `DefaultDataSourceFactory` (vecchio costruttore)
 *    al di fuori dei commenti.
 *
 * Vedi docs/IMPROVEMENT_PLAN.md §4-bis (MED-1).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const SCAN_DIRS = [
  join(ROOT, 'android', 'plugins'),
  join(ROOT, 'android', 'app', 'src'),
];
const SCAN_EXTS = ['.java', '.kt', '.xml', '.gradle'];
const FORBIDDEN = [
  { pattern: /\bcom\.google\.android\.exoplayer2\b/, label: 'com.google.android.exoplayer2.*' },
  { pattern: /\bMediaSessionCompat\b/, label: 'MediaSessionCompat (sostituire con androidx.media3.session.MediaSession)' },
  { pattern: /\bMediaSessionConnector\b/, label: 'MediaSessionConnector (sostituire con androidx.media3.session.MediaSession)' },
  { pattern: /\bStyledPlayerView\b/, label: 'StyledPlayerView (sostituire con androidx.media3.ui.PlayerView)' },
  { pattern: /\bDefaultDataSourceFactory\b/, label: 'DefaultDataSourceFactory (sostituire con androidx.media3.datasource.DefaultDataSource.Factory)' },
];

/** Rimuove commenti Java/Kotlin/Gradle e XML (block + line) riga per riga. */
function stripComments(text, ext) {
  // XML
  if (ext === '.xml') {
    return text.replace(/<!--[\s\S]*?-->/g, '');
  }
  // Java/Kotlin/Gradle: strip block + line comments.
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name === 'build' || name === '.gradle' || name === 'node_modules') continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else if (SCAN_EXTS.some((e) => full.endsWith(e))) yield full;
  }
}

const violations = [];
for (const root of SCAN_DIRS) {
  for (const file of walk(root)) {
    const ext = SCAN_EXTS.find((e) => file.endsWith(e));
    const text = stripComments(readFileSync(file, 'utf8'), ext);
    for (const { pattern, label } of FORBIDDEN) {
      const m = text.match(pattern);
      if (m) {
        // Trova il numero di riga sulla sorgente originale per UX migliore.
        const original = readFileSync(file, 'utf8').split('\n');
        const lineIdx = original.findIndex((l) => pattern.test(l.replace(/\/\/.*$/, '')));
        violations.push({ file: file.replace(ROOT + '/', ''), line: lineIdx + 1, label });
      }
    }
  }
}

if (violations.length > 0) {
  console.error('\n❌ MED-1 guard failed — trovati riferimenti API legacy ExoPlayer 2:');
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line || '?'} → ${v.label}`);
  }
  console.error(
    '\nVedi docs/IMPROVEMENT_PLAN.md §4-bis (MED-1) per la mappa di migrazione.'
  );
  process.exit(1);
}

console.log('✅ MED-1 guard OK — nessun residuo ExoPlayer 2 trovato.');

