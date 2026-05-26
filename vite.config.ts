import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { sentryVitePlugin } from "@sentry/vite-plugin";

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
  plugins: [
    react(),
    // Put the Sentry vite plugin after all other plugins
    sentryVitePlugin({
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      disable: !process.env.SENTRY_AUTH_TOKEN,
      release: {
        name: process.env.APP_VERSION || 'dev',
      },
      telemetry: false,
    }),
  ],
  root: path.resolve(__dirname, 'frontend'),
  base: './', // Percorsi relativi: richiesto sia da Electron che da Wails embed.
  publicDir: path.resolve(__dirname, 'frontend/public'),
  build: {
    outDir: path.resolve(__dirname, 'frontend/dist'),
    emptyOutDir: true,
    sourcemap: true, // Generate source maps for Sentry
  },
});