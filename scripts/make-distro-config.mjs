#!/usr/bin/env node
/**
 * Generate a per-distro electron-builder config by merging the base "build"
 * section from package.json with the native package names for the requested
 * Linux distribution.
 *
 * Usage:
 *   node scripts/make-distro-config.mjs <distro> <target> [--commit <sha>]
 *
 *   distro  opensuse | fedora | rhel | debian | ubuntu | arch
 *   target  rpm | deb | pacman
 *   --commit <sha>  optional short commit SHA injected into the artefact
 *                   filename so CI builds carry build provenance, e.g.
 *                   streamai-iptv_1.0.0_276ee32_debian_amd64.deb
 *
 * The script:
 *   - Loads package.json -> build
 *   - Loads build/depends/<distro>.json
 *   - Replaces build[target].depends with the distro-specific array
 *   - Injects a distro-tagged artifactName using underscore separators
 *     so the produced files match Debian's `${name}_${version}_…` style
 *     and embed the distro identifier + (optional) commit
 *   - Writes the result to stdout
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const argv = process.argv.slice(2);
const [distro, target] = argv;
if (!distro || !target) {
  console.error('Usage: make-distro-config.mjs <distro> <target> [--commit <sha>]');
  process.exit(2);
}
let commit = '';
const ci = argv.indexOf('--commit');
if (ci >= 0 && argv[ci + 1]) {
  commit = argv[ci + 1].trim().slice(0, 7);
}

const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
const base = structuredClone(pkg.build || {});

const dependsPath = resolve(ROOT, 'build/depends', `${distro}.json`);
let dependsMap;
try {
  dependsMap = JSON.parse(readFileSync(dependsPath, 'utf8'));
} catch (e) {
  console.error(`✗ Cannot read ${dependsPath}: ${e.message}`);
  process.exit(3);
}

const list = dependsMap[target];
if (!Array.isArray(list)) {
  console.error(`✗ ${distro}.json has no '${target}' depends array`);
  process.exit(4);
}

base[target] = { ...(base[target] || {}), depends: list };

// Build the artefact filename. Underscore-separated, distro-tagged, with an
// optional commit segment between version and distro:
//
//   streamai-iptv_1.0.0_<distro>_<arch>.<ext>             (local)
//   streamai-iptv_1.0.0_<commit>_<distro>_<arch>.<ext>    (CI)
const ext = target === 'pacman' ? 'pkg.tar.zst' : target;
const commitSeg = commit ? `_${commit}` : '';
base[target].artifactName = `\${name}_\${version}${commitSeg}_${distro}_\${arch}.${ext}`;

process.stdout.write(JSON.stringify(base, null, 2));

