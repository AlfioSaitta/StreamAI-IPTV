import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './', // Fondamentale per i percorsi relativi in Electron
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
  }
});