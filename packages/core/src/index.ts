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
  RootGateConfig,
  SuiteConfig,
  AttestItConfig,
} from './types.js'

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
  // Comment-preserving policy read/write round-trip
  type EditablePolicy,
  loadEditablePolicy,
  serializeEditablePolicy,
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
  UnifiedConfigError,
  type PolicySource,
  type LoadSplitConfigOptions,
  // Unified -> split migration (retired format conversion)
  migrateUnifiedConfig,
  migrateUnifiedContent,
  UnifiedMigrationError,
  type SplitConfigResult,
  // Root-gate trust anchoring over policy.yaml
  ROOT_GATE_ID,
  RootGateVerificationError,
  verifyRootGate,
  createRootSeal,
  createRootSealWithProvider,
  synthesizeRootGate,
  computePolicyFingerprint,
  computePolicyFingerprintSync,
  isBlockingRootGateState,
  type RootGateState,
  type RootGateVerificationResult,
} from './config/index.js'

// Fingerprinting
export { computeFingerprint, computeFingerprintSync, listPackageFiles } from './fingerprint.js'
export type { FingerprintOptions, FingerprintResult } from './fingerprint.js'

// Cryptography
export {
  checkOpenSSL,
  getDefaultPrivateKeyPath,
  getDefaultPublicKeyPath,
  getDefaultYubiKeyEncryptedKeyPath,
  generateKeyPair,
  sign,
  verify,
  setKeyPermissions,
} from './crypto.js'
export type {
  KeyPaths,
  KeygenOptions,
  SignOptions,
  VerifyOptions as CryptoVerifyOptions,
} from './crypto.js'

// Ed25519 Cryptography
export {
  generateKeyPair as generateEd25519KeyPair,
  sign as signEd25519,
  verify as verifyEd25519,
  getPublicKeyFromPrivate,
  isEncryptedPrivateKeyPem,
} from './crypto/ed25519.js'
export type {
  KeyPair as Ed25519KeyPair,
  GenerateKeyPairOptions as Ed25519GenerateKeyPairOptions,
} from './crypto/ed25519.js'

// Key Providers
export {
  VaultKeyProvider,
  KeyProviderRegistry,
  // Discovery functions
  isOnePasswordInstalled,
  listOnePasswordAccounts,
  listOnePasswordVaults,
  isMacOSKeychainAvailable,
  listMacOSKeychains,
  isYubiKeyInstalled,
  isYubiKeyConnected,
  listYubiKeyDevices,
  isYubiKeyChallengeResponseConfigured,
  type KeyProvider,
  type KeyProviderConfig,
  type KeyRetrievalResult,
  type KeyGenerationResult,
  type KeygenProviderOptions,
  type KeyPresenceCapability,
  type KeyPresenceOperation,
  type OnePasswordAccount,
  type OnePasswordVault,
  type InaccessibleAccount,
  type ListAccountsResult,
  type MacOSKeychain,
  type YubiKeyInfo,
  type VaultKeyProviderOptions,
  type KeyProviderFactory,
  storePrivateKey,
  deletePrivateKey,
  type StorePrivateKeyResult,
  type PrivateKeyBackendType,
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

// Embeddable API — the stable, versioned, path-keyed surface for embedders.
// This is the coherent facade over the lower-level, gate-keyed primitives above.
export {
  listGates,
  status,
  fingerprint,
  seal,
  verifyOne,
  verifyAll,
  API_SCHEMA_VERSION,
  type ApiSchemaVersion,
  type FailureClass,
  type ApiResultBase,
  type ApiFailure,
  type ApiOptions,
  type GateDescriptor,
  type ListGatesResult,
  type FingerprintResultOk,
  type VerificationSuccess,
  type ArtifactVerification,
  type StatusResult,
  type VerifyAllResult,
  type SealResult,
  type SealParams,
  type VerifyAllParams,
} from './api/index.js'

// Identity backend capability reporting
export { getIdentityPresenceCapability } from './api/internal.js'

// Seal System
export {
  createSeal,
  createSealWithSigner,
  createSealWithProvider,
  verifySeal,
  readSeals,
  readSealsSync,
  writeSeals,
  writeSealsSync,
  verifyGateSeal,
  verifyAllSeals,
  CURRENT_SEALS_VERSION,
  slugifySegment,
  resolveSealsRoot,
  writeSealFileSync,
  listStoredSealsSync,
  type Seal,
  type SealsFile,
  type StoredSeal,
  type CreateSealOptions,
  type CreateSealWithSignerOptions,
  type CreateSealWithProviderOptions,
  type CanonicalSigner,
  type SignatureVerificationResult,
  type VerificationState,
  type SealVerificationResult,
} from './seal/index.js'
