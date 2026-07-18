import { Command } from 'commander'
import {
  loadSplitConfig,
  computeFingerprintSync,
  computePolicyFingerprintSync,
  findPolicyPath,
  readSealsSync,
  verifyAllSeals,
  verifyGateSeal,
  verifyRootGate,
  isBlockingRootGateState,
  SplitConfigNotFoundError,
  type AttestItConfig,
  type VerificationState,
  type SealVerificationResult,
  type RootGateVerificationResult,
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
import { readPolicyFromRef, GitRefPolicyError } from '../utils/git-policy.js'

export const verifyCommand = new Command('verify')
  .description(
    'Verify gate seals. Without --base this is a fast LOCAL pre-check (trusts the ' +
      'working-tree policy), NOT a CI trust gate. Pass --base <ref> to make it the ' +
      'CI-safe trust boundary: authorization (rootGate/team/gates) is loaded from ' +
      '<ref>, mirroring the GitHub Action.',
  )
  .argument('[gates...]', 'Verify specific gates only')
  .option('--json', 'Output JSON for machine parsing')
  .option(
    '--base <ref>',
    'Load trust-critical policy (rootGate, team, gates) from this git ref instead ' +
      'of the working tree, while fingerprinting and reading seals from the working ' +
      'tree. This is the CI-safe trust boundary for non-GitHub CI — a PR that ' +
      'self-adds a signer and re-seals cannot pass, because authorization comes from ' +
      '<ref>. Mirrors the GitHub Action, which loads policy from the PR base branch. ' +
      'The ref must already be present locally (fetch it first in a shallow clone).',
  )
  .action(async (gates: string[], options: VerifyOptions, command: Command) => {
    const configPath = command.parent?.opts<{ config?: string }>().config
    await runVerify(gates, options, configPath)
  })

interface VerifyOptions {
  json?: boolean
  base?: string
}

/**
 * Run the verify command to validate gate seals against the local policy.
 *
 * Verifies signature validity and checks seal status for all gates or specific
 * gates, and (when the policy is trust-anchored) checks the root-gate seal over
 * `policy.yaml` first.
 *
 * ## Plain `verify` is a local pre-check; `--base` is the CI trust boundary
 *
 * Without `--base`, `verify` evaluates everything against the **working tree's**
 * policy: `rootGate`, `team`, and `gates` are read from the local `policy.yaml`.
 * That is correct for a developer checking their own tree, but it is **not** safe
 * as a pull-request gate. A branch can rewrite its own `rootGate.authorizedSigners`
 * to a key it controls and re-seal the policy; plain `verify` trusts that local
 * anchor and reports VALID by design (see the "Scenario B" regression test in
 * `packages/cli/test/integration/root-gate.integration.test.ts`).
 *
 * `verify --base <ref>` closes that gap: it sources `rootGate`/`team`/`gates` from
 * `<ref>`'s copy of `policy.yaml` (the trusted base) while computing fingerprints
 * and reading seals from the working tree — the SAME base-vs-worktree check the
 * **GitHub Action** (`@attest-it/github-action`) performs. A self-added root signer
 * is then rejected as `UNKNOWN_SIGNER`, because the base ref does not list it. Use
 * the Action on GitHub, or `verify --base <ref>` for non-GitHub CI. `--base` fails
 * **closed**: an unreadable/missing ref or policy is a `CONFIG_ERROR`, never a
 * silent pass on the working-tree policy.
 *
 * Exits {@link ExitCode.CONFIG_ERROR} — never {@link ExitCode.SUCCESS} — when no
 * configuration can be found at all (no `.attest-it/policy.yaml` discoverable, or an
 * explicit `--config` path that can't be read). A missing or unreadable config is an
 * indeterminate state, so it must verify as not-approved rather than silently passing.
 *
 * @param gates - Array of gate IDs to verify, or empty for all gates
 * @param options - Command options
 * @param options.json - Output JSON for machine parsing
 * @param configPath - Explicit `--config` path (policy file override), if provided
 * @public
 */
async function runVerify(
  gates: string[],
  options: VerifyOptions,
  configPath?: string,
): Promise<void> {
  const projectRoot = process.cwd()

  try {
    // Resolve the working-tree policy path up front: even in --base mode we
    // fingerprint and read seals from the working tree, and we need this path to
    // locate the same file at the base ref.
    const workingTreePolicyPath = configPath ?? findPolicyPath(projectRoot)

    // Load split config (policy + operational, merged). The trust-critical policy
    // (rootGate/team/gates) comes from either:
    //   --base <ref>: <ref>'s committed policy.yaml — the trusted source, mirroring
    //     the GitHub Action's base-branch load. This makes verify a genuine CI trust
    //     boundary: a working-tree edit that self-adds a signer cannot pass.
    //   default: the working-tree policy.yaml (fast local pre-check).
    // The operational config (suites) is always read from the working tree in both
    // modes — suites carry no authorization, matching the Action.
    let config: AttestItConfig
    if (options.base !== undefined) {
      if (!workingTreePolicyPath) {
        // --base requires a working-tree policy to fingerprint against. Fail closed
        // rather than silently skipping the trust check.
        error(
          'No policy file found to verify. --base loads authorization from the ref ' +
            'but still fingerprints the working-tree .attest-it/policy.yaml, which is missing.',
        )
        process.exit(ExitCode.CONFIG_ERROR)
      }
      const refPolicy = readPolicyFromRef(options.base, workingTreePolicyPath, projectRoot)
      config = await loadSplitConfig({
        policySource: { type: 'content', content: refPolicy.content, format: refPolicy.format },
      })
    } else {
      config = await loadSplitConfig(
        configPath ? { policySource: { type: 'filesystem', path: configPath } } : {},
      )
    }

    // Read seals (needed for both the root-gate pre-step and gate evaluation).
    const sealsFile = readSealsSync(projectRoot, config.settings.sealsPath)

    // MANDATORY PRE-STEP: verify the config's OWN seal chain against the root
    // gate BEFORE evaluating any other gate. Gate evaluation must never proceed
    // against a policy whose own root-gate seal did not verify. Repositories that
    // have not run the bootstrap ceremony define no rootGate; there is no trust
    // anchor to check, so evaluation proceeds unchanged (backward compatibility).
    //
    // In --base mode the authorized signer set comes from the trusted ref, so a
    // working-tree policy that self-adds a root signer and re-seals is rejected as
    // UNKNOWN_SIGNER (the ref does not list it) — the same rejection the Action makes.
    if (config.rootGate) {
      const policyPath = workingTreePolicyPath
      if (policyPath) {
        const policyFingerprint = computePolicyFingerprintSync(projectRoot, policyPath)
        const rootResult = verifyRootGate({
          config,
          policyFingerprint,
          seals: sealsFile,
          ...(options.base !== undefined && {
            trustedSourceLabel: `root signers from ${options.base}`,
          }),
        })

        if (isBlockingRootGateState(rootResult.state)) {
          if (options.json) {
            outputJson([rootGateResultToJson(rootResult)])
          } else {
            log('')
            error(rootResult.message)
          }
          process.exit(ExitCode.FAILURE)
        }

        if (rootResult.state === 'STALE' && !options.json) {
          warn(rootResult.message)
        }
      }
    }

    // Config loaded successfully but defines zero gates: there is nothing to verify.
    // This is distinct from a missing/unreadable config (CONFIG_ERROR) — the config
    // is valid, so treat it as NO_WORK rather than an error or a silent success.
    if (!config.gates || Object.keys(config.gates).length === 0) {
      if (options.json) {
        outputJson([])
      } else {
        warn('No gates defined in configuration — nothing to verify')
      }
      process.exit(ExitCode.NO_WORK)
    }

    // Determine which gates to verify
    const gatesToVerify = gates.length > 0 ? gates : Object.keys(config.gates)

    // Validate that specified gates exist
    for (const gateId of gatesToVerify) {
      // eslint-disable-next-line security/detect-object-injection
      if (!config.gates[gateId]) {
        error(`Gate '${gateId}' not found in configuration`)
        process.exit(ExitCode.CONFIG_ERROR)
      }
    }

    // Compute fingerprints for all gates
    const fingerprints: Record<string, string> = {}
    for (const gateId of gatesToVerify) {
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
    const results =
      gates.length > 0
        ? gatesToVerify.map((gateId) =>
            // eslint-disable-next-line security/detect-object-injection
            verifyGateSeal(config, gateId, sealsFile, fingerprints[gateId] ?? ''),
          )
        : verifyAllSeals(config, sealsFile, fingerprints)

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
    if (err instanceof GitRefPolicyError) {
      // --base could not read the trusted policy from the ref. Fail CLOSED: an
      // unreadable base ref is an indeterminate trust state, never a silent pass.
      error(err.message)
    } else if (err instanceof SplitConfigNotFoundError) {
      // No discoverable config (or an unreadable --config path): fail closed with
      // a legible, actionable message rather than exiting 0 on an indeterminate state.
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
 * Shape a root-gate verification result into the same JSON envelope as ordinary
 * gate results so `verify --json` consumers see a single, uniform array.
 */
function rootGateResultToJson(result: RootGateVerificationResult): SealVerificationResult {
  return {
    gateId: result.gateId,
    state: result.state === 'NOT_ANCHORED' ? 'MISSING' : result.state,
    ...(result.seal && { seal: result.seal }),
    message: result.message,
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
function displayResults(results: SealVerificationResult[]): void {
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
      error(`${String(invalidCount)} gate(s) have invalid or missing seals`)
      log('Run `attest-it seal` to create seals for these gates')
    }
    if (staleCount > 0) {
      warn(`${String(staleCount)} gate(s) have stale seals (exceeds maxAge)`)
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
 * Format fingerprint for display.
 *
 * @param result - Verification result
 * @returns Formatted fingerprint string
 */
function formatFingerprint(result: SealVerificationResult): string {
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
function formatAge(result: SealVerificationResult): string {
  if (result.seal?.timestamp) {
    const timestamp = new Date(result.seal.timestamp)
    const now = Date.now()
    const ageMs = now - timestamp.getTime()
    const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24))

    if (result.state === 'STALE') {
      return `${String(ageDays)} days (stale)`
    }
    return `${String(ageDays)} days`
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
