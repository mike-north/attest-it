/**
 * Tests for VaultKeyProvider adapter.
 *
 * @see https://github.com/mike-north/vaultkeeper (SecretBackend interface)
 */

import * as nodeCrypto from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SecretBackend } from 'vaultkeeper'
import { SigningKeyNotFoundError } from 'vaultkeeper'
import * as ed25519 from '../../src/crypto/ed25519.js'
import { VaultKeyProvider } from '../../src/key-provider/vault-key-provider.js'
import { createMockBackend, createSigningMockBackend } from '../helpers/mock-backends.js'

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
    provider = new VaultKeyProvider({ backend, displayName: 'Mock VaultKeeper' })
  })

  describe('constructor', () => {
    it('should use the backend type', () => {
      expect(provider.type).toBe('mock')
    })

    it('should use the provided displayName', () => {
      expect(provider.displayName).toBe('Mock VaultKeeper')
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
      const p = new VaultKeyProvider({ backend: unavailableBackend, displayName: 'Unavailable' })
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

      // Verify file permissions (owner read/write only) — Unix only
      if (process.platform !== 'win32') {
        const stat = await fs.stat(result.keyPath)
        const permissionBits = stat.mode & 0o777
        expect(permissionBits).toBe(0o600)
      }

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
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'attest-it-test-'))
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
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'attest-it-test-'))
      const publicKeyPath = `${tmpDir}/public.pem`

      try {
        await fs.writeFile(publicKeyPath, 'existing', 'utf-8')
        await expect(provider.generateKeyPair({ publicKeyPath })).rejects.toThrow('already exists')
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true })
      }
    })

    it('should overwrite when force is true', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'attest-it-test-'))
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
    it('should return backend type with backendType in options', () => {
      const config = provider.getConfig()
      expect(config.type).toBe('mock')
      expect(config.options).toEqual({ backendType: 'mock' })
    })
  })

  describe('delegated signing (SigningBackend)', () => {
    it('exposes signDirectly only when the backend implements SigningBackend', () => {
      // Plain SecretBackend: no delegated signing.
      expect(provider.signDirectly).toBeUndefined()

      // SigningBackend: signDirectly is available.
      const signing = createSigningMockBackend()
      const signingProvider = new VaultKeyProvider({
        backend: signing.backend,
        displayName: 'Signing Mock',
      })
      expect(signingProvider.signDirectly).toBeTypeOf('function')
    })

    it('supportsDelegatedSigning is false for a non-signing backend', async () => {
      await expect(provider.supportsDelegatedSigning('any-ref')).resolves.toBe(false)
    })

    it('supportsDelegatedSigning is true only once a signing key is enrolled', async () => {
      const signing = createSigningMockBackend()
      const signingProvider = new VaultKeyProvider({
        backend: signing.backend,
        displayName: 'Signing Mock',
      })

      // Not yet enrolled: fail-closed so callers fall back to getPrivateKey.
      await expect(signingProvider.supportsDelegatedSigning('key-1')).resolves.toBe(false)

      await signing.backend.generateSigningKey('key-1', 'EdDSA')
      await expect(signingProvider.supportsDelegatedSigning('key-1')).resolves.toBe(true)
    })

    it('supportsDelegatedSigning propagates non-not-found backend errors instead of masking them', async () => {
      const signing = createSigningMockBackend()
      const signingProvider = new VaultKeyProvider({
        backend: signing.backend,
        displayName: 'Signing Mock',
      })

      // A genuine "not found" is the fail-closed path -> false.
      signing.getPublicKeyFn.mockRejectedValueOnce(
        new SigningKeyNotFoundError('signing key not found', 'key-1'),
      )
      await expect(signingProvider.supportsDelegatedSigning('key-1')).resolves.toBe(false)

      // A transient backend failure (e.g. 1Password/network blip) must surface,
      // not be misreported as "no delegated key".
      signing.getPublicKeyFn.mockRejectedValueOnce(new Error('backend unavailable'))
      await expect(signingProvider.supportsDelegatedSigning('key-1')).rejects.toThrow(
        'backend unavailable',
      )
    })

    it('signDirectly produces a signature the backend key verifies', async () => {
      const signing = createSigningMockBackend()
      const signingProvider = new VaultKeyProvider({
        backend: signing.backend,
        displayName: 'Signing Mock',
      })
      await signing.backend.generateSigningKey('key-1', 'EdDSA')
      const { publicKeyPem } = await signing.getPublicKeyFn('key-1')
      const rawPublicKeyBase64 = nodeCrypto
        .createPublicKey(publicKeyPem)
        .export({ type: 'spki', format: 'der' })
        .subarray(12)
        .toString('base64')

      const message = 'gate-a:fingerprint:2026-07-17T00:00:00.000Z'
      const { signDirectly } = signingProvider
      if (!signDirectly) {
        throw new Error('expected signDirectly to be available for a SigningBackend')
      }
      const signature = await signDirectly('key-1', message)

      expect(signing.signWithKeyFn).toHaveBeenCalledWith('key-1', Buffer.from(message, 'utf8'))
      expect(ed25519.verify(message, signature, rawPublicKeyBase64)).toBe(true)
    })
  })

  describe('generateKeyPair with a SigningBackend', () => {
    it('enrolls a delegated signing key and never stores raw PEM as a secret', async () => {
      const signing = createSigningMockBackend()
      const signingProvider = new VaultKeyProvider({
        backend: signing.backend,
        displayName: 'Signing Mock',
      })
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'attest-it-test-'))
      const publicKeyPath = `${tmpDir}/public.pem`

      try {
        const result = await signingProvider.generateKeyPair({ publicKeyPath })

        // Enrolled via the signing contract, not the secret store.
        expect(signing.generateSigningKeyFn).toHaveBeenCalledWith(result.privateKeyRef, 'EdDSA')
        expect(signing.storeFn).not.toHaveBeenCalled()
        expect(result.storageDescription).toContain('delegated signing')

        // Public key written as base64 raw 32-byte form (44 chars for Ed25519).
        const publicKey = (await fs.readFile(publicKeyPath, 'utf-8')).trim()
        expect(Buffer.from(publicKey, 'base64')).toHaveLength(32)

        // keyExists reports true via the signing namespace, and delegated
        // signing is available for the freshly enrolled key.
        await expect(signingProvider.keyExists(result.privateKeyRef)).resolves.toBe(true)
        await expect(signingProvider.supportsDelegatedSigning(result.privateKeyRef)).resolves.toBe(
          true,
        )
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true })
      }
    })
  })

  describe('getPresenceCapability', () => {
    it('reports not-enforced (fail-closed) for a backend without capabilities', async () => {
      await expect(provider.getPresenceCapability()).resolves.toEqual({ presencePerUse: false })
    })

    it('surfaces presencePerUse and enforced operations from a capable backend', async () => {
      const signing = createSigningMockBackend({
        presencePerUse: true,
        presenceEnforcedOperations: ['sign'],
      })
      const signingProvider = new VaultKeyProvider({
        backend: signing.backend,
        displayName: 'Presence Mock',
      })
      await expect(signingProvider.getPresenceCapability()).resolves.toEqual({
        presencePerUse: true,
        presenceEnforcedOperations: ['sign'],
      })
    })
  })
})
