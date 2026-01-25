import { defineConfig, mergeConfig } from 'vitest/config'
import baseConfig from '../../vitest.config'

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: ['home-state.test.ts'],
      testTimeout: 120_000, // 2 minutes for Docker operations
      hookTimeout: 120_000, // 2 minutes for beforeAll hook
    },
  }),
)
