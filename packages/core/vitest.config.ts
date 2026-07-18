import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/fixtures/**'],
    environment: 'node',
    // Fails any test that writes to the developer's/CI runner's real
    // VaultKeeper config directory instead of an isolated
    // VAULTKEEPER_CONFIG_DIR temp dir (issue #114).
    setupFiles: ['./test/setup/vaultkeeper-isolation-guard.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.config.ts'],
    },
  },
})
