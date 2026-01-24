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
  options?:
    | {
        /** Path to private key (filesystem provider) */
        privateKeyPath?: string | undefined
        /** Vault name (1Password provider) */
        vault?: string | undefined
        /** Item name (1Password provider) */
        itemName?: string | undefined
        /** Account identifier (1Password provider) */
        account?: string | undefined
      }
    | undefined
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
  /** Path to the seals file */
  sealsPath: string
  /** Default command to execute for attestation (can be overridden per suite) */
  defaultCommand?: string
  /** Key provider configuration for signing attestations */
  keyProvider?: KeyProviderSettings
}

/**
 * Team member configuration.
 * @public
 */
export interface TeamMember {
  /** Display name for the team member */
  name: string
  /** Email address (optional) */
  email?: string | undefined
  /** GitHub username (optional) */
  github?: string | undefined
  /** Base64-encoded Ed25519 public key */
  publicKey: string
  /** Public key algorithm (optional, for future-proofing format changes) */
  publicKeyAlgorithm?: 'ed25519' | undefined
}

/**
 * Fingerprint configuration for gates.
 * @public
 */
export interface FingerprintConfig {
  /** Glob patterns for paths to include in fingerprint */
  paths: string[]
  /** Patterns to exclude from fingerprint */
  exclude?: string[] | undefined
}

/**
 * Gate definition - defines what needs to be signed and who can sign it.
 * @public
 */
export interface GateConfig {
  /** Human-readable name for the gate */
  name: string
  /** Description of what this gate protects */
  description: string
  /** Team member slugs authorized to sign for this gate */
  authorizedSigners: string[]
  /** Fingerprint configuration */
  fingerprint: FingerprintConfig
  /** Maximum age before attestation expires (duration string like "30d", "7d", "24h") */
  maxAge: string
}

/**
 * Suite definition from the configuration file.
 * Suites are CLI-layer extensions of gates with command execution capabilities.
 * @public
 */
export interface SuiteConfig {
  /** Reference to a gate (if present, inherits gate configuration) */
  gate?: string
  /** Human-readable description of what this suite tests */
  description?: string
  /** Glob patterns for npm packages to include in fingerprint (legacy/backward compatibility) */
  packages?: string[]
  /** Additional file patterns to include in fingerprint */
  files?: string[]
  /** Patterns to ignore when computing fingerprint */
  ignore?: string[]
  /** Command to execute for this suite (overrides defaultCommand) */
  command?: string
  /** Timeout for command execution (duration string) */
  timeout?: string
  /** Whether the command is interactive */
  interactive?: boolean
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
  /** Minimum required attest-it version (semver format, e.g., "0.8.0") */
  minVersion?: string
  /** Global settings for attestation behavior */
  settings: AttestItSettings
  /** Team members mapped by slug */
  team?: Record<string, TeamMember>
  /** Gates defining authorization and fingerprinting */
  gates?: Record<string, GateConfig>
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
