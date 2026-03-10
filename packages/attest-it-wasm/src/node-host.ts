/**
 * Node.js host platform implementation for the WASM module.
 *
 * Bridges Node.js APIs (fs/promises, tinyglobby, os) to the
 * {@link WasmHostPlatform} interface expected by the WASM core.
 */

import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { platform as osPlatform } from 'node:os'
import { dirname, resolve } from 'node:path'

import type { ResolvedFile, SignResult, WasmHostPlatform } from './types.js'

/**
 * Create a Node.js host platform for the WASM module.
 *
 * File I/O uses `node:fs/promises`. Glob resolution uses `tinyglobby`.
 * Signing delegates to VaultKeeper (not yet wired — Phase 4).
 */
export function createNodeHost(): WasmHostPlatform {
  return {
    async readFile(path: string): Promise<Uint8Array> {
      const buffer = await readFile(path)
      return new Uint8Array(buffer)
    },

    async writeFile(path: string, content: Uint8Array): Promise<void> {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, content)
    },

    async fileExists(path: string): Promise<boolean> {
      try {
        await access(path)
        return true
      } catch {
        return false
      }
    },

    async createDirAll(path: string): Promise<void> {
      await mkdir(path, { recursive: true })
    },

    async resolveGlobs(
      patterns: string[],
      ignore: string[],
      baseDir: string,
    ): Promise<ResolvedFile[]> {
      // Expand bare directory paths to recursive globs, matching the TS
      // `resolvePackagePattern` behavior in packages/core/src/fingerprint.ts.
      const expandedPatterns: string[] = []
      for (const pattern of patterns) {
        if (/[*?{}\[\]]/.test(pattern)) {
          expandedPatterns.push(pattern)
        } else {
          try {
            const stats = await stat(resolve(baseDir, pattern))
            expandedPatterns.push(stats.isFile() ? pattern : `${pattern}/**/*`)
          } catch {
            expandedPatterns.push(pattern)
          }
        }
      }

      const { glob } = await import('tinyglobby')
      const matches = await glob(expandedPatterns, {
        cwd: baseDir,
        ignore,
        absolute: false,
        onlyFiles: true,
        dot: true,
      })

      return matches.map((relativePath) => ({
        relativePath: relativePath.split('\\').join('/'),
        absolutePath: resolve(baseDir, relativePath),
      }))
    },

    async signEd25519(_data: Uint8Array, _signerId: string): Promise<SignResult> {
      // VaultKeeper integration is wired in Phase 4.
      throw new Error(
        'signEd25519 is not yet implemented — VaultKeeper integration pending (Phase 4)',
      )
    },

    platform(): string {
      const p = osPlatform()
      if (p === 'darwin') return 'darwin'
      if (p === 'win32') return 'win32'
      return 'linux'
    },

    nowUtc(): string {
      return new Date().toISOString()
    },
  }
}
