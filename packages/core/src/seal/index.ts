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
  CURRENT_SEALS_VERSION,
  type CreateSealOptions,
  type CreateSealWithSignerOptions,
  type CreateSealWithProviderOptions,
  type CanonicalSigner,
  type SignatureVerificationResult,
} from './operations.js'

// File-per-seal storage layout (path scheme, slug, low-level primitives)
export {
  slugifySegment,
  resolveSealsRoot,
  writeSealFileSync,
  listStoredSealsSync,
  type StoredSeal,
} from './storage.js'

// Verification
export {
  verifyGateSeal,
  verifyAllSeals,
  type VerificationState,
  type SealVerificationResult,
} from './verification.js'
