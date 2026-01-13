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
  /** Nothing needed attestation */
  NO_WORK: 2,
  /** Configuration or validation error */
  CONFIG_ERROR: 3,
  /** User cancelled the operation */
  CANCELLED: 4,
  /** Missing required key file */
  MISSING_KEY: 5,
} as const

/**
 * Type representing all possible exit codes.
 * @public
 */
export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode]
