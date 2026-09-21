#!/usr/bin/env node
/**
 * make-nfpm-config.mjs — genera la config nfpm per una singola distro.
 *
 * PERCHÉ ESISTE. nfpm supporta `overrides` solo per *packager*
 * (`deb`/`rpm`/`archlinux`), mai per distro. Ma openSUSE e Fedora sono entrambe
 * rpm con nomi di pacchetto diversi (`libwebkit2gtk-4_1-0` vs `webkit2gtk4.1`),
 * quindi una sola config non può servire entrambe: con i nomi Fedora l'RPM non
 * si installa su openSUSE, che è la distro host di questo progetto.
 *
 * APPROCCIO. `nfpm.yaml` resta la base unica (metadata + contents, con
 * `${VERSION}`/`${RELEASE}` che nfpm espande dall'ambiente). Questo script
 * conserva la testa del file e riscrive da `overrides:` in giù con il blocco
 * del packager giusto. Niente parser YAML e niente `yq`: aggiungere una
 * dipendenza per riscrivere tre righe di lista non si giustifica, e le liste
 * YAML sono troppo facili da rompere con sed.
 *
 * Usage:
 *   node scripts/make-nfpm-config.mjs <distro> [--out <file>]
 *   node scripts/make-nfpm-config.mjs --list
 *
 * Exit: 0 ok · 2 distro sconosciuta o uso errato · 4 packager non-nfpm (tar)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const TABLE = resolve(ROOT, 'build/depends/distros.json');
const BASE = resolve(ROOT, 'nfpm.yaml');

const argv = process.argv.slice(2);
const table = JSON.parse(readFileSync(TABLE, 'utf8')).distros;

if (argv.includes('--list') || argv.includes('-l')) {
  process.stdout.write(Object.keys(table).join('\n') + '\n');
  process.exit(0);
}

const distro = argv.find((a) => !a.startsWith('-'));
if (!distro) {
  console.error('✗ uso: node scripts/make-nfpm-config.mjs <distro> [--out <file>]');
  console.error(`  distro disponibili: ${Object.keys(table).join(', ')}`);
  process.exit(2);
}

const d = table[distro];
if (!d) {
  console.error(`✗ distro sconosciuta: '${distro}'`);
  console.error(`  distro disponibili: ${Object.keys(table).join(', ')}`);
  process.exit(2);
}

if (d.packager === 'tar') {
  // L'archivio portatile non passa da nfpm: lo costruisce build-linux.sh.
  console.error(`✗ '${distro}' usa il packager 'tar', che nfpm non ha. Nessuna config da generare.`);
  process.exit(4);
}

// Quoting YAML sicuro: JSON.stringify produce sempre uno scalare valido in YAML
// (stringa fra doppi apici, con gli escape già corretti).
const q = (s) => JSON.stringify(String(s));

const base = readFileSync(BASE, 'utf8');

// Il taglio è obbligatorio: due blocchi `overrides:` nello stesso documento
// fanno fallire il parsing di nfpm, e il secondo verrebbe ignorato in silenzio.
const cut = base.search(/^overrides:[ \t]*$/m);
const body = cut === -1 ? base : base.slice(0, cut);

// Si scartano i commenti di testa della base: spiegano perché `nfpm.yaml` non va
// usato direttamente, cosa che nella config GENERATA sarebbe falsa (lei è
// esattamente ciò che si passa a `nfpm pkg --config`). La provenienza la dice
// l'intestazione qui sotto.
const head = body
  .split('\n')
  .filter((line, i, all) => {
    // Via il preambolo: righe vuote o commenti prima della prima riga di dati.
    const isPreamble = all.slice(0, i).every((l) => l.trim() === '' || l.trimStart().startsWith('#'));
    return !(isPreamble && (line.trim() === '' || line.trimStart().startsWith('#')));
  })
  .join('\n')
  .trimEnd();

const header = [
  `# GENERATO da scripts/make-nfpm-config.mjs — distro: ${distro} (${d.packager})`,
  `# Fonte: nfpm.yaml (metadata + contents) + build/depends/distros.json (dipendenze).`,
  `# Non modificare a mano: rigenera con \`node scripts/make-nfpm-config.mjs ${distro}\`.`,
  '',
].join('\n');

let out = `${header}${head}\n\noverrides:\n  ${d.packager}:\n`;

if (d.depends?.length) {
  out += '    depends:\n' + d.depends.map((s) => `      - ${q(s)}`).join('\n') + '\n';
}
if (d.recommends?.length) {
  out += '    recommends:\n' + d.recommends.map((s) => `      - ${q(s)}`).join('\n') + '\n';
}

const outIdx = argv.indexOf('--out');
if (outIdx !== -1) {
  const target = argv[outIdx + 1];
  if (!target) {
    console.error('✗ --out richiede un percorso');
    process.exit(2);
  }
  const abs = resolve(ROOT, target);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, out);
  console.log(`  config nfpm: ${target} (packager=${d.packager}, ${d.depends.length} depends)`);
} else {
  process.stdout.write(out);
}
