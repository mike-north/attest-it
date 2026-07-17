/**
 * Legacy filesystem key provider for v1 identity compatibility.
 *
 * @remarks
 * This provider reads private keys directly from filesystem paths as stored
 * by v1 identities. It exists solely as a migration shim — v1 config migration
 * converts old key refs to `{ type: 'filesystem', path: string }`, and the CLI
 * uses this provider to serve those identities without requiring an upfront
 * import into VaultKeeper.
 *
 * Unlike the current `FilesystemKeyProvider` (which is a VaultKeeper-backed
 * provider that treats `keyRef` as a secret ID), this provider treats `keyRef`
 * as a raw filesystem path. Key generation is intentionally unsupported — users
 * must run `attest-it identity create` to create new identities with a proper
 * VaultKeeper-backed provider.
 *
 * @packageDocumentation
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { homedir } from 'node:os'
import type {
  KeyProvider,
  KeyProviderConfig,
  KeyRetrievalResult,
  KeyGenerationResult,
  KeygenProviderOptions,
} from './types.js'

/**
 * Expand a leading `~` to the user's home directory.
 * Shell tilde expansion is not performed by Node's filesystem APIs, so a
 * hand-edited v1 config carrying a `~`-prefixed path must be expanded
 * explicitly at the point of I/O.
 * @internal
 */
function resolveLegacyPath(p: string): string {
  if (p === '~' || p.startsWith('~/')) {
    return path.join(homedir(), p.slice(1))
  }
  return p
}

/**
 * Key provider that reads PEM keys directly from legacy filesystem paths.
 *
 * @remarks
 * This provider is registered under the `filesystem-legacy` type and is used
 * automatically when signing with a v1 identity. It does not support key
 * generation — use `attest-it identity create` with a VaultKeeper-backed
 * provider to create new identities.
 *
 * @public
 */
export class LegacyFilesystemKeyProvider implements KeyProvider {
  readonly type = 'filesystem-legacy'
  readonly displayName = 'Filesystem (Legacy)'

  /**
   * Check if this provider is available.
   * The legacy filesystem provider is always available.
   */
  async isAvailable(): Promise<boolean> {
    // Legacy filesystem provider is always available
    return Promise.resolve(true)
  }

  /**
   * Check if a key exists at the given filesystem path.
   * @param keyRef - Filesystem path to the private key file (may contain a leading `~`)
   */
  async keyExists(keyRef: string): Promise<boolean> {
    try {
      await fs.access(resolveLegacyPath(keyRef))
      return true
    } catch {
      return false
    }
  }

  /**
   * Get the private key path for signing.
   * Returns the resolved (tilde-expanded) path with a no-op cleanup function.
   * @param keyRef - Filesystem path to the private key file (may contain a leading `~`)
   */
  async getPrivateKey(keyRef: string): Promise<KeyRetrievalResult> {
    if (!(await this.keyExists(keyRef))) {
      throw new Error(`Private key not found: ${keyRef}`)
    }

    return {
      keyPath: resolveLegacyPath(keyRef),
      // No-op cleanup — key stays on filesystem
      cleanup: async () => {
        // Nothing to clean up - key stays on filesystem
      },
    }
  }

  /**
   * Not supported — legacy provider does not create new keys.
   * @param _options - Unused key generation options
   * @throws Always throws an informative error directing the user to `identity create`
   */
  // Must stay async so the throw below becomes a rejected Promise, matching the KeyProvider interface contract
  // eslint-disable-next-line @typescript-eslint/require-await
  async generateKeyPair(_options: KeygenProviderOptions): Promise<KeyGenerationResult> {
    throw new Error(
      'Legacy filesystem provider does not support key generation. ' +
        'Use "attest-it identity create" with a VaultKeeper-backed provider.',
    )
  }

  /**
   * Get the configuration for this provider.
   */
  getConfig(): KeyProviderConfig {
    return { type: this.type, options: {} }
  }
}
