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
  },
});
