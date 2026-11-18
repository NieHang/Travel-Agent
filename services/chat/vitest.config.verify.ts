import { defineConfig } from 'vitest/config';

// Exhaustive schedule checks in verify/. Kept out of `bun run test` because they report findings
// in current code and take longer than unit tests. See .claude/skills/verify-turn-claim/SKILL.md.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['verify/**/*.check.ts'],
    setupFiles: ['./test/setup-unit.ts'],
  },
});
