import { defineConfig } from 'vitest/config';

// Isolated from vite.config.ts (which is build-only, multi-page) so the unit
// tests for the pure anchoring maths run in a plain Node environment.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
