/**
 * Core types for attest-it attestation system.
 * @packageDocumentation
 */

/**
 * Key provider configuration in settings.
 * @public
 */
export interface KeyProviderSettings {
  /** Provider type identifier */
  type: string
  /** Provider-specific options */
  options?: {
    /** Path to private key (filesystem provider) */
    privateKeyPath?: string
    /** Vault name (1Password provider) */
    vault?: string
    /** Item name (1Password provider) */
    itemName?: string
    /** Account identifier (1Password provider) */
    account?: string
  }
}

/**
 * Settings from the configuration file.
 * @public
 */
export interface AttestItSettings {
  /** Maximum age in days before an attestation expires */
  maxAgeDays: number
  /** Path to the public key file used for signature verification */
  publicKeyPath: string
  /** Path to the attestations file */
  attestationsPath: string
  /** Default command to execute for attestation (can be overridden per suite) */
  defaultCommand?: string
  /** Key provider configuration for signing attestations */
  keyProvider?: KeyProviderSettings
}

/**
 * Suite definition from the configuration file.
 * @public
 */
export interface SuiteConfig {
  /** Human-readable description of what this suite tests */
  description?: string
  /** Glob patterns for npm packages to include in fingerprint */
  packages: string[]
  /** Additional file patterns to include in fingerprint */
  files?: string[]
  /** Patterns to ignore when computing fingerprint */
  ignore?: string[]
  /** Command to execute for this suite (overrides defaultCommand) */
  command?: string
  /** Other suite names that, when changed, invalidate this suite's attestation */
  invalidates?: string[]
  /** Array of suite names this suite depends on */
  depends_on?: string[]
}

/**
 * Full configuration file structure.
 * @public
 */
export interface AttestItConfig {
  /** Configuration schema version */
  version: 1
  /** Global settings for attestation behavior */
  settings: AttestItSettings
  /** Named test suites with their configurations */
  suites: Record<string, SuiteConfig>
  /** Named groups of suites */
  groups?: Record<string, string[]>
}

/**
 * A single attestation entry.
 * @public
 */
export interface Attestation {
  /** Test suite name (e.g., "unit", "integration") */
  suite: string
  /** SHA-256 fingerprint of test files in format "sha256:<hex>" */
  fingerprint: string
  /** ISO 8601 timestamp when attestation was created */
  attestedAt: string
  /** User who created the attestation */
  attestedBy: string
  /** Command that was executed */
  command: string
  /** Exit code (must be 0 for valid attestation) */
  exitCode: 0
}

/**
 * Attestations file structure.
 * @public
 */
export interface AttestationsFile {
  /** Schema version for forward compatibility */
  schemaVersion: '1'
  /** Array of attestations */
  attestations: Attestation[]
  /** Base64-encoded signature over canonical attestations array */
  signature: string
}

/**
 * Verification status codes for suite attestations.
 * @public
 */
export type VerificationStatus =
  | 'VALID'
  | 'NEEDS_ATTESTATION'
  | 'FINGERPRINT_CHANGED'
  | 'EXPIRED'
  | 'INVALIDATED_BY_PARENT'
  | 'SIGNATURE_INVALID'

/**
 * Result of verifying a single suite's attestation.
 * @public
 */
export interface SuiteVerificationResult {
  /** Name of the suite being verified */
  suite: string
  /** Current verification status */
  status: VerificationStatus
  /** Current computed fingerprint for the suite */
  fingerprint: string
  /** The attestation record, if one exists */
  attestation?: Attestation
  /** List of files that changed (if status is FINGERPRINT_CHANGED) */
  changedFiles?: string[]
  /** Age of the attestation in days (if expired) */
  age?: number
  /** Human-readable message explaining the status */
  message?: string
}
