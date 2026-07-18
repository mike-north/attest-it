/**
 * Identity configuration system for attest-it v2.0.
 * @packageDocumentation
 */

// Types
export type { PrivateKeyRef, Identity, LocalConfig } from './types.js'
export type { UserPreferences, CliExperiencePreferences } from './preferences.js'

// Config functions
export {
  ATTEST_IT_HOME_ENV,
  getLocalConfigPath,
  getIdentityConfigDir,
  getVaultKeeperConfigDir,
  setAttestItHomeDir,
  getAttestItHomeDir,
  loadLocalConfig,
  loadLocalConfigSync,
  saveLocalConfig,
  saveLocalConfigSync,
  getActiveIdentity,
  LocalConfigValidationError,
  // Public key storage
  getHomePublicKeysDir,
  savePublicKey,
  savePublicKeySync,
} from './config.js'

// Types for public key storage
export type { SavePublicKeyResult } from './config.js'

// Preferences functions
export {
  getPreferencesPath,
  loadPreferences,
  savePreferences,
  setPreference,
  getPreference,
} from './preferences.js'
