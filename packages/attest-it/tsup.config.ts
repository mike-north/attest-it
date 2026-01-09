import { defineConfig } from 'tsup'

export default defineConfig([
  // Library output (dual format)
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    sourcemap: true,
    treeshake: true,
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
