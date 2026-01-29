import * as core from '@actions/core'
import { resolve } from 'node:path'
import {
  verifyAttestations,
  type VerifyResult,
  type SuiteVerificationResult,
  type AttestItConfig,
  loadSplitConfig,
  SplitConfigNotFoundError,
  CrossConfigValidationError,
  PolicyValidationError,
  OperationalValidationError,
  parsePolicyContent,
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

    core.info('Verifying attestations...')

    // Run verification
    const result = await verifyAttestations({ config })

    // Set outputs
    core.setOutput('valid', result.success.toString())
    core.setOutput('suites', JSON.stringify(result.suites))

    // Log results
    logResults(result)

    // Determine success/failure
    if (!result.signatureValid) {
      core.setFailed('Attestation signature verification failed')
      return
    }

    if (result.errors.length > 0) {
      for (const errorMsg of result.errors) {
        core.error(errorMsg)
      }
    }

    const invalid = result.suites.filter((s: SuiteVerificationResult) => s.status !== 'VALID')

    if (invalid.length > 0 && failOnMissing) {
      core.setFailed(`${String(invalid.length)} suite(s) have invalid attestations`)

      core.startGroup('Remediation steps')
      for (const s of invalid) {
        core.info(`Run: attest-it run --suite ${s.suite}`)
        if (s.message) {
          core.info(`  Reason: ${s.message}`)
        }
      }
      core.endGroup()
      return
    }

    // Check for warnings in strict mode
    if (strict) {
      const warningThreshold = 7 // days before expiry to warn
      const nearExpiry = result.suites.filter(
        (s: SuiteVerificationResult) =>
          s.status === 'VALID' && (s.age ?? 0) > config.settings.maxAgeDays - warningThreshold,
      )
      if (nearExpiry.length > 0) {
        core.setFailed('Attestations approaching expiry (strict mode)')
        for (const s of nearExpiry) {
          const age = s.age ?? 0
          core.warning(`${s.suite} is ${String(age)} days old`)
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

function logResults(result: VerifyResult): void {
  core.startGroup('Attestation status')

  for (const suite of result.suites) {
    const icon = suite.status === 'VALID' ? '✓' : '✗'
    const age = suite.age !== undefined ? ` (${String(suite.age)} days)` : ''
    core.info(`${icon} ${suite.suite}: ${suite.status}${age}`)
  }

  core.endGroup()
}

// Run the action when executed directly
const mainModule = process.argv[1]
if (mainModule !== undefined && import.meta.url === `file://${mainModule}`) {
  void run()
}
