/**
 * Tests for KeyProviderRegistry.
 *
 * @remarks
 * The registry now creates VaultKeyProvider instances backed by VaultKeeper
 * SecretBackend implementations. Tests mock the VaultKeeper BackendRegistry
 * to avoid requiring real backends.
 *
 * VaultKeyProvider.type is derived from the backend's own `type` (not a
 * stable 'vaultkeeper' string) — see vault-key-provider.ts.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { KeyProviderRegistry } from '../../src/key-provider/registry.js'
import { VaultKeyProvider } from '../../src/key-provider/vault-key-provider.js'
import type { KeyProvider, KeyProviderConfig } from '../../src/key-provider/types.js'
import type { SecretBackend } from 'vaultkeeper'

// Mock VaultKeeper's BackendRegistry so we don't need real backends
vi.mock('vaultkeeper', () => {
  function makeMockBackend(type: string): SecretBackend {
    return {
      type,
      displayName: `Mock ${type}`,
      isAvailable: () => Promise.resolve(true),
      store: () => Promise.resolve(),
      retrieve: () => Promise.resolve('mock-secret'),
      delete: () => Promise.resolve(),
      exists: () => Promise.resolve(false),
    }
  }

  return {
    BackendRegistry: {
      create(type: string) {
        const known = ['file', '1password', 'keychain', 'yubikey']
        if (!known.includes(type)) {
          throw new Error(`Unknown backend type: ${type}`)
        }
        return makeMockBackend(type)
      },
    },
    // These mock backends implement only the base SecretBackend contract, so
    // the capability/signing guards report false.
    isSigningBackend: () => false,
    isPresenceCapableBackend: () => false,
    getBackendCapabilities: () => Promise.resolve({ presencePerUse: false }),
  }
})

// Mock key provider for testing custom registration
class MockKeyProvider implements KeyProvider {
  readonly type = 'mock'
  readonly displayName = 'Mock Provider'

  constructor(private config: KeyProviderConfig) {}

  // eslint-disable-next-line @typescript-eslint/require-await
  async isAvailable(): Promise<boolean> {
    return true
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async keyExists(_keyRef: string): Promise<boolean> {
    return true
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getPrivateKey(keyRef: string) {
    return {
      keyPath: keyRef,
      cleanup: async () => {
        // no-op
      },
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async generateKeyPair() {
    return {
      privateKeyRef: 'mock-private',
      publicKeyPath: 'mock-public.pem',
      storageDescription: 'Mock storage',
    }
  }

  getConfig(): KeyProviderConfig {
    return this.config
  }
}

describe('KeyProviderRegistry', () => {
  beforeEach(() => {
    // The registry is a singleton, so we need to be careful about test isolation.
  })

  describe('register and create', () => {
    it('should create filesystem provider backed by VaultKeeper file backend', () => {
      const config: KeyProviderConfig = {
        type: 'filesystem',
        options: {},
      }

      const provider = KeyProviderRegistry.create(config)

      expect(provider).toBeInstanceOf(VaultKeyProvider)
      // #65 derives VaultKeyProvider.type from the underlying VaultKeeper
      // backend's own `type` (see vault-key-provider.ts), rather than using
      // a stable 'vaultkeeper' string — the filesystem provider registers
      // the 'file' backend, so the derived type is 'file'.
      expect(provider.type).toBe('file')
      expect(provider.displayName).toBe('Filesystem')
    })

    it('should create 1password provider backed by VaultKeeper 1password backend', () => {
      const config: KeyProviderConfig = {
        type: '1password',
        options: {},
      }

      const provider = KeyProviderRegistry.create(config)

      expect(provider).toBeInstanceOf(VaultKeyProvider)
      // #65 derives VaultKeyProvider.type from the underlying VaultKeeper
      // backend's own `type` — the 1password provider registers the
      // '1password' backend, so the derived type is '1password'.
      expect(provider.type).toBe('1password')
      expect(provider.displayName).toBe('1Password')
    })

    it('should create macos-keychain provider backed by VaultKeeper keychain backend', () => {
      const config: KeyProviderConfig = {
        type: 'macos-keychain',
        options: {},
      }

      const provider = KeyProviderRegistry.create(config)

      expect(provider).toBeInstanceOf(VaultKeyProvider)
      // #65 derives VaultKeyProvider.type from the underlying VaultKeeper
      // backend's own `type` — the macos-keychain provider registers the
      // 'keychain' backend, so the derived type is 'keychain'.
      expect(provider.type).toBe('keychain')
      expect(provider.displayName).toBe('macOS Keychain')
    })

    it('should create yubikey provider backed by VaultKeeper yubikey backend', () => {
      const config: KeyProviderConfig = {
        type: 'yubikey',
        options: {},
      }

      const provider = KeyProviderRegistry.create(config)

      expect(provider).toBeInstanceOf(VaultKeyProvider)
      // #65 derives VaultKeyProvider.type from the underlying VaultKeeper
      // backend's own `type` — the yubikey provider registers the
      // 'yubikey' backend, so the derived type is 'yubikey'.
      expect(provider.type).toBe('yubikey')
      expect(provider.displayName).toBe('YubiKey')
    })

    it('should allow registering custom providers', () => {
      KeyProviderRegistry.register('mock', (config) => new MockKeyProvider(config))

      const config: KeyProviderConfig = {
        type: 'mock',
        options: {},
      }

      const provider = KeyProviderRegistry.create(config)

      expect(provider).toBeInstanceOf(MockKeyProvider)
      expect(provider.type).toBe('mock')
      expect(provider.displayName).toBe('Mock Provider')
    })

    it('should throw error for unknown provider type', () => {
      const config: KeyProviderConfig = {
        type: 'unknown-provider-type',
        options: {},
      }

      expect(() => KeyProviderRegistry.create(config)).toThrow(/Unknown key provider type/)
    })

    it('should list available provider types in error message', () => {
      const config: KeyProviderConfig = {
        type: 'nonexistent',
        options: {},
      }

      try {
        KeyProviderRegistry.create(config)
        expect.fail('Should have thrown')
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        expect(errorMessage).toContain('Available types')
        expect(errorMessage).toContain('filesystem')
      }
    })
  })

  describe('getProviderTypes', () => {
    it('should return list of registered provider types', () => {
      const types = KeyProviderRegistry.getProviderTypes()

      expect(types).toBeInstanceOf(Array)
      expect(types).toContain('filesystem')
      expect(types).toContain('1password')
      expect(types).toContain('macos-keychain')
      expect(types).toContain('yubikey')
    })

    it('should include custom providers in the list', () => {
      KeyProviderRegistry.register('custom-test', (config) => new MockKeyProvider(config))

      const types = KeyProviderRegistry.getProviderTypes()

      expect(types).toContain('filesystem')
      expect(types).toContain('custom-test')
    })
  })

  describe('provider factory', () => {
    it('should pass config to factory function', () => {
      let receivedConfig: KeyProviderConfig | undefined

      KeyProviderRegistry.register('config-test', (config) => {
        receivedConfig = config
        return new MockKeyProvider(config)
      })

      const config: KeyProviderConfig = {
        type: 'config-test',
        options: {
          testOption: 'test-value',
        },
      }

      KeyProviderRegistry.create(config)

      expect(receivedConfig).toEqual(config)
    })
  })
})
