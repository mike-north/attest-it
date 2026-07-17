import { Command } from 'commander'
import {
  loadSplitConfig,
  computeFingerprintSync,
  readSealsSync,
  verifyGateSeal,
  verifyAllSeals,
  SplitConfigNotFoundError,
  type VerificationState,
  type SealVerificationResult,
} from '@attest-it/core'
import {
  log,
  success,
  error,
  warn,
  formatTable,
  outputJson,
  getTheme,
  type TableRow,
} from '../utils/output.js'
import { ExitCode } from '../utils/exit-codes.js'

export const statusCommand = new Command('status')
  .description('Show seal status for all gates')
  .argument('[gates...]', 'Show status for specific gates only')
  .option('--json', 'Output JSON for machine parsing')
  .action(async (gates: string[], options: StatusOptions, command: Command) => {
    const configPath = command.parent?.opts<{ config?: string }>().config
    await runStatus(gates, options, configPath)
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
 * `status` deliberately mirrors `verify`'s exit-code semantics rather than always
 * exiting 0: a missing/unreadable configuration exits {@link ExitCode.CONFIG_ERROR}
 * with a legible message instead of printing a bare empty table. A report command
 * that silently reports "nothing" on a broken config is exactly the fail-open
 * behavior this is meant to avoid. As with `verify`, a `STALE` seal (past maxAge
 * but otherwise valid) is a warning, not a failure, and does not by itself cause
 * a non-zero exit — only `MISSING`/`FINGERPRINT_MISMATCH`/`INVALID_SIGNATURE`/
 * `UNKNOWN_SIGNER` states do.
 *
 * @param gates - Array of gate IDs to show status for, or empty for all gates
 * @param options - Command options
 * @param options.json - Output JSON for machine parsing
 * @param configPath - Explicit `--config` path (policy file override), if provided
 * @public
 */
async function runStatus(
  gates: string[],
  options: StatusOptions,
  configPath?: string,
): Promise<void> {
  try {
    // Load split config (policy + operational, merged). An explicit --config path
    // overrides policy auto-detection; otherwise policy/operational are auto-detected.
    const config = await loadSplitConfig(
      configPath ? { policySource: { type: 'filesystem', path: configPath } } : {},
    )

    // Config loaded successfully but defines zero gates: there is nothing to report on.
    // Distinct from a missing/unreadable config (CONFIG_ERROR) — treat as NO_WORK.
    if (!config.gates || Object.keys(config.gates).length === 0) {
      if (options.json) {
        outputJson([])
      } else {
        warn('No gates defined in configuration — nothing to report')
      }
      process.exit(ExitCode.NO_WORK)
    }

    // Read seals
    const projectRoot = process.cwd()
    const sealsFile = readSealsSync(projectRoot, config.settings.sealsPath)

    // Determine which gates to check
    const gatesToCheck = gates.length > 0 ? gates : Object.keys(config.gates)

    // Validate that specified gates exist
    for (const gateId of gatesToCheck) {
      // eslint-disable-next-line security/detect-object-injection
      if (!config.gates[gateId]) {
        error(`Gate '${gateId}' not found in configuration`)
        process.exit(ExitCode.CONFIG_ERROR)
      }
    }

    // Compute fingerprints for all gates
    const fingerprints: Record<string, string> = {}
    for (const gateId of gatesToCheck) {
      // eslint-disable-next-line security/detect-object-injection
      const gate = config.gates[gateId]
      if (!gate) continue

      const result = computeFingerprintSync({
        paths: gate.fingerprint.paths,
        ...(gate.fingerprint.exclude && { exclude: gate.fingerprint.exclude }),
      })
      // eslint-disable-next-line security/detect-object-injection
      fingerprints[gateId] = result.fingerprint
    }

    // Verify seals
    const verificationResults =
      gates.length > 0
        ? gatesToCheck.map((gateId) =>
            // eslint-disable-next-line security/detect-object-injection
            verifyGateSeal(config, gateId, sealsFile, fingerprints[gateId] ?? ''),
          )
        : verifyAllSeals(config, sealsFile, fingerprints)

    // Build status results
    const results: GateStatus[] = verificationResults.map((result: SealVerificationResult) => {
      const status: GateStatus = {
        gateId: result.gateId,
        state: result.state,
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

    // Status is informational — always exit 0. Use `verify` for enforcement.
    process.exit(ExitCode.SUCCESS)
  } catch (err) {
    if (err instanceof SplitConfigNotFoundError) {
      // No discoverable config (or an unreadable --config path): fail closed with
      // a legible, actionable message rather than printing a bare empty table.
      error(err.message)
      log('Run `attest-it init` to create a configuration.')
    } else if (err instanceof Error) {
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
  const theme = getTheme()

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
    return `${String(result.age ?? 0)} days${result.state === 'STALE' ? ' (stale)' : ''}`
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
