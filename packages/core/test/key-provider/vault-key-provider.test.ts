/**
 * Tests for VaultKeyProvider adapter.
 *
 * @see https://github.com/mike-north/vaultkeeper (SecretBackend interface)
 */

import * as fs from 'node:fs/promises'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SecretBackend } from 'vaultkeeper'
import { VaultKeyProvider } from '../../src/key-provider/vault-key-provider.js'

/**
 * Create a mock SecretBackend for testing, returning both the backend
 * and individual mock function references for assertion.
 */
function createMockBackend(overrides: Partial<SecretBackend> = {}) {
  const secretStore = new Map<string, string>()

  const isAvailableFn = vi.fn<() => Promise<boolean>>().mockResolvedValue(true)
  const storeFn = vi.fn<(id: string, secret: string) => Promise<void>>((id, secret) => {
    secretStore.set(id, secret)
    return Promise.resolve()
  })
  const retrieveFn = vi.fn<(id: string) => Promise<string>>((id) => {
    const val = secretStore.get(id)
    if (val === undefined) {
      return Promise.reject(new Error(`Secret not found: ${id}`))
    }
    return Promise.resolve(val)
  })
  const deleteFn = vi.fn<(id: string) => Promise<void>>((id) => {
    if (!secretStore.has(id)) {
      return Promise.reject(new Error(`Secret not found: ${id}`))
    }
    secretStore.delete(id)
    return Promise.resolve()
  })
  const existsFn = vi.fn<(id: string) => Promise<boolean>>((id) =>
    Promise.resolve(secretStore.has(id)),
  )

  const backend: SecretBackend = {
    type: 'mock',
    displayName: 'Mock Backend',
    isAvailable: isAvailableFn,
    store: storeFn,
    retrieve: retrieveFn,
    delete: deleteFn,
    exists: existsFn,
    ...overrides,
  }

  return { backend, isAvailableFn, storeFn, retrieveFn, deleteFn, existsFn }
}

/** A sample Ed25519 PEM private key for testing. */
const SAMPLE_PEM = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIJ0yoMOEeaMjH9BXmKmBFH32eysYFkBZMhJRbqsZjzax
-----END PRIVATE KEY-----
`

describe('VaultKeyProvider', () => {
  let backend: SecretBackend
  let mocks: ReturnType<typeof createMockBackend>
  let provider: VaultKeyProvider

  beforeEach(() => {
    mocks = createMockBackend()
    backend = mocks.backend
    provider = new VaultKeyProvider({ backend })
  })

  describe('constructor', () => {
    it('should derive type from backend', () => {
      expect(provider.type).toBe('mock')
    })

    it('should generate a default displayName from backend', () => {
      expect(provider.displayName).toBe('VaultKeeper (Mock Backend)')
    })

    it('should use custom displayName when provided', () => {
      const custom = new VaultKeyProvider({
        backend,
        displayName: '1Password via VaultKeeper',
      })
      expect(custom.displayName).toBe('1Password via VaultKeeper')
    })
  })

  describe('isAvailable', () => {
    it('should delegate to backend.isAvailable()', async () => {
      await expect(provider.isAvailable()).resolves.toBe(true)
      expect(mocks.isAvailableFn).toHaveBeenCalledOnce()
    })

    it('should return false when backend is unavailable', async () => {
      const { backend: unavailableBackend } = createMockBackend({
        isAvailable: vi.fn<() => Promise<boolean>>().mockResolvedValue(false),
      })
      const p = new VaultKeyProvider({ backend: unavailableBackend })
      await expect(p.isAvailable()).resolves.toBe(false)
    })
  })

  describe('keyExists', () => {
    it('should delegate to backend.exists()', async () => {
      await expect(provider.keyExists('some-key')).resolves.toBe(false)
      expect(mocks.existsFn).toHaveBeenCalledWith('some-key')
    })

    it('should return true when key exists in backend', async () => {
      await backend.store('my-key', SAMPLE_PEM)
      await expect(provider.keyExists('my-key')).resolves.toBe(true)
    })
  })

  describe('getPrivateKey', () => {
    it('should retrieve PEM from backend and write to temp file', async () => {
      await backend.store('my-key', SAMPLE_PEM)

      const result = await provider.getPrivateKey('my-key')

      // Verify temp file exists with correct content
      const content = await fs.readFile(result.keyPath, 'utf-8')
      expect(content).toBe(SAMPLE_PEM)

      // Verify file permissions (owner read/write only)
      const stat = await fs.stat(result.keyPath)
      const permissionBits = stat.mode & 0o777
      expect(permissionBits).toBe(0o600)

      // Cleanup should remove the file
      await result.cleanup()
      await expect(fs.access(result.keyPath)).rejects.toThrow()
    })

    it('should propagate errors when backend.retrieve() throws', async () => {
      await expect(provider.getPrivateKey('nonexistent')).rejects.toThrow('Secret not found')
    })

    it('should clean up temp file even if cleanup is called multiple times', async () => {
      await backend.store('my-key', SAMPLE_PEM)
      const result = await provider.getPrivateKey('my-key')

      await result.cleanup()
      // Second cleanup should not throw (it warns instead)
      await expect(result.cleanup()).resolves.toBeUndefined()
    })
  })

  describe('generateKeyPair', () => {
    it('should generate keys and store private key in backend', async () => {
      const tmpDir = await fs.mkdtemp('/tmp/attest-it-test-')
      const publicKeyPath = `${tmpDir}/public.pem`

      try {
        const result = await provider.generateKeyPair({ publicKeyPath })

        // Public key file should exist
        const publicKey = await fs.readFile(publicKeyPath, 'utf-8')
        expect(publicKey).toBeTruthy()

        // Private key should be stored in backend
        expect(mocks.storeFn).toHaveBeenCalledOnce()
        await expect(provider.keyExists(result.privateKeyRef)).resolves.toBe(true)

        // Storage description should include backend name
        expect(result.storageDescription).toContain('Mock Backend')
        expect(result.publicKeyPath).toBe(publicKeyPath)
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true })
      }
    })

    it('should throw when public key file already exists and force is false', async () => {
      const tmpDir = await fs.mkdtemp('/tmp/attest-it-test-')
      const publicKeyPath = `${tmpDir}/public.pem`

      try {
        await fs.writeFile(publicKeyPath, 'existing', 'utf-8')
        await expect(provider.generateKeyPair({ publicKeyPath })).rejects.toThrow('already exists')
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true })
      }
    })

    it('should overwrite when force is true', async () => {
      const tmpDir = await fs.mkdtemp('/tmp/attest-it-test-')
      const publicKeyPath = `${tmpDir}/public.pem`

      try {
        await fs.writeFile(publicKeyPath, 'existing', 'utf-8')
        const result = await provider.generateKeyPair({ publicKeyPath, force: true })

        const publicKey = await fs.readFile(publicKeyPath, 'utf-8')
        expect(publicKey).not.toBe('existing')
        expect(result.privateKeyRef).toBeTruthy()
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true })
      }
    })
  })

  describe('getConfig', () => {
    it('should return config with backend type', () => {
      const config = provider.getConfig()
      expect(config.type).toBe('mock')
      expect(config.options).toEqual({})
    })
  })
})
