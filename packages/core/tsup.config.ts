import { defineConfig } from 'tsup'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const packageJson = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf-8')) as {
  version: string
}

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  // Inject version at build time for bundled contexts (e.g., github-action)
  define: {
    __ATTEST_IT_VERSION__: JSON.stringify(packageJson.version),
  },
})
