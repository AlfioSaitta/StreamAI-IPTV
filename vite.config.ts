import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './', // Ensure relative paths for Electron file:// protocol
  define: {
    // Shim process.env.API_KEY directly to avoid object reference issues
    'process.env.API_KEY': JSON.stringify(process.env.API_KEY || '')
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // E.1 — Code splitting strategy:
    //
    // Manual `manualChunks` was tried and rolled back because it broke the
    // evaluation order between video.js and its plugins (runtime error
    // "Class extends value undefined" in the Electron renderer).
    //
    // Current approach (works with Rollup default chunking):
    // `App.tsx` lazy-imports every heavy component via `React.lazy`:
    //   VideoPlayerNew (video.js + hls.js + mpegts.js), ProfileSettings,
    //   GuideView, MovieDetail, SeriesDetail, AIRecommender, XtreamLogin.
    // This keeps the whole video.js sub-graph in a single async chunk
    // (correct evaluation order preserved) while the initial bundle stays
    // small (~95 kB gzip + ~51 kB vendor gzip; player chunk ~468 kB gzip
    // is fetched only when the user starts playback).
    chunkSizeWarningLimit: 2000,
  }
});

