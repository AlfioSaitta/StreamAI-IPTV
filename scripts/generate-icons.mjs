#!/usr/bin/env node
/**
 * Generate multi-size PNG icons for Linux desktop integration.
 *
 * Reads ../icon.png (1024x1024 expected) and writes resized variants into
 * ../build/icons/. Sizes match the hicolor freedesktop spec consumed by
 * electron-builder when build.linux.icon points to a directory.
 *
 * Requires `sharp` (optionalDevDependency). If sharp is not installed the
 * script falls back to copying icon.png into 512x512.png so electron-builder
 * can still auto-generate the remaining sizes at packaging time.
 */
import { mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');
const SRC = resolve(ROOT, 'icon.png');
const OUT_DIR = resolve(ROOT, 'build/icons');
const SIZES = [16, 32, 48, 64, 128, 256, 512];

if (!existsSync(SRC)) {
  console.error(`[generate-icons] Source icon not found: ${SRC}`);
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });

let sharp;
try {
  ({ default: sharp } = await import('sharp'));
} catch {
  console.warn('[generate-icons] sharp not installed — falling back to single 512x512 copy.');
  copyFileSync(SRC, resolve(OUT_DIR, '512x512.png'));
  process.exit(0);
}

await Promise.all(
  SIZES.map(async (size) => {
    const out = resolve(OUT_DIR, `${size}x${size}.png`);
    await sharp(SRC).resize(size, size, { fit: 'contain' }).png({ compressionLevel: 9 }).toFile(out);
    console.log(`[generate-icons] ${size}x${size}.png`);
  })
);

console.log(`[generate-icons] Done → ${OUT_DIR}`);

