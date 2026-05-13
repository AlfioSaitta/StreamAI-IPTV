import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * UI-1.5 — Token contract test.
 *
 * Verifica che ogni CSS custom property dichiarata nel blocco `:root` di
 * `index.css` (sezione DS v1) sia effettivamente referenziata in
 * `tailwind.config.js`. In questo modo:
 * - se cancelliamo un token per errore, il test fallisce;
 * - se aggiungiamo un token senza esporlo come utility Tailwind, il test
 *   ricorda di farlo.
 */

const ROOT = resolve(__dirname, '..', '..');
const indexCss = readFileSync(resolve(ROOT, 'index.css'), 'utf8');
const tailwindConfig = readFileSync(resolve(ROOT, 'tailwind.config.js'), 'utf8');

/**
 * Tokens DS v1 che DEVONO esistere sia in `index.css` sia in
 * `tailwind.config.js`. Vivono in questa lista perché sono l'API pubblica
 * del design system: aggiungerne uno significa farlo intenzionalmente.
 */
const REQUIRED_TOKENS = [
  '--color-brand-primary',
  '--color-brand-primary-hover',
  '--color-brand-accent',
  '--color-brand-accent-hover',
  '--surface-0',
  '--surface-1',
  '--surface-2',
  '--surface-3',
  '--surface-overlay-soft',
  '--surface-overlay-hard',
  '--border-subtle',
  '--border-default',
  '--border-strong',
  '--state-error',
  '--state-warning',
  '--state-success',
  '--state-info',
  '--text-primary',
  '--text-secondary',
  '--text-muted',
  '--text-disabled',
] as const;

/** Token che devono comparire SOLO in index.css (non sono esposti come utility). */
const CSS_ONLY_TOKENS = [
  '--focus-ring',
  '--bg-primary',
  '--safe-top',
];

describe('UI-1 — design system tokens', () => {
  it.each(REQUIRED_TOKENS)('CSS variable %s exists in index.css', (token) => {
    expect(indexCss).toMatch(new RegExp(`${token}\\s*:`));
  });

  it.each(REQUIRED_TOKENS)('tailwind.config.js references %s', (token) => {
    expect(tailwindConfig).toContain(`var(${token})`);
  });

  it.each(CSS_ONLY_TOKENS)('legacy/internal token %s still declared in index.css', (token) => {
    expect(indexCss).toMatch(new RegExp(`${token}\\s*:`));
  });

  it('exposes three component radii (control / card / modal)', () => {
    expect(tailwindConfig).toMatch(/control:\s*'0\.75rem'/);
    expect(tailwindConfig).toMatch(/card:\s*'1rem'/);
    expect(tailwindConfig).toMatch(/modal:\s*'1\.5rem'/);
  });

  it('exposes the icon size scale (xs..xl)', () => {
    for (const size of ['icon-xs', 'icon-sm', 'icon-md', 'icon-lg', 'icon-xl']) {
      expect(tailwindConfig).toContain(`'${size}'`);
    }
  });

  it('OLED theme redeclares the same surface tokens', () => {
    const oledBlock = indexCss.match(/\.theme-oled\s*\{[^}]*}/s);
    expect(oledBlock, 'expected a .theme-oled block in index.css').toBeTruthy();
    const body = oledBlock![0];
    for (const token of ['--surface-0', '--surface-1', '--surface-2', '--surface-3']) {
      expect(body).toMatch(new RegExp(`${token}\\s*:`));
    }
  });
});

