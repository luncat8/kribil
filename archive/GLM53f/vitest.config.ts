import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/lib/kribil/__tests__/**/*.test.ts'],
    environment: 'node',
  },
});
