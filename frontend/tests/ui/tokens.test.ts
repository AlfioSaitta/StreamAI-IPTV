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

describe('UI-1.4 — accessibility contract', () => {
  it('tv-focus uses outline + outline-offset (focus ring stays outside element)', () => {
    // Block must contain both `outline:` and `outline-offset:` declarations
    // so the focus ring never overlaps the element border (dense lists).
    const tvFocusFocused = indexCss.match(
      /\.tv-focus:focus-visible[\s\S]*?\{[\s\S]*?box-shadow:\s*var\(--focus-ring\)/,
    );
    expect(tvFocusFocused, 'expected .tv-focus:focus-visible rule').toBeTruthy();
    expect(tvFocusFocused![0]).toMatch(/outline:\s*2px\s+solid/);
    expect(tvFocusFocused![0]).toMatch(/outline-offset:\s*\d+px/);
  });

  it('tv-focus-dense also uses outline-offset (parity)', () => {
    const dense = indexCss.match(
      /\.tv-focus-dense:focus-visible[\s\S]*?\{[\s\S]*?outline-offset:/,
    );
    expect(dense, 'expected .tv-focus-dense:focus-visible with outline-offset').toBeTruthy();
  });

  it('prefers-reduced-motion disables scale + animate-* + skeleton', () => {
    const mq = indexCss.match(
      /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)\s*\{[\s\S]*?\n\s{0,4}\}\s*\n\s{0,4}\}/,
    );
    expect(mq, 'expected a prefers-reduced-motion: reduce block').toBeTruthy();
    const body = mq![0];
    expect(body).toMatch(/\.tv-focus[^,{]*[,{][\s\S]*scale-100/);
    expect(body).toMatch(/animate-pulse/);
    expect(body).toMatch(/animate-fade-in/);
    expect(body).toMatch(/animate-slide-up/);
    expect(body).toMatch(/\.skeleton/);
  });

  it('--text-disabled passes WCAG AA on dark surface (>= 4.5:1 vs surface-0)', () => {
    // surface-0 = #141414. Disabled must remain readable as a fallback even
    // though WCAG technically exempts disabled controls (UI-1.4 audit).
    const match = indexCss.match(/--text-disabled:\s*(#[0-9a-fA-F]{3,8})/);
    expect(match, 'expected --text-disabled token').toBeTruthy();
    const hex = match![1];
    const ratio = contrastRatio(hex, '#141414');
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('--text-muted passes WCAG AA on dark surface', () => {
    const match = indexCss.match(/--text-muted:\s*(#[0-9a-fA-F]{3,8})/);
    expect(match).toBeTruthy();
    expect(contrastRatio(match![1], '#141414')).toBeGreaterThanOrEqual(4.5);
  });
});

// --- helpers --------------------------------------------------------------

function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  const [a, b] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (a + 0.05) / (b + 0.05);
}

/**
 * `transition-all` su una classe ripetuta centinaia di volte non è una scelta
 * stilistica: è un costo. `.tv-focus` sta su ogni card del catalogo, e nel CSS
 * compilato viene emessa dopo le utility di Tailwind, quindi vinceva anche sul
 * `transition-transform` scritto sulla card — cioè *tutte* le proprietà
 * animabili venivano ricontrollate a ogni ricalcolo di stile.
 *
 * Queste due verifiche difendono la proprietà che conta: che l'elenco resti
 * esplicito e che contenga `transform`, senza il quale si perderebbe
 * l'ingrandimento al focus (`scale-105` compila in `transform`).
 */
describe('F5 — transizioni delle classi di focus', () => {
  // I commenti si tolgono prima di guardare: il blocco di `.tv-focus` *spiega*
  // perché `transition-all` è stato tolto, e il nome compare nella prosa.
  // Qui interessano le dichiarazioni, non la documentazione.
  const senzaCommenti = indexCss.replace(/\/\*[\s\S]*?\*\//g, '');

  const bloccoDi = (classe: string): string => {
    const m = senzaCommenti.match(new RegExp(`\\${classe}\\s*\\{[^}]*\\}`));
    expect(m, `atteso un blocco ${classe} in index.css`).toBeTruthy();
    return m![0];
  };

  it('tv-focus non usa transition-all', () => {
    const blocco = bloccoDi('.tv-focus');
    expect(blocco).not.toMatch(/transition-all/);
    expect(blocco).not.toMatch(/transition-property:\s*all/);
  });

  it('tv-focus elenca le proprietà e include transform', () => {
    const elenco = bloccoDi('.tv-focus').match(/transition-property:\s*([^;]+);/);
    expect(elenco, 'atteso un transition-property esplicito').toBeTruthy();
    const proprieta = elenco![1].split(',').map(p => p.trim());
    expect(proprieta).toContain('transform');
    // Le proprietà che cambiano davvero su questi elementi fra hover e focus.
    for (const p of ['background-color', 'color', 'box-shadow']) {
      expect(proprieta, `manca ${p}`).toContain(p);
    }
  });
});

function relativeLuminance(hex: string): number {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const toLin = (c: number) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
}

