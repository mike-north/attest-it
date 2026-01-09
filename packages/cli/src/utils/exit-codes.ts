/**
 * Standard exit codes for the attest-it CLI.
 *
 * These codes follow Unix conventions and provide consistent error reporting
 * across all CLI commands.
 *
 * @packageDocumentation
 */

/**
 * Standard exit codes for the attest-it CLI.
 * @public
 */
export const ExitCode = {
  /** Operation completed successfully */
  SUCCESS: 0,
  /** Tests failed or attestation invalid */
  FAILURE: 1,
  /** Configuration or validation error */
  CONFIG_ERROR: 2,
  /** User cancelled the operation */
  CANCELLED: 3,
  /** Missing required key file */
  MISSING_KEY: 4,
} as const

/**
 * Type representing all possible exit codes.
 * @public
 */
export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode]
