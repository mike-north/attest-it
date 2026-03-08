/**
 * @attest-it/core
 *
 * Core functionality for the attest-it testing framework.
 * @packageDocumentation
 */

// Types
export type {
  AttestItSettings,
  KeyProviderSettings,
  TeamMember,
  FingerprintConfig,
  GateConfig,
  SuiteConfig,
  AttestItConfig,
  Attestation,
  AttestationsFile,
  VerificationStatus,
  SuiteVerificationResult,
} from './types.js'

// Config
export {
  loadConfig,
  loadConfigSync,
  findConfigPath,
  resolveConfigPaths,
  toAttestItConfig,
  ConfigValidationError,
  ConfigNotFoundError,
  type Config,
} from './config.js'

// Version checking
export {
  getPackageVersion,
  checkVersionCompatibility,
  VersionIncompatibleError,
} from './version.js'

// Re-export version as a lazy-evaluated getter for backward compatibility
// This allows `import { version } from '@attest-it/core'` to work
import { getPackageVersion as _getPackageVersion } from './version.js'

/**
 * The current version of the @attest-it/core package.
 * This is a convenience export for consumers who want to access the version directly.
 *
 * @public
 */
export const version: string = _getPackageVersion()

// Split config support
export {
  // Policy config
  type PolicyConfig,
  policySchema,
  parsePolicyContent,
  PolicyValidationError,
  // Operational config
  type OperationalConfig,
  operationalSchema,
  parseOperationalContent,
  OperationalValidationError,
  // Merge and validation
  mergeConfigs,
  validateSuiteGateReferences,
  type ValidationError,
  type ValidationErrorType,
  // Unified split config loading (CLI and GitHub Action use this)
  loadSplitConfig,
  loadSplitConfigSync,
  findPolicyPath,
  findOperationalPath,
  SplitConfigNotFoundError,
  CrossConfigValidationError,
  type PolicySource,
  type LoadSplitConfigOptions,
} from './config/index.js'

// Fingerprinting
export { computeFingerprint, computeFingerprintSync, listPackageFiles } from './fingerprint.js'
export type { FingerprintOptions, FingerprintResult } from './fingerprint.js'

// Attestations
export {
  readAttestations,
  readAttestationsSync,
  writeAttestations,
  writeAttestationsSync,
  findAttestation,
  upsertAttestation,
  removeAttestation,
  canonicalizeAttestations,
  createAttestation,
} from './attestation.js'

// Key utilities
export {
  getDefaultPrivateKeyPath,
  getDefaultPublicKeyPath,
  getDefaultYubiKeyEncryptedKeyPath,
  setKeyPermissions,
} from './key-utils.js'

// Ed25519 Cryptography
export {
  generateKeyPair as generateEd25519KeyPair,
  sign as signEd25519,
  verify as verifyEd25519,
  getPublicKeyFromPrivate,
} from './crypto/ed25519.js'
export type { KeyPair as Ed25519KeyPair } from './crypto/ed25519.js'

// Verification
export { verifyAttestations } from './verify.js'
export type { VerifyOptions, VerifyResult } from './verify.js'

// Key Providers
export {
  FilesystemKeyProvider,
  OnePasswordKeyProvider,
  MacOSKeychainKeyProvider,
  YubiKeyProvider,
  VaultKeyProvider,
  KeyProviderRegistry,
  type KeyProvider,
  type KeyProviderConfig,
  type KeyRetrievalResult,
  type KeyGenerationResult,
  type KeygenProviderOptions,
  type FilesystemKeyProviderOptions,
  type OnePasswordKeyProviderOptions,
  type OnePasswordAccount,
  type OnePasswordVault,
  type InaccessibleAccount,
  type ListAccountsResult,
  type MacOSKeychainKeyProviderOptions,
  type MacOSKeychain,
  type YubiKeyProviderOptions,
  type YubiKeyInfo,
  type VaultKeyProviderOptions,
  type KeyProviderFactory,
} from './key-provider/index.js'

// Identity System
export {
  ATTEST_IT_HOME_ENV,
  getLocalConfigPath,
  getIdentityConfigDir,
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
  type PrivateKeyRef,
  type Identity,
  type LocalConfig,
  type SavePublicKeyResult,
} from './identity/index.js'

// User Preferences
export {
  getPreferencesPath,
  loadPreferences,
  savePreferences,
  setPreference,
  getPreference,
  type UserPreferences,
  type CliExperiencePreferences,
} from './identity/index.js'

// Authorization
export {
  isAuthorizedSigner,
  getAuthorizedSignersForGate,
  findTeamMemberByPublicKey,
  getGate,
  parseDuration,
} from './authorization.js'

// Seal System
export {
  createSeal,
  verifySeal,
  readSeals,
  readSealsSync,
  writeSeals,
  writeSealsSync,
  verifyGateSeal,
  verifyAllSeals,
  type Seal,
  type SealsFile,
  type CreateSealOptions,
  type SignatureVerificationResult,
  type VerificationState,
  type SealVerificationResult,
} from './seal/index.js'
