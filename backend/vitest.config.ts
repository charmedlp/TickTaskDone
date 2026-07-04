import { defineConfig } from 'vitest/config';

// Unit tests target the pure, database-free domain logic (recurrence expansion,
// occurrence merging). Anything touching the DB stays out of these tests.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
