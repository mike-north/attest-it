/**
 * Key provider system for managing cryptographic keys.
 *
 * @remarks
 * This module provides an abstraction layer for key storage, allowing
 * private keys to be stored in various backends (filesystem, 1Password, etc.)
 * while maintaining a consistent interface for signing operations.
 *
 * @packageDocumentation
 */

// Types
export type {
  KeyProviderConfig,
  KeyRetrievalResult,
  KeyGenerationResult,
  KeygenProviderOptions,
  KeyProvider,
} from './types.js'

// Filesystem provider
export { FilesystemKeyProvider } from './filesystem-provider.js'
export type { FilesystemKeyProviderOptions } from './filesystem-provider.js'

// 1Password provider
export { OnePasswordKeyProvider } from './one-password-provider.js'
export type {
  OnePasswordKeyProviderOptions,
  OnePasswordAccount,
  OnePasswordVault,
} from './one-password-provider.js'

// macOS Keychain provider
export { MacOSKeychainKeyProvider } from './macos-keychain-provider.js'
export type { MacOSKeychainKeyProviderOptions, MacOSKeychain } from './macos-keychain-provider.js'

// YubiKey provider
export { YubiKeyProvider } from './yubikey-provider.js'
export type { YubiKeyProviderOptions, YubiKeyInfo } from './yubikey-provider.js'

// Registry
export { KeyProviderRegistry } from './registry.js'
export type { KeyProviderFactory } from './registry.js'
