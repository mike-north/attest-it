import * as core from '@actions/core'
import { resolve } from 'node:path'
import {
  readSeals,
  verifyAllSeals,
  computeFingerprint,
  computePolicyFingerprint,
  verifyRootGate,
  isBlockingRootGateState,
  type SealVerificationResult,
  type AttestItConfig,
  type SealsFile,
  loadSplitConfig,
  SplitConfigNotFoundError,
  CrossConfigValidationError,
  PolicyValidationError,
  OperationalValidationError,
} from '@attest-it/core'
import { fetchPolicyFromRef, getRepoInfo, getBaseBranch, isPullRequest } from './fetch-policy.js'

/**
 * Type guard to check if an error is a file not found error.
 * Uses type assertions in a controlled way within a type guard function.
 */
function isFileNotFoundError(err: unknown): err is Error & { code: string; path?: string } {
  if (!(err instanceof Error)) return false
  // Type assertion justified: we're in a type guard checking runtime properties
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const errWithCode = err as { code?: unknown }
  return 'code' in err && errWithCode.code === 'ENOENT'
}

export async function run(): Promise<void> {
  try {
    // Get inputs
    const workingDirectory = core.getInput('working-directory') || '.'
    const configPath = core.getInput('config-path')
    const githubToken = core.getInput('github-token')
    const policyPath = core.getInput('policy-path') || '.attest-it/policy.yaml'
    const policyRef = core.getInput('policy-ref') || undefined
    const suite = core.getInput('suite')
    const failOnMissing = core.getInput('fail-on-missing') === 'true'
    const strict = core.getInput('strict') === 'true'

    // Change to working directory if specified
    if (workingDirectory !== '.') {
      core.info(`Changing to working directory: ${workingDirectory}`)
      process.chdir(workingDirectory)
    }

    // Construct full paths from repo root for GitHub API calls
    // When working-directory is set, policy/config paths are relative to it
    const repoRootPolicyPath =
      workingDirectory !== '.' ? `${workingDirectory}/${policyPath}` : policyPath

    core.info('Loading configuration...')

    let config: AttestItConfig

    // Determine the policy ref to use:
    // 1. If policy-ref is explicitly specified, always use it
    // 2. Otherwise, if in PR context, use the base branch
    // 3. Otherwise, load from filesystem (no ref needed)
    const isInPR = isPullRequest()
    const baseBranch = getBaseBranch()
    const effectivePolicyRef = policyRef ?? (isInPR ? baseBranch : undefined)

    // Validate PR context when no explicit policy-ref
    if (isInPR && !policyRef && !baseBranch) {
      core.setFailed('Running in PR context but base branch not detected')
      return
    }

    const operationalConfigPath = configPath || '.attest-it/config.yaml'

    try {
      if (effectivePolicyRef) {
        // Fetch policy from specified ref (or base branch for PRs)
        core.info(`Fetching policy from ref: ${effectivePolicyRef}`)

        const { owner, repo } = getRepoInfo()

        // Fetch policy from the specified ref
        // Use full path from repo root for API call
        const policyResult = await fetchPolicyFromRef({
          token: githubToken,
          owner,
          repo,
          ref: effectivePolicyRef,
          path: repoRootPolicyPath,
        })

        core.info(`Fetched policy from ${effectivePolicyRef} (SHA: ${policyResult.sha})`)

        // Determine format from path
        const policyFormat = policyPath.endsWith('.json') ? 'json' : 'yaml'

        // Use shared loadSplitConfig with policy content from API
        core.info('Validating configuration...')
        config = await loadSplitConfig({
          policySource: {
            type: 'content',
            content: policyResult.content,
            format: policyFormat,
          },
          operationalPath: resolve(process.cwd(), operationalConfigPath),
        })
      } else {
        // Non-PR context without policy-ref: load both from filesystem
        core.info('Loading configuration from filesystem')

        // Use shared loadSplitConfig for filesystem loading
        core.info('Validating configuration...')
        config = await loadSplitConfig({
          policySource: {
            type: 'filesystem',
            path: resolve(process.cwd(), policyPath),
          },
          operationalPath: resolve(process.cwd(), operationalConfigPath),
        })
      }
    } catch (err: unknown) {
      if (err instanceof PolicyValidationError) {
        core.setFailed(`Policy validation failed: ${err.message}`)
        return
      }
      if (err instanceof OperationalValidationError) {
        core.setFailed(`Operational config validation failed: ${err.message}`)
        return
      }
      if (err instanceof CrossConfigValidationError) {
        core.error('Configuration validation failed:')
        for (const error of err.errors) {
          core.error(`- ${error.message}`)
        }
        core.setFailed('Configuration validation failed. See errors above.')
        return
      }
      if (err instanceof SplitConfigNotFoundError) {
        core.setFailed(`Configuration file not found: ${err.message}`)
        return
      }
      // Handle file not found errors (legacy)
      if (isFileNotFoundError(err)) {
        core.setFailed(`Configuration file not found: ${err.path ?? 'unknown'}`)
        return
      }
      throw err
    }

    // Filter to specific suite if requested
    if (suite) {
      // eslint-disable-next-line security/detect-object-injection
      const suiteConfig = config.suites[suite]
      if (!suiteConfig) {
        core.setFailed(`Suite "${suite}" not found in config`)
        return
      }
      config = { ...config, suites: { [suite]: suiteConfig } }
    }

    core.info('Verifying seals...')

    // Load seals file
    const sealsPath = config.settings.sealsPath ?? '.attest-it/seals.json'
    let seals: SealsFile
    try {
      seals = await readSeals(process.cwd(), sealsPath)
    } catch (err) {
      if (isFileNotFoundError(err)) {
        // No seals file means all gates need attestation
        seals = { version: 1, seals: {} }
      } else {
        throw err
      }
    }

    // MANDATORY PRE-STEP: verify the config's OWN seal chain against the root
    // gate BEFORE evaluating any other gate. In a PR context `config` (and thus
    // the root gate's authorized signers) is loaded from the BASE branch — the
    // trusted source — while the policy fingerprint and seals come from the PR
    // working tree. A branch that modifies the trust-critical policy without a
    // fresh root seal from a base-branch-authorized root signer therefore fails
    // here, before any gate is trusted. A branch that adds itself as a root
    // signer and self-seals is rejected as UNKNOWN_SIGNER (the base branch does
    // not list it) — a branch cannot bootstrap a new root of trust for itself.
    if (config.rootGate) {
      const workingTreePolicyPath = resolve(process.cwd(), policyPath)
      const policyFingerprint = await computePolicyFingerprint(process.cwd(), workingTreePolicyPath)
      const rootResult = verifyRootGate({
        config,
        policyFingerprint,
        seals,
        trustedSourceLabel: effectivePolicyRef
          ? `root signers from ${effectivePolicyRef}`
          : undefined,
      })

      if (isBlockingRootGateState(rootResult.state)) {
        core.setFailed(rootResult.message)
        return
      }
      if (rootResult.state === 'STALE') {
        core.warning(rootResult.message)
      }
      core.info('✓ Root gate verified: policy.yaml is sealed by an authorized root signer')
    }

    // Compute fingerprints for all gates
    const fingerprints: Record<string, string> = {}
    if (config.gates) {
      for (const [gateId, gateConfig] of Object.entries(config.gates)) {
        const result = await computeFingerprint({
          paths: gateConfig.fingerprint.paths,
          ...(gateConfig.fingerprint.exclude && { exclude: gateConfig.fingerprint.exclude }),
        })
        fingerprints[gateId] = result.fingerprint
      }
    }

    // Run verification using seal system
    const sealResults = verifyAllSeals(config, seals, fingerprints)

    // Map results to suite-based format for compatibility
    const suiteResults = mapSealResultsToSuites(config, sealResults)

    // Check for any invalid seals (signature verification failures)
    const signatureInvalid = sealResults.some((r) => r.state === 'INVALID_SIGNATURE')

    // Set outputs
    const allValid = sealResults.every((r) => r.state === 'VALID')
    core.setOutput('valid', allValid.toString())
    core.setOutput('suites', JSON.stringify(suiteResults))

    // Log results
    logResults(sealResults)

    // Determine success/failure
    if (signatureInvalid) {
      core.setFailed('Attestation signature verification failed')
      return
    }

    const invalid = sealResults.filter((r) => r.state !== 'VALID')

    if (invalid.length > 0 && failOnMissing) {
      core.setFailed(`${String(invalid.length)} suite(s) have invalid attestations`)

      core.startGroup('Remediation steps')
      for (const r of invalid) {
        core.info(`Run: attest-it run --suite ${r.gateId}`)
        if (r.message) {
          core.info(`  Reason: ${r.message}`)
        }
      }
      core.endGroup()
      return
    }

    // Check for warnings in strict mode
    if (strict) {
      const warningThreshold = 7 // days before expiry to warn
      const warningThresholdMs = warningThreshold * 24 * 60 * 60 * 1000
      const now = Date.now()

      const nearExpiry = sealResults.filter((r) => {
        if (r.state !== 'VALID' || !r.seal) return false
        const sealTime = new Date(r.seal.timestamp).getTime()
        const ageMs = now - sealTime
        const maxAgeMs = config.settings.maxAgeDays * 24 * 60 * 60 * 1000
        return ageMs > maxAgeMs - warningThresholdMs
      })

      if (nearExpiry.length > 0) {
        core.setFailed('Attestations approaching expiry (strict mode)')
        for (const r of nearExpiry) {
          if (r.seal) {
            const ageMs = now - new Date(r.seal.timestamp).getTime()
            const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000))
            core.warning(`${r.gateId} is ${String(ageDays)} days old`)
          }
        }
        return
      }
    }

    core.info('✓ All attestations valid')
  } catch (err) {
    if (err instanceof Error) {
      core.setFailed(err.message)
    } else {
      core.setFailed('Unknown error occurred')
    }
  }
}

/**
 * Map seal verification states to suite status strings for output compatibility.
 */
function mapSealStateToStatus(
  state: SealVerificationResult['state'],
): 'VALID' | 'NEEDS_ATTESTATION' | 'FINGERPRINT_CHANGED' | 'EXPIRED' {
  switch (state) {
    case 'VALID':
      return 'VALID'
    case 'MISSING':
    case 'UNKNOWN_SIGNER':
    case 'INVALID_SIGNATURE':
      return 'NEEDS_ATTESTATION'
    case 'FINGERPRINT_MISMATCH':
      return 'FINGERPRINT_CHANGED'
    case 'STALE':
      return 'EXPIRED'
    default:
      return 'NEEDS_ATTESTATION'
  }
}

/**
 * Map seal verification results to suite-based format for output compatibility.
 */
function mapSealResultsToSuites(
  config: AttestItConfig,
  sealResults: SealVerificationResult[],
): { suite: string; status: string; message?: string }[] {
  // For each suite, find its gate and get the seal result
  const results: { suite: string; status: string; message?: string }[] = []

  for (const [suiteName, suiteConfig] of Object.entries(config.suites)) {
    const gateId = suiteConfig.gate
    const sealResult = sealResults.find((r) => r.gateId === gateId)

    if (!sealResult) {
      results.push({
        suite: suiteName,
        status: 'NEEDS_ATTESTATION',
        message: `No gate '${gateId}' found`,
      })
    } else {
      results.push({
        suite: suiteName,
        status: mapSealStateToStatus(sealResult.state),
        message: sealResult.message,
      })
    }
  }

  return results
}

function logResults(results: SealVerificationResult[]): void {
  core.startGroup('Attestation status')

  for (const result of results) {
    const icon = result.state === 'VALID' ? '✓' : '✗'
    const status = mapSealStateToStatus(result.state)
    core.info(`${icon} ${result.gateId}: ${status}`)
  }

  core.endGroup()
}

// Run the action when executed directly
const mainModule = process.argv[1]
if (mainModule !== undefined && import.meta.url === `file://${mainModule}`) {
  void run()
}
