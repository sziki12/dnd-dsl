import { defineConfig } from 'vitest/config';
import path from 'path';

// Kept apart from vite.config.ts on purpose: that one carries the Monaco / language-client aliases and
// plugins, none of which the pure-logic tests need.
export default defineConfig({
  resolve: {
    alias: [
      { find: '@dnd-language', replacement: path.resolve(__dirname, './src/dnd-language/language/src') },
      { find: '@dnd-cli', replacement: path.resolve(__dirname, './src/dnd-language/cli/src') },
    ],
  },
  test: { include: ['src/**/*.test.ts'] },
});
