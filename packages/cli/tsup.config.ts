import { defineConfig } from 'tsup'
import { copyFileSync, mkdirSync } from 'node:fs'

export default defineConfig([
  // Library output (dual format)
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    sourcemap: true,
    treeshake: true,
    onSuccess: async () => {
      // Copy templates directory to dist
      mkdirSync('dist/templates', { recursive: true })
      copyFileSync('templates/config.yaml', 'dist/templates/config.yaml')
    },
  },
  // CLI bin (ESM only, executable)
  {
    entry: { 'bin/attest-it': 'bin/attest-it.ts' },
    format: ['esm'],
    clean: false,
    sourcemap: true,
    treeshake: true,
    banner: { js: '#!/usr/bin/env node' },
  },
])
