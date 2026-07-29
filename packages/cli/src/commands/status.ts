import { Command } from 'commander'
import {
  loadSplitConfig,
  computeFingerprintSync,
  readSealsSync,
  verifyGateSeal,
  getGate,
  SplitConfigNotFoundError,
  API_SCHEMA_VERSION,
  type VerificationState,
  type SealVerificationResult,
  type SealCondition,
} from '@attest-it/core'
import { isPatternGate, verifyPatternGateSync } from '../utils/pattern-gate.js'
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
  /**
   * For a pattern gate's per-file row, the specific matched file this row
   * covers (repo-relative, forward-slash). Absent for a single-gate row.
   */
  artifactPath?: string
  state: VerificationState
  currentFingerprint: string
  sealedFingerprint?: string
  sealedBy?: string
  sealedAt?: string
  age?: number
  message?: string | undefined
  /** Every independently-determined failing condition, mirroring {@link SealVerificationResult.conditions}. */
  conditions?: SealCondition[]
}

/**
 * Run the status command to show seal status.
 *
 * Displays the current status of seals for all gates or specific gates,
 * including validation status, fingerprints, and age information.
 *
 * `status` is informational and always exits 0 when it successfully reports gate
 * results — including `MISSING`/`FINGERPRINT_MISMATCH`/`INVALID_SIGNATURE`/
 * `UNKNOWN_SIGNER`/`STALE` states, which it displays rather than enforces.
 * Enforcement is `verify`'s job. The one fail-closed case: a missing/unreadable
 * *configuration* exits {@link ExitCode.CONFIG_ERROR} with a legible message
 * instead of printing a bare empty table — a report that silently succeeds on a
 * broken config is exactly the fail-open behavior this avoids (see #81).
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
        outputJson(withSchemaVersion([]))
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

    // Build status results. A pattern gate (`kind: pattern`) expands into one
    // row per matched file (each fingerprinted and sealed independently); a
    // single gate keeps its one combined-fingerprint row exactly as before.
    const results: GateStatus[] = []
    for (const gateId of gatesToCheck) {
      const gate = getGate(config, gateId)
      if (gate && isPatternGate(gate)) {
        for (const { path: filePath, fingerprint, result } of verifyPatternGateSync(
          config,
          gateId,
          gate,
          projectRoot,
        )) {
          results.push(toGateStatus(result, fingerprint, filePath))
        }
        continue
      }

      const fingerprint = gate
        ? computeFingerprintSync({
            paths: gate.fingerprint.paths,
            ...(gate.fingerprint.exclude && { exclude: gate.fingerprint.exclude }),
          }).fingerprint
        : ''
      const result = verifyGateSeal(config, gateId, sealsFile, fingerprint)
      results.push(toGateStatus(result, fingerprint))
    }

    // Output results
    if (options.json) {
      outputJson(withSchemaVersion(results))
    } else {
      displayStatusTable(results)
    }

    // Status is informational — it reports gate results (including MISSING,
    // FINGERPRINT_MISMATCH, INVALID_SIGNATURE, UNKNOWN_SIGNER, STALE) and always
    // exits 0. Enforcement is `verify`'s job. Status fails closed only on a
    // missing/unreadable *configuration* (handled below), never on gate results.
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
 * Stamp each `--json` array item with the current embeddable-API schema
 * version, so consumers get an explicit version signal for this shape —
 * mirroring the convention `seal --json` already uses via its top-level
 * `schemaVersion` field. The array itself stays a bare array (only elements
 * gain the field), so existing positional/`.find()`-based consumers of
 * `status --json` are unaffected by this addition.
 */
function withSchemaVersion<T extends object>(
  items: T[],
): (T & { schemaVersion: typeof API_SCHEMA_VERSION })[] {
  return items.map((item) => ({ schemaVersion: API_SCHEMA_VERSION, ...item }))
}

/**
 * Build a {@link GateStatus} row from a verification result and the current
 * fingerprint, carrying `artifactPath` for a pattern gate's per-file row.
 */
function toGateStatus(
  result: SealVerificationResult,
  currentFingerprint: string,
  artifactPath?: string,
): GateStatus {
  const status: GateStatus = {
    gateId: result.gateId,
    ...(artifactPath !== undefined && { artifactPath }),
    state: result.state,
    currentFingerprint,
    message: result.message,
    ...(result.conditions && { conditions: result.conditions }),
  }

  if (result.seal) {
    status.sealedFingerprint = result.seal.fingerprint
    status.sealedBy = result.seal.sealedBy
    status.sealedAt = result.seal.timestamp

    const timestamp = new Date(result.seal.timestamp)
    const ageMs = Date.now() - timestamp.getTime()
    status.age = Math.floor(ageMs / (1000 * 60 * 60 * 24))
  }

  return status
}

/** Human-readable label for a row: the gate id, or `<gateId> › <artifact>` per file. */
function rowLabel(r: { gateId: string; artifactPath?: string }): string {
  return r.artifactPath !== undefined ? `${r.gateId} › ${r.artifactPath}` : r.gateId
}

/**
 * Display status results in a formatted table.
 *
 * @param results - Status results for gates
 */
function displayStatusTable(results: GateStatus[]): void {
  const tableRows: TableRow[] = results.map((r) => ({
    gate: rowLabel(r),
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
      log(`  ${rowLabel(result)}:`)
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
      const label = rowLabel(result)
      // A result carrying `conditions` failed more than one independent check
      // simultaneously; show each one so concurrent failures aren't hidden.
      const toShow = result.conditions ?? [
        { state: result.state, message: result.message ?? 'Unknown issue' },
      ]
      for (const condition of toShow) {
        log(`  ${label}: ${condition.message}`)
      }
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
