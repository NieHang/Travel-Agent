import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.int.spec.ts'],
    setupFiles: ['./test/setup-int.ts'],
    // All files share one database.
    fileParallelism: false,
  },
});
