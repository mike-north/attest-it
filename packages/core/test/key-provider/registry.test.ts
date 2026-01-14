import { describe, it, expect, beforeEach } from 'vitest'
import { KeyProviderRegistry } from '../../src/key-provider/registry.js'
import { FilesystemKeyProvider } from '../../src/key-provider/filesystem-provider.js'
import type { KeyProvider, KeyProviderConfig } from '../../src/key-provider/types.js'

// Mock key provider for testing
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
    // Since filesystem provider is registered by default, we'll work with that.
  })

  describe('register and create', () => {
    it('should register and create filesystem provider by default', () => {
      const config: KeyProviderConfig = {
        type: 'filesystem',
        options: {
          privateKeyPath: '/test/path/key.pem',
        },
      }

      const provider = KeyProviderRegistry.create(config)

      expect(provider).toBeInstanceOf(FilesystemKeyProvider)
      expect(provider.type).toBe('filesystem')
      expect(provider.displayName).toBe('Filesystem')
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

  describe('filesystem provider registration', () => {
    it('should create FilesystemKeyProvider with custom path from config', () => {
      const config: KeyProviderConfig = {
        type: 'filesystem',
        options: {
          privateKeyPath: '/custom/private/key.pem',
        },
      }

      const provider = KeyProviderRegistry.create(config)
      const providerConfig = provider.getConfig()

      expect(providerConfig.options.privateKeyPath).toBe('/custom/private/key.pem')
    })

    it('should create FilesystemKeyProvider with default path when not specified', () => {
      const config: KeyProviderConfig = {
        type: 'filesystem',
        options: {},
      }

      const provider = KeyProviderRegistry.create(config)

      // Should use default path (we don't assert exact path as it's OS-dependent)
      expect(provider).toBeInstanceOf(FilesystemKeyProvider)
    })

    it('should handle non-string privateKeyPath option gracefully', () => {
      const config: KeyProviderConfig = {
        type: 'filesystem',
        options: {
          privateKeyPath: 123, // Invalid type
        },
      }

      const provider = KeyProviderRegistry.create(config)

      // Should fall back to default path
      expect(provider).toBeInstanceOf(FilesystemKeyProvider)
    })
  })
})
