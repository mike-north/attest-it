/**
 * Registry for key provider implementations.
 *
 * @remarks
 * The registry maintains a mapping of provider types to factory functions,
 * allowing dynamic creation of key providers based on configuration.
 * All providers are now backed by VaultKeeper SecretBackend instances
 * via VaultKeyProvider.
 *
 * @packageDocumentation
 */

import type { KeyProvider, KeyProviderConfig } from './types.js'
import { BackendRegistry } from 'vaultkeeper'
import { VaultKeyProvider } from './vault-key-provider.js'

/**
 * Type for a key provider factory function.
 * @public
 */
export type KeyProviderFactory = (config: KeyProviderConfig) => KeyProvider

/**
 * Registry for key provider implementations.
 *
 * @remarks
 * The registry allows registration of custom key providers and provides
 * a factory method to create provider instances from configuration.
 *
 * Note: This class is used as a namespace for static methods.
 * @public
 */
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class KeyProviderRegistry {
  private static providers = new Map<string, KeyProviderFactory>()

  /**
   * Register a key provider factory.
   * @param type - Provider type identifier
   * @param factory - Factory function to create provider instances
   */
  static register(type: string, factory: KeyProviderFactory): void {
    this.providers.set(type, factory)
  }

  /**
   * Create a key provider from configuration.
   * @param config - Provider configuration
   * @returns A key provider instance
   * @throws Error if the provider type is not registered
   */
  static create(config: KeyProviderConfig): KeyProvider {
    const factory = this.providers.get(config.type)
    if (!factory) {
      throw new Error(
        `Unknown key provider type: ${config.type}. ` +
          `Available types: ${Array.from(this.providers.keys()).join(', ')}`,
      )
    }
    return factory(config)
  }

  /**
   * Get all registered provider types.
   * @returns Array of provider type identifiers
   */
  static getProviderTypes(): string[] {
    return Array.from(this.providers.keys())
  }
}

// Register the filesystem provider backed by VaultKeeper's file backend
KeyProviderRegistry.register('filesystem', (_config) => {
  const backend = BackendRegistry.create('file')
  return new VaultKeyProvider({ backend, displayName: 'Filesystem' })
})

// Register the 1Password provider backed by VaultKeeper's 1password backend
KeyProviderRegistry.register('1password', (_config) => {
  const backend = BackendRegistry.create('1password')
  return new VaultKeyProvider({ backend, displayName: '1Password' })
})

// Register the macOS Keychain provider backed by VaultKeeper's keychain backend
KeyProviderRegistry.register('macos-keychain', (_config) => {
  const backend = BackendRegistry.create('keychain')
  return new VaultKeyProvider({ backend, displayName: 'macOS Keychain' })
})

// Register the YubiKey provider backed by VaultKeeper's yubikey backend
KeyProviderRegistry.register('yubikey', (_config) => {
  const backend = BackendRegistry.create('yubikey')
  return new VaultKeyProvider({ backend, displayName: 'YubiKey' })
})
