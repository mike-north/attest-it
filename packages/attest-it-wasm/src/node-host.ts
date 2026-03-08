/**
 * Node.js host platform implementation for the WASM module.
 *
 * Bridges Node.js APIs (fs/promises, tinyglobby, os) to the
 * {@link WasmHostPlatform} interface expected by the WASM core.
 */

import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { platform as osPlatform } from 'node:os'
import { resolve } from 'node:path'

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
      const dir = path.substring(0, path.lastIndexOf('/'))
      if (dir) {
        await mkdir(dir, { recursive: true })
      }
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
      const { glob } = await import('tinyglobby')
      const matches = await glob(patterns, {
        cwd: baseDir,
        ignore,
        absolute: false,
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
