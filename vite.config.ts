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
    // E.1 IMPROVEMENT_PLAN_V2: code-splitting per vendor area.
    // Riduce il chunk principale (era ~1.9 MB) e abilita caching efficace
    // tra release (cambiare app code non invalida i vendor).
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (!id.includes('node_modules')) return undefined;

          // Video stack (Video.js + hls.js + mpegts.js) — il più pesante
          if (
            id.includes('/video.js/') ||
            id.includes('/hls.js/') ||
            id.includes('/mpegts.js/') ||
            id.includes('/@videojs/')
          ) {
            return 'videojs-vendor';
          }

          // Google Gemini SDK
          if (id.includes('/@google/genai/')) {
            return 'genai-vendor';
          }

          // Lucide icon set (tree-shakeable ma comunque ~80kB di import diretti)
          if (id.includes('/lucide-react/')) {
            return 'lucide-vendor';
          }

          // Capacitor plugins
          if (id.includes('/@capacitor/') || id.includes('/capacitor-')) {
            return 'capacitor-vendor';
          }

          // React + ReactDOM + scheduler
          if (
            id.includes('/react/') ||
            id.includes('/react-dom/') ||
            id.includes('/scheduler/')
          ) {
            return 'react-vendor';
          }

          // Tutto il resto dei vendor in un chunk generico
          return 'vendor';
        },
      },
    },
  }
});

