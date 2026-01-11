import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  target: 'node20',
  clean: true,
  // Bundle all dependencies for Actions runtime
  noExternal: [/.*/],
  // Single file output
  splitting: false,
})
