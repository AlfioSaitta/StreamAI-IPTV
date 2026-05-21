#!/usr/bin/env node
// scripts/check-i18n.mjs
// B.3 — i18n key consistency checker.
//
// Loads every locale in frontend/services/locales/ and verifies that all
// dictionaries have exactly the same set of keys as the Italian reference.
// Exits with non-zero status on any drift, so it can be wired into CI/pre-commit.
//
// Usage: `node scripts/check-i18n.mjs`

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const localesDir = path.resolve(__dirname, '../frontend/services/locales');

const files = fs
  .readdirSync(localesDir)
  .filter((f) => f.endsWith('.ts'))
  .sort();

/**
 * Naive TS object literal parser tuned for our auto-generated locale files
 * (single top-level `const X: Translations = { ... };`). Captures every
 * top-level `key: 'value',` line (ignores comments and blank lines).
 */
function extractKeys(source) {
  const keys = new Set();
  const lines = source.split('\n');
  let inObject = false;
  let depth = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!inObject) {
      if (/^const\s+\w+:\s*Translations\s*=\s*\{\s*$/.test(line) || /^const\s+\w+:\s*Translations\s*=\s*\{$/.test(line)) {
        inObject = true;
        depth = 1;
      }
      continue;
    }
    if (line.startsWith('//')) continue;
    for (const ch of line) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    if (depth <= 0) break;
    const match = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:/);
    if (match) keys.add(match[1]);
  }
  return keys;
}

const dicts = new Map();
for (const file of files) {
  const lang = file.replace(/\.ts$/, '');
  const source = fs.readFileSync(path.join(localesDir, file), 'utf8');
  dicts.set(lang, extractKeys(source));
}

const reference = dicts.get('it');
if (!reference) {
  console.error('[check-i18n] missing reference locale frontend/services/locales/it.ts');
  process.exit(2);
}

let drift = 0;
for (const [lang, keys] of dicts) {
  if (lang === 'it') continue;
  const missing = [...reference].filter((k) => !keys.has(k));
  const extra = [...keys].filter((k) => !reference.has(k));
  if (missing.length || extra.length) {
    drift++;
    console.error(`\n[check-i18n] ${lang} drift:`);
    if (missing.length) console.error(`  missing (${missing.length}): ${missing.join(', ')}`);
    if (extra.length) console.error(`  extra   (${extra.length}): ${extra.join(', ')}`);
  }
}

if (drift > 0) {
  console.error(`\n[check-i18n] FAIL — ${drift} locale(s) drifted from 'it'.`);
  process.exit(1);
} else {
  console.log(`[check-i18n] OK — ${dicts.size} locales, ${reference.size} keys, no drift.`);
}

