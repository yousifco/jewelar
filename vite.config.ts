import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// GitHub Pages serves the project site at /<repo>/. The deploy workflow can
// override this via the BASE_PATH env var; default matches the `jewelar` repo.
const base = process.env.BASE_PATH ?? '/jewelar/';

export default defineConfig({
  base,
  build: {
    target: 'es2020',
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      input: {
        // The PBR orbit viewer (Phase 1) and the live camera try-on (Phase 2).
        main: resolve(__dirname, 'index.html'),
        tryon: resolve(__dirname, 'tryon.html'),
      },
    },
  },
});
