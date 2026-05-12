import { defineConfig } from 'vitest/config';

// Vitest config: pure-unit tests use the default `node` env (fast).
// Tests that need DOM globals (MediaError, document, navigator) use the `jsdom`
// environment via per-file `// @vitest-environment jsdom` annotations.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    environment: 'node',
    globals: false,
    reporters: 'default',
    passWithNoTests: false,
  },
});

