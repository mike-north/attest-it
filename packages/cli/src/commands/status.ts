import { Command } from 'commander'
import {
  loadConfig,
  toAttestItConfig,
  computeFingerprintSync,
  readSealsSync,
  verifyGateSeal,
  verifyAllSeals,
  type VerificationState,
  type GateSealVerificationResult,
} from '@attest-it/core'
import {
  log,
  success,
  error,
  formatTable,
  outputJson,
  type TableRow,
} from '../utils/output.js'
import { ExitCode } from '../utils/exit-codes.js'

export const statusCommand = new Command('status')
  .description('Show seal status for all gates')
  .argument('[gates...]', 'Show status for specific gates only')
  .option('--json', 'Output JSON for machine parsing')
  .action(async (gates: string[], options: StatusOptions) => {
    await runStatus(gates, options)
  })

interface StatusOptions {
  json?: boolean
}

interface GateStatus {
  gateId: string
  state: VerificationState
  currentFingerprint: string
  sealedFingerprint?: string
  sealedBy?: string
  sealedAt?: string
  age?: number
  message?: string | undefined
}

/**
 * Run the status command to show seal status.
 *
 * Displays the current status of seals for all gates or specific gates,
 * including validation status, fingerprints, and age information.
 *
 * @param gates - Array of gate IDs to show status for, or empty for all gates
 * @param options - Command options
 * @param options.json - Output JSON for machine parsing
 * @public
 */
async function runStatus(gates: string[], options: StatusOptions): Promise<void> {
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

    // Determine which gates to check
    const gatesToCheck = gates.length > 0 ? gates : Object.keys(attestItConfig.gates)

    // Validate that specified gates exist
    for (const gateId of gatesToCheck) {
      // eslint-disable-next-line security/detect-object-injection
      if (!attestItConfig.gates[gateId]) {
        error(`Gate '${gateId}' not found in configuration`)
        process.exit(ExitCode.CONFIG_ERROR)
      }
    }

    // Compute fingerprints for all gates
    const fingerprints: Record<string, string> = {}
    for (const gateId of gatesToCheck) {
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
    const verificationResults =
      gates.length > 0
        ? gatesToCheck.map((gateId) =>
            // eslint-disable-next-line security/detect-object-injection
            verifyGateSeal(attestItConfig, gateId, sealsFile, fingerprints[gateId] ?? ''),
          )
        : verifyAllSeals(attestItConfig, sealsFile, fingerprints)

    // Build status results
    const results: GateStatus[] = verificationResults.map((result: GateSealVerificationResult) => {
      const status: GateStatus = {
        gateId: result.gateId,
        state: result.state,
        // eslint-disable-next-line security/detect-object-injection
        currentFingerprint: fingerprints[result.gateId] ?? '',
        message: result.message,
      }

      if (result.seal) {
        status.sealedFingerprint = result.seal.fingerprint
        status.sealedBy = result.seal.sealedBy
        status.sealedAt = result.seal.timestamp

        // Calculate age
        const timestamp = new Date(result.seal.timestamp)
        const now = Date.now()
        const ageMs = now - timestamp.getTime()
        status.age = Math.floor(ageMs / (1000 * 60 * 60 * 24))
      }

      return status
    })

    // Output results
    if (options.json) {
      outputJson(results)
    } else {
      displayStatusTable(results)
    }

    // Exit with appropriate code
    const hasInvalid = results.some(
      (r) =>
        r.state === 'MISSING' ||
        r.state === 'FINGERPRINT_MISMATCH' ||
        r.state === 'INVALID_SIGNATURE' ||
        r.state === 'UNKNOWN_SIGNER' ||
        r.state === 'STALE',
    )

    process.exit(hasInvalid ? ExitCode.FAILURE : ExitCode.SUCCESS)
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
 * Display status results in a formatted table.
 *
 * @param results - Status results for gates
 */
function displayStatusTable(results: GateStatus[]): void {
  const tableRows: TableRow[] = results.map((r) => ({
    suite: r.gateId,
    status: colorizeState(r.state),
    fingerprint: r.currentFingerprint.slice(0, 16) + '...',
    age: formatAge(r),
  }))

  log('')
  log(formatTable(tableRows))
  log('')

  // Show seal metadata for each gate (who sealed, when)
  const sealed = results.filter((r) => r.sealedBy && r.sealedAt)
  if (sealed.length > 0) {
    log('Seal metadata:')
    for (const result of sealed) {
      log(`  ${result.gateId}:`)
      log(`    Sealed by: ${result.sealedBy ?? 'unknown'}`)
      if (result.sealedAt) {
        const date = new Date(result.sealedAt)
        log(`    Sealed at: ${date.toLocaleString()}`)
      }
    }
    log('')
  }

  // Show messages for any gates with issues
  const withIssues = results.filter((r) => r.state !== 'VALID' && r.message)
  if (withIssues.length > 0) {
    log('Issues:')
    for (const result of withIssues) {
      log(`  ${result.gateId}: ${result.message ?? 'Unknown issue'}`)
    }
    log('')
  }

  // Summary
  const validCount = results.filter((r) => r.state === 'VALID').length
  const invalidCount = results.length - validCount

  if (invalidCount === 0) {
    success('All gate seals valid')
  } else {
    log(`Run 'attest-it seal' to create or update seals`)
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
  const theme = getTheme?.() ?? {
    green: (s: string) => s,
    yellow: (s: string) => s,
    red: (s: string) => s,
  }

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
 * Format age for display.
 *
 * @param result - Status result
 * @returns Formatted age string
 */
function formatAge(result: GateStatus): string {
  if (result.state === 'VALID' || result.state === 'STALE') {
    return `${result.age ?? 0} days${result.state === 'STALE' ? ' (stale)' : ''}`
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

export { runStatus }
