/**
 * Seal module for attest-it v2.0.
 * @packageDocumentation
 */

// Types
export type { Seal, SealsFile } from './types.js'

// Operations
export {
  createSeal,
  createSealWithSigner,
  createSealWithProvider,
  verifySeal,
  readSeals,
  readSealsSync,
  writeSeals,
  writeSealsSync,
  type CreateSealOptions,
  type CreateSealWithSignerOptions,
  type CreateSealWithProviderOptions,
  type CanonicalSigner,
  type SignatureVerificationResult,
} from './operations.js'

// Verification
export {
  verifyGateSeal,
  verifyAllSeals,
  type VerificationState,
  type SealVerificationResult,
} from './verification.js'
