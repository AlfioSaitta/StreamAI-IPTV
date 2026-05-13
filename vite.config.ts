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
    // NOTE: il chunk splitting manuale (commit E.1) è stato rimosso perché
    // spezzava l'ordine di valutazione delle classi tra video.js e i suoi
    // plugin (errore runtime "Class extends value undefined" nel renderer
    // Electron). Per ora si lascia decidere a Rollup il chunking di default.
    // Una versione corretta richiede dynamic import() del route player
    // oppure tenere in un unico chunk tutto il sotto-grafo di video.js.
    chunkSizeWarningLimit: 2000,
  }
});

