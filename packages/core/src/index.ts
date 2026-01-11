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

// Verification
export { verifyAttestations } from './verify.js'
export type { VerifyOptions, VerifyResult } from './verify.js'
