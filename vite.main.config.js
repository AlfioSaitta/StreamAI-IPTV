import { defineConfig } from 'vite';
import { builtinModules } from 'module';
import { resolve } from 'path';

export default defineConfig({
    build: {
        ssr: true, // Indica a Vite che stiamo compilando per Node.js, non per il browser
        lib: {
            entry: resolve(__dirname, 'main.js'),
            formats: ['cjs'], // Electron richiede CommonJS per il main process
            fileName: () => 'main.js',
        },
        outDir: 'dist/main',
        emptyOutDir: true,
        rollupOptions: {
            // Dobbiamo dire a Vite di NON provare a pacchettizzare Electron e i moduli nativi del sistema
            external: [
                'electron',
                ...builtinModules,
                ...builtinModules.map((m) => `node:${m}`)
            ],
        },
    },
});