#!/usr/bin/env node
/**
 * Generate a per-distro electron-builder config by merging the base "build"
 * section from package.json with the native package names for the requested
 * Linux distribution.
 *
 * Usage:
 *   node scripts/make-distro-config.mjs <distro> <target> > /tmp/eb.json
 *
 *   distro  opensuse | fedora | rhel | debian | ubuntu | arch
 *   target  rpm | deb | pacman
 *
 * The script:
 *   - Loads package.json -> build
 *   - Loads build/depends/<distro>.json
 *   - Replaces build[target].depends with the distro-specific array
 *   - Injects a distro-tagged artifactName so the output file name carries
 *     the distro identifier (streamai-1.0.0-opensuse.x86_64.rpm, etc.)
 *   - Writes the result to stdout
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const [distro, target] = process.argv.slice(2);
if (!distro || !target) {
  console.error('Usage: make-distro-config.mjs <distro> <target>');
  process.exit(2);
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

// Tag the produced artefact name with the distro identifier so that users
// (and the publish-repo script) can distinguish per-distro builds without
// inspecting the depends metadata.
const ext = target === 'pacman' ? 'pkg.tar.zst' : target;
base[target].artifactName = `\${name}-\${version}-${distro}.\${arch}.${ext}`;

process.stdout.write(JSON.stringify(base, null, 2));

