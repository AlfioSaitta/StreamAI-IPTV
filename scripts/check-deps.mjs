#!/usr/bin/env node
/**
 * check-deps.mjs — Dependency hygiene guard (TEST-1 §2-bis).
 *
 * Enforces that a few critical peer/companion dependencies are declared
 * explicitly in package.json so we never regress to a half-installed
 * testing toolchain (e.g. @testing-library/react without
 * @testing-library/dom, which makes 6 suites explode at import time).
 *
 * Add a new rule to RULES below when discovering similar foot-guns.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(__dirname, '..', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

const allDeps = {
  ...(pkg.dependencies || {}),
  ...(pkg.devDependencies || {}),
  ...(pkg.optionalDependencies || {}),
};

/**
 * Each rule: if `when` is present, then `require` must also be present.
 * `reason` is shown to the developer on failure.
 */
const RULES = [
  {
    when: '@testing-library/react',
    require: ['@testing-library/dom', '@testing-library/jest-dom'],
    reason:
      '@testing-library/react@>=16 made @testing-library/dom an *external* peer ' +
      'dependency. Without it, every render() call throws ' +
      '"Cannot find module \'@testing-library/dom\'" and 6+ suites fail.',
  },
];

const errors = [];
for (const rule of RULES) {
  if (!allDeps[rule.when]) continue;
  for (const dep of rule.require) {
    if (!allDeps[dep]) {
      errors.push(
        `Missing companion dependency: "${dep}" is required because ` +
          `"${rule.when}" is installed.\n  → ${rule.reason}\n` +
          `  Fix: add "${dep}" to devDependencies and run ` +
          `\`npm install --legacy-peer-deps\`.`,
      );
    }
  }
}

if (errors.length > 0) {
  console.error('❌ check-deps: dependency hygiene violations detected\n');
  for (const e of errors) console.error('  • ' + e + '\n');
  process.exit(1);
}

console.log('✓ check-deps: all companion dependencies declared.');

