/**
 * Type definitions for the attest-it WASM module.
 *
 * @packageDocumentation
 */

/**
 * Host platform interface expected by the WASM module.
 *
 * The WASM core calls back into JavaScript through this interface for
 * file I/O, glob resolution, and Ed25519 signing.
 */
export interface WasmHostPlatform {
  readFile(path: string): Promise<Uint8Array>
  writeFile(path: string, content: Uint8Array): Promise<void>
  fileExists(path: string): Promise<boolean>
  createDirAll(path: string): Promise<void>
  resolveGlobs(patterns: string[], ignore: string[], baseDir: string): Promise<ResolvedFile[]>
  signEd25519(data: Uint8Array, signerId: string): Promise<SignResult>
  platform(): string
  nowUtc(): string
}

export interface ResolvedFile {
  relativePath: string
  absolutePath: string
}

export interface SignResult {
  signature: string
  algorithm: string
}

// --- Verification result types ---

export type VerificationState =
  | 'VALID'
  | 'MISSING'
  | 'FINGERPRINT_MISMATCH'
  | 'UNKNOWN_SIGNER'
  | 'INVALID_SIGNATURE'
  | 'STALE'

export interface SealVerificationResult {
  gateId: string
  state: VerificationState
  seal?: Seal
  message?: string
}

export interface Seal {
  gateId: string
  fingerprint: string
  timestamp: string
  sealedBy: string
  signature: string
}

// --- Fingerprint types ---

export interface FingerprintResult {
  fingerprint: string
  files: string[]
  fileCount: number
}

export interface FingerprintOptions {
  paths: string[]
  ignore?: string[]
  baseDir?: string
}

// --- Cross-config validation ---

export type CrossConfigErrorType = 'UNKNOWN_GATE' | 'MISSING_TEAM_MEMBER'

export interface CrossConfigError {
  type: CrossConfigErrorType
  suite?: string
  gate?: string
  signer?: string
  message: string
}
