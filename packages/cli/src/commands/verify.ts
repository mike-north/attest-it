import { Command } from 'commander'
import {
  loadConfig,
  toAttestItConfig,
  computeFingerprintSync,
  readSealsSync,
  verifyAllSeals,
  verifyGateSeal,
  type VerificationState,
  type Seal,
  type GateSealVerificationResult,
} from '@attest-it/core'
import {
  log,
  success,
  error,
  warn,
  formatTable,
  outputJson,
  type TableRow,
} from '../utils/output.js'
import { ExitCode } from '../utils/exit-codes.js'

export const verifyCommand = new Command('verify')
  .description('Verify all gate seals (for CI)')
  .argument('[gates...]', 'Verify specific gates only')
  .option('--json', 'Output JSON for machine parsing')
  .action(async (gates: string[], options: VerifyOptions) => {
    await runVerify(gates, options)
  })

interface VerifyOptions {
  json?: boolean
}

/**
 * Run the verify command to validate gate seals.
 *
 * Verifies signature validity and checks seal status for all gates
 * or specific gates. Intended for CI/CD pipelines.
 *
 * @param gates - Array of gate IDs to verify, or empty for all gates
 * @param options - Command options
 * @param options.json - Output JSON for machine parsing
 * @public
 */
async function runVerify(gates: string[], options: VerifyOptions): Promise<void> {
  try {
    // Load config
    const config = await loadConfig()
    const attestItConfig = toAttestItConfig(config)

    // Check if gates are defined
    if (!attestItConfig.gates || Object.keys(attestItConfig.gates).length === 0) {
      error('No gates defined in configuration')
      process.exit(ExitCode.CONFIG_ERROR)
    }

    // Read seals
    const projectRoot = process.cwd()
    const sealsFile = readSealsSync(projectRoot)

    // Determine which gates to verify
    const gatesToVerify = gates.length > 0 ? gates : Object.keys(attestItConfig.gates)

    // Validate that specified gates exist
    for (const gateId of gatesToVerify) {
      // eslint-disable-next-line security/detect-object-injection
      if (!attestItConfig.gates[gateId]) {
        error(`Gate '${gateId}' not found in configuration`)
        process.exit(ExitCode.CONFIG_ERROR)
      }
    }

    // Compute fingerprints for all gates
    const fingerprints: Record<string, string> = {}
    for (const gateId of gatesToVerify) {
      // eslint-disable-next-line security/detect-object-injection
      const gate = attestItConfig.gates[gateId]
      if (!gate) continue

      const result = computeFingerprintSync({
        packages: gate.fingerprint.paths,
        ...(gate.fingerprint.exclude && { ignore: gate.fingerprint.exclude }),
      })
      // eslint-disable-next-line security/detect-object-injection
      fingerprints[gateId] = result.fingerprint
    }

    // Verify seals
    const results =
      gates.length > 0
        ? gatesToVerify.map((gateId) =>
            // eslint-disable-next-line security/detect-object-injection
            verifyGateSeal(attestItConfig, gateId, sealsFile, fingerprints[gateId] ?? ''),
          )
        : verifyAllSeals(attestItConfig, sealsFile, fingerprints)

    // Output results
    if (options.json) {
      outputJson(results)
    } else {
      displayResults(results)
    }

    // Determine exit code
    const hasInvalid = results.some(
      (r) =>
        r.state === 'MISSING' ||
        r.state === 'FINGERPRINT_MISMATCH' ||
        r.state === 'INVALID_SIGNATURE' ||
        r.state === 'UNKNOWN_SIGNER',
    )

    const hasStale = results.some((r) => r.state === 'STALE')

    if (hasInvalid) {
      process.exit(ExitCode.FAILURE)
    } else if (hasStale) {
      // Stale seals are warnings but not failures
      process.exit(ExitCode.SUCCESS)
    } else {
      process.exit(ExitCode.SUCCESS)
    }
  } catch (err) {
    if (err instanceof Error) {
      error(err.message)
    } else {
      error('Unknown error occurred')
    }
    process.exit(ExitCode.CONFIG_ERROR)
  }
}

/**
 * Display verification results in a formatted table.
 *
 * Shows verification state, seal metadata, and remediation steps.
 *
 * @param results - Verification results from verifyAllSeals or verifyGateSeal
 * @public
 */
function displayResults(results: GateSealVerificationResult[]): void {
  log('')

  // Build table rows
  const tableRows: TableRow[] = results.map((r) => ({
    suite: r.gateId,
    status: colorizeState(r.state),
    fingerprint: formatFingerprint(r),
    age: formatAge(r),
  }))

  log(formatTable(tableRows))
  log('')

  // Show messages for any gates with issues
  const withIssues = results.filter(
    (r) =>
      r.state !== 'VALID' &&
      r.state !== 'STALE' && // STALE gets its own warning below
      r.message,
  )

  if (withIssues.length > 0) {
    for (const result of withIssues) {
      if (result.message) {
        log(`${result.gateId}: ${result.message}`)
      }
    }
    log('')
  }

  // Summary
  const validCount = results.filter((r) => r.state === 'VALID').length
  const staleCount = results.filter((r) => r.state === 'STALE').length
  const invalidCount = results.length - validCount - staleCount

  if (invalidCount === 0 && staleCount === 0) {
    success('All gate seals valid')
  } else {
    if (invalidCount > 0) {
      error(`${invalidCount} gate(s) have invalid or missing seals`)
      log('Run `attest-it seal` to create seals for these gates')
    }
    if (staleCount > 0) {
      warn(`${staleCount} gate(s) have stale seals (exceeds maxAge)`)
      log('Run `attest-it seal --force <gate>` to update stale seals')
    }
  }
}

/**
 * Colorize verification state for display.
 *
 * @param state - Verification state
 * @returns Colorized state string
 */
function colorizeState(state: VerificationState): string {
  // Use the theme from output utils
  const { getTheme } = require('../utils/output.js')
  const theme = getTheme?.() ?? { green: (s: string) => s, yellow: (s: string) => s, red: (s: string) => s }

  switch (state) {
    case 'VALID':
      return theme.green(state)
    case 'MISSING':
    case 'STALE':
      return theme.yellow(state)
    case 'FINGERPRINT_MISMATCH':
    case 'INVALID_SIGNATURE':
    case 'UNKNOWN_SIGNER':
      return theme.red(state)
    default:
      return state
  }
}

/**
 * Format fingerprint for display.
 *
 * @param result - Verification result
 * @returns Formatted fingerprint string
 */
function formatFingerprint(result: GateSealVerificationResult): string {
  if (result.seal?.fingerprint) {
    const fp = result.seal.fingerprint
    if (fp.length > 16) {
      return fp.slice(0, 16) + '...'
    }
    return fp
  }
  return result.state === 'MISSING' ? '(none)' : '-'
}

/**
 * Format age for display.
 *
 * @param result - Verification result
 * @returns Formatted age string
 */
function formatAge(result: GateSealVerificationResult): string {
  if (result.seal?.timestamp) {
    const timestamp = new Date(result.seal.timestamp)
    const now = Date.now()
    const ageMs = now - timestamp.getTime()
    const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24))

    if (result.state === 'STALE') {
      return `${ageDays} days (stale)`
    }
    return `${ageDays} days`
  }

  switch (result.state) {
    case 'MISSING':
      return '(none)'
    case 'FINGERPRINT_MISMATCH':
      return '(changed)'
    default:
      return '-'
  }
}

export { runVerify, displayResults }
