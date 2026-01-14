/**
 * @attest-it/core
 *
 * Core functionality for the attest-it testing framework.
 * @packageDocumentation
 */

/**
 * Package version
 * @public
 */
export const version = '0.0.0'

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
  writeSignedAttestations,
  readAndVerifyAttestations,
  SignatureInvalidError,
} from './attestation.js'
export type {
  WriteSignedAttestationsOptions,
  ReadSignedAttestationsOptions,
} from './attestation.js'

// Cryptography
export {
  checkOpenSSL,
  getDefaultPrivateKeyPath,
  getDefaultPublicKeyPath,
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
  type MacOSKeychainKeyProviderOptions,
  type KeyProviderFactory,
} from './key-provider/index.js'

// Identity System
export {
  getLocalConfigPath,
  loadLocalConfig,
  loadLocalConfigSync,
  saveLocalConfig,
  saveLocalConfigSync,
  getActiveIdentity,
  LocalConfigValidationError,
  type PrivateKeyRef,
  type Identity,
  type LocalConfig,
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
