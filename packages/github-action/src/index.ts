import * as core from '@actions/core'
import {
  loadConfig,
  toAttestItConfig,
  verifyAttestations,
  type VerifyResult,
} from '@attest-it/core'

export async function run(): Promise<void> {
  try {
    // Get inputs
    const workingDirectory = core.getInput('working-directory') || '.'
    const configPath = core.getInput('config-path')
    const suite = core.getInput('suite')
    const failOnMissing = core.getInput('fail-on-missing') === 'true'
    const strict = core.getInput('strict') === 'true'

    // Change to working directory if specified
    if (workingDirectory !== '.') {
      core.info(`Changing to working directory: ${workingDirectory}`)
      process.chdir(workingDirectory)
    }

    core.info('Loading configuration...')

    // Load config
    const loadedConfig = await loadConfig(configPath || undefined)
    let config = toAttestItConfig(loadedConfig)

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

    const invalid = result.suites.filter((s) => s.status !== 'VALID')

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
        (s) => s.status === 'VALID' && (s.age ?? 0) > config.settings.maxAgeDays - warningThreshold,
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
