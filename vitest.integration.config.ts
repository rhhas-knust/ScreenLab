import { defineConfig } from 'vitest/config';

// Integration tests run against a real Supabase project (see README → Testing).
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
