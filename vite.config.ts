import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Layout post-ristrutturazione (vedi docs/plan-go-wails-migration.md 2.1):
//   - `frontend/`  contiene TUTTO il codice React/TS (sorgenti, index.html,
//     tailwind/postcss config, tests, public/, services/, hooks/, ...).
//   - Vite usa `frontend/` come project-root: legge `frontend/index.html`,
//     `frontend/postcss.config.js`, `frontend/tailwind.config.js` e produce
//     l'output in `frontend/dist/` (poi embeddato da `assets.go` per Wails v3
//     e caricato da Electron via `loadFile('frontend/dist/index.html')`).
//   - `package.json` resta a root perch condivide il toolchain tra Electron
//     legacy, Wails build (Taskfile) e Vite/Vitest.
export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname, 'frontend'),
  base: './', // Percorsi relativi: richiesto sia da Electron che da Wails embed.
  publicDir: path.resolve(__dirname, 'frontend/public'),
  build: {
    outDir: path.resolve(__dirname, 'frontend/dist'),
    emptyOutDir: true,
  },
});