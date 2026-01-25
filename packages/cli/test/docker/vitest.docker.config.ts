import { defineConfig } from 'vitest/config'

// Standalone config for Docker tests - doesn't need coverage
export default defineConfig({
  test: {
    include: ['test/docker/home-state.test.ts'],
    environment: 'node',
    testTimeout: 120_000, // 2 minutes for Docker operations
    hookTimeout: 120_000, // 2 minutes for beforeAll hook
  },
})
