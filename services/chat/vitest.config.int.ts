import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.int.spec.ts'],
    setupFiles: ['./test/setup-int.ts'],
    // All files share one database.
    fileParallelism: false,
  },
});
