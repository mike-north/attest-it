/**
 * Regression test: the VaultKeeper-backed 1Password path stays resolvable.
 *
 * VaultKeeper 0.7.0 made `@1password/sdk` an optional peer dependency for its
 * 1Password backend (replacing the `op` CLI). attest-it declares `@1password/sdk`
 * as an explicit dependency so the VaultKeeper 1Password backend resolves and
 * constructs. This guards against the dependency being dropped.
 *
 * @see https://github.com/mike-north/attest-it/issues/76
 */

import { describe, expect, it } from 'vitest'
import { BackendRegistry } from 'vaultkeeper'
import { KeyProviderRegistry } from '../../src/key-provider/registry.js'

describe('VaultKeeper 1Password backend resolution', () => {
  it('resolves the @1password/sdk optional peer dependency', async () => {
    // Import (not just require.resolve) so a broken/missing install fails here.
    await expect(import('@1password/sdk')).resolves.toBeDefined()
  })

  it('constructs the VaultKeeper 1Password backend without a resolution error', () => {
    expect(() => BackendRegistry.create('1password')).not.toThrow()
  })

  it('creates the 1Password key provider backed by VaultKeeper', () => {
    const provider = KeyProviderRegistry.create({ type: '1password', options: {} })
    expect(provider.type).toBe('1password')
  })
})
