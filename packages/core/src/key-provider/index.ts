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
  KeyPresenceCapability,
  KeyPresenceOperation,
} from './types.js'

// VaultKeeper provider
export { VaultKeyProvider } from './vault-key-provider.js'
export type { VaultKeyProviderOptions } from './vault-key-provider.js'

// Discovery functions and their associated types
export {
  isOnePasswordInstalled,
  listOnePasswordAccounts,
  listOnePasswordVaults,
  isMacOSKeychainAvailable,
  listMacOSKeychains,
  isYubiKeyInstalled,
  isYubiKeyConnected,
  listYubiKeyDevices,
  isYubiKeyChallengeResponseConfigured,
} from './discovery.js'
export type {
  OnePasswordAccount,
  OnePasswordVault,
  InaccessibleAccount,
  ListAccountsResult,
  MacOSKeychain,
  YubiKeyInfo,
} from './discovery.js'

// Registry
export { KeyProviderRegistry } from './registry.js'
export type { KeyProviderFactory } from './registry.js'

// High-level storage helpers
export { storePrivateKey, deletePrivateKey } from './store.js'
export type { StorePrivateKeyResult, PrivateKeyBackendType } from './store.js'
