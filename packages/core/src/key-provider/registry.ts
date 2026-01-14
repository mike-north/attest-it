/**
 * Registry for key provider implementations.
 *
 * @remarks
 * The registry maintains a mapping of provider types to factory functions,
 * allowing dynamic creation of key providers based on configuration.
 *
 * @packageDocumentation
 */

import type { KeyProvider, KeyProviderConfig } from './types.js'
import { FilesystemKeyProvider } from './filesystem-provider.js'
import { OnePasswordKeyProvider } from './one-password-provider.js'

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

// Register the filesystem provider by default
KeyProviderRegistry.register('filesystem', (config) => {
  const privateKeyPath =
    typeof config.options.privateKeyPath === 'string' ? config.options.privateKeyPath : undefined

  // Only pass privateKeyPath if it's defined (to satisfy exactOptionalPropertyTypes)
  if (privateKeyPath !== undefined) {
    return new FilesystemKeyProvider({ privateKeyPath })
  }
  return new FilesystemKeyProvider()
})

// Register the 1Password provider
KeyProviderRegistry.register('1password', (config) => {
  const { options } = config
  const account = typeof options.account === 'string' ? options.account : undefined
  const vault = typeof options.vault === 'string' ? options.vault : ''
  const itemName = typeof options.itemName === 'string' ? options.itemName : ''

  if (!vault || !itemName) {
    throw new Error('1Password provider requires vault and itemName options')
  }

  // Only pass account if it's defined (to satisfy exactOptionalPropertyTypes)
  if (account !== undefined) {
    return new OnePasswordKeyProvider({ account, vault, itemName })
  }
  return new OnePasswordKeyProvider({ vault, itemName })
})
