/**
 * Tests for `storePrivateKey`/`deletePrivateKey` -- the high-level VaultKeeper
 * storage helpers.
 *
 * Regression coverage for issue #101: `identity remove` previously had no
 * way to delete a VaultKeeper-managed secret at all, so it silently left the
 * `.enc` file behind. `deletePrivateKey` is the primitive the CLI now calls
 * to do that; these tests exercise it directly against the real `file`
 * backend (redirected to a temp directory), plus its idempotent handling of
 * an already-missing secret.
 */
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { deletePrivateKey, storePrivateKey } from '../../src/key-provider/store.js'

const SAMPLE_PEM = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIJ0yoMOEeaMjH9BXmKmBFH32eysYFkBZMhJRbqsZjzax
-----END PRIVATE KEY-----
`

describe('deletePrivateKey', () => {
  let configDir: string
  const originalConfigDir = process.env.VAULTKEEPER_CONFIG_DIR

  beforeEach(async () => {
    configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'attest-it-core-store-test-'))
    process.env.VAULTKEEPER_CONFIG_DIR = configDir
  })

  afterEach(async () => {
    if (originalConfigDir === undefined) {
      delete process.env.VAULTKEEPER_CONFIG_DIR
    } else {
      process.env.VAULTKEEPER_CONFIG_DIR = originalConfigDir
    }
    await fs.rm(configDir, { recursive: true, force: true })
  })

  it('deletes a secret previously written by storePrivateKey', async () => {
    const { secretId } = await storePrivateKey('file', SAMPLE_PEM, 'alice')
    const entryPath = path.join(
      configDir,
      'file',
      `${Buffer.from(secretId, 'utf8').toString('hex')}.enc`,
    )

    // Sanity check: the secret is really on disk before deletion.
    await expect(fs.access(entryPath)).resolves.toBeUndefined()

    await deletePrivateKey('file', secretId)

    await expect(fs.access(entryPath)).rejects.toThrow()
  })

  it('leaves other secrets in the same store untouched', async () => {
    const kept = await storePrivateKey('file', SAMPLE_PEM, 'bob')
    const removed = await storePrivateKey('file', SAMPLE_PEM, 'carol')

    await deletePrivateKey('file', removed.secretId)

    const keptEntryPath = path.join(
      configDir,
      'file',
      `${Buffer.from(kept.secretId, 'utf8').toString('hex')}.enc`,
    )
    await expect(fs.access(keptEntryPath)).resolves.toBeUndefined()
  })

  it('is idempotent: deleting an already-missing secret resolves without throwing', async () => {
    // Negative-path regression: a naive implementation would propagate
    // vaultkeeper's SecretNotFoundError here, but the desired end state --
    // no secret with this id -- already holds, so this must succeed.
    await expect(deletePrivateKey('file', 'attest-it-never-stored-uuid')).resolves.toBeUndefined()
  })
})
