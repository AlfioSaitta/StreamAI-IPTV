#!/usr/bin/env node
/**
 * Single source of truth for the StreamAI version number.
 *
 * Reads `/.version` (a plain text file containing the semantic base version,
 * e.g. `1.0.0`) and propagates it to every other place that needs to know
 * the version:
 *
 *   - package.json → version
 *   - android/app/build.gradle → versionName "x.y.z"
 *   - android/app/build.gradle → versionCode <integer> (derived from
 *     x*10000 + y*100 + z; never decreases as long as components grow)
 *
 * In CI the *full* version printed by --print-full appends a short commit
 * SHA so that artefact filenames carry the build provenance, e.g.
 *
 *     streamai-iptv_1.0.0_276ee32_debian_amd64.deb
 *
 * Without modifying the base value tracked in `.version`. The commit
 * segment is read from $COMMIT_SHA, $GITHUB_SHA, or `git rev-parse HEAD`
 * in that order.
 *
 * Usage:
 *   node scripts/sync-version.mjs                 # write base into package.json + gradle
 *   node scripts/sync-version.mjs --print         # print base version (x.y.z)
 *   node scripts/sync-version.mjs --print-full    # print base[_<sha7>]
 *   node scripts/sync-version.mjs --print-commit  # print short commit (or empty)
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const VERSION_FILE = resolve(ROOT, '.version');
if (!existsSync(VERSION_FILE)) {
  console.error(`✗ Missing source of truth at ${VERSION_FILE}`);
  process.exit(2);
}
const base = readFileSync(VERSION_FILE, 'utf8').trim();
if (!/^\d+\.\d+\.\d+$/.test(base)) {
  console.error(`✗ .version must contain a strict 'x.y.z' literal, got '${base}'`);
  process.exit(3);
}

function shortSha() {
  const env = process.env.COMMIT_SHA || process.env.GITHUB_SHA || '';
  if (env) return env.slice(0, 7);
  try {
    return execSync('git rev-parse --short=7 HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
  } catch {
    return '';
  }
}

const argv = process.argv.slice(2);

if (argv.includes('--print')) {
  process.stdout.write(base + '\n');
  process.exit(0);
}
if (argv.includes('--print-commit')) {
  process.stdout.write(shortSha() + '\n');
  process.exit(0);
}
if (argv.includes('--print-full')) {
  const sha = shortSha();
  process.stdout.write((sha ? `${base}_${sha}` : base) + '\n');
  process.exit(0);
}

// ---- Sync to package.json -------------------------------------------------
const pkgPath = resolve(ROOT, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
if (pkg.version !== base) {
  pkg.version = base;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`✓ package.json version → ${base}`);
} else {
  console.log(`= package.json version already at ${base}`);
}

// ---- Sync to android/app/build.gradle -------------------------------------
const gradle = resolve(ROOT, 'android/app/build.gradle');
if (existsSync(gradle)) {
  const [maj, min, pat] = base.split('.').map(Number);
  const code = maj * 10000 + min * 100 + pat;
  let txt = readFileSync(gradle, 'utf8');
  let changed = false;
  const nameRe = /versionName\s+(['"])[^'"]*\1/;
  const codeRe = /versionCode\s+\d+/;
  if (nameRe.test(txt)) {
    const newTxt = txt.replace(nameRe, `versionName "${base}"`);
    if (newTxt !== txt) { txt = newTxt; changed = true; }
  }
  if (codeRe.test(txt)) {
    const newTxt = txt.replace(codeRe, `versionCode ${code}`);
    if (newTxt !== txt) { txt = newTxt; changed = true; }
  }
  if (changed) {
    writeFileSync(gradle, txt);
    console.log(`✓ android/app/build.gradle → versionName "${base}" / versionCode ${code}`);
  } else {
    console.log(`= android/app/build.gradle already in sync`);
  }
}

const fullSha = shortSha();
if (fullSha) {
  console.log(`ℹ effective build version: ${base}_${fullSha}`);
} else {
  console.log(`ℹ effective build version: ${base} (no commit in CI/git context)`);
}

