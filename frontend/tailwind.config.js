/** @type {import('tailwindcss').Config} */
const path = require('node:path');
// Path assoluti: Tailwind v3 risolve i glob rispetto al cwd del processo
// Node, non al file di config; con Vite `root: 'frontend'` il cwd resta
// la root del repo, quindi senza __dirname il content scanning fallirebbe
// e l'output CSS conterrebbe solo il reset (~8 KB) — UI completamente
// senza stile.
const r = (...p) => path.resolve(__dirname, ...p);
module.exports = {
  content: [
    r('index.html'),
    r('App.tsx'),
    r('index.tsx'),
    r('types.ts'),
    r('components/**/*.{js,ts,jsx,tsx}'),
    r('services/**/*.{js,ts,jsx,tsx}'),
    r('hooks/**/*.{js,ts,jsx,tsx}'),
    r('contexts/**/*.{js,ts,jsx,tsx}'),
  ],
  theme: {
    extend: {
      // === StreamAI Design System v1 (UI-1.3.1/1.3.2/1.3.5) =================
      // Tutti i token leggono le CSS variables definite in `index.css`, così
      // i temi (`.theme-oled`, ecc.) possono variarli a runtime senza rebuild.
      colors: {
        brand: {
          DEFAULT: 'var(--color-brand-primary)',
          primary: 'var(--color-brand-primary)',
          'primary-hover': 'var(--color-brand-primary-hover)',
          'primary-press': 'var(--color-brand-primary-press)',
          accent: 'var(--color-brand-accent)',
          'accent-hover': 'var(--color-brand-accent-hover)',
          'accent-press': 'var(--color-brand-accent-press)',
        },
        surface: {
          0: 'var(--surface-0)',
          1: 'var(--surface-1)',
          2: 'var(--surface-2)',
          3: 'var(--surface-3)',
          'overlay-soft': 'var(--surface-overlay-soft)',
          'overlay-hard': 'var(--surface-overlay-hard)',
        },
        state: {
          error: 'var(--state-error)',
          warning: 'var(--state-warning)',
          success: 'var(--state-success)',
          info: 'var(--state-info)',
        },
        content: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
          disabled: 'var(--text-disabled)',
        },
      },
      borderColor: {
        subtle: 'var(--border-subtle)',
        DEFAULT: 'var(--border-default)',
        strong: 'var(--border-strong)',
      },
      borderRadius: {
        // Tre soli radius per i componenti dell'app (UI-1.3.2).
        // `rounded-full` resta consentito per badge/avatar circolari.
        control: '0.75rem', // 12px — input, button, chip
        card: '1rem',       // 16px — card poster, panel info
        modal: '1.5rem',    // 24px — dialog, sheet
      },
      boxShadow: {
        'elev-1': '0 1px 2px rgba(0,0,0,0.4)',
        'elev-2': '0 4px 12px rgba(0,0,0,0.5)',
        'elev-3': '0 12px 32px rgba(0,0,0,0.55)',
        'glow-brand':  '0 0 28px rgba(220,38,38,0.5)',
        'glow-accent': '0 0 28px rgba(168,85,247,0.45)',
      },
      // Scala icone (UI-1.3.5). Esposte come `w-icon-md`, `h-icon-md`, ecc.
      width: {
        'icon-xs': '0.75rem',
        'icon-sm': '1rem',
        'icon-md': '1.25rem',
        'icon-lg': '1.5rem',
        'icon-xl': '2rem',
      },
      height: {
        'icon-xs': '0.75rem',
        'icon-sm': '1rem',
        'icon-md': '1.25rem',
        'icon-lg': '1.5rem',
        'icon-xl': '2rem',
      },
    },
  },
  plugins: [],
}

