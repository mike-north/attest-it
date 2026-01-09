import { Command } from 'commander'
import {
  loadConfig,
  toAttestItConfig,
  verifyAttestations,
  type Config,
  type VerifyResult,
  type SuiteVerificationResult,
} from '@attest-it/core'
import {
  log,
  success,
  error,
  warn,
  formatTable,
  colorizeStatus,
  outputJson,
  type TableRow,
} from '../utils/output.js'
import { ExitCode } from '../utils/exit-codes.js'

export const verifyCommand = new Command('verify')
  .description('Verify all attestations (for CI)')
  .option('-s, --suite <name>', 'Verify specific suite only')
  .option('--json', 'Output JSON for machine parsing')
  .option('--strict', 'Fail on warnings (approaching expiry)')
  .action(async (options: VerifyOptions) => {
    await runVerify(options)
  })

interface VerifyOptions {
  suite?: string
  json?: boolean
  strict?: boolean
}

/**
 * Run the verify command to validate attestations.
 *
 * Verifies signature validity and checks attestation status for all suites
 * or a specific suite. Intended for CI/CD pipelines.
 *
 * @param options - Command options
 * @param options.suite - Verify specific suite only
 * @param options.json - Output JSON for machine parsing
 * @param options.strict - Fail on warnings (approaching expiry)
 * @public
 */
async function runVerify(options: VerifyOptions): Promise<void> {
  try {
    // Load config
    const config = await loadConfig()

    // Filter to specific suite if requested
    if (options.suite) {
      if (!config.suites[options.suite]) {
        error(`Suite "${options.suite}" not found in config`)
        process.exit(ExitCode.CONFIG_ERROR)
      }
      // Create filtered config
      const filteredSuiteEntry = config.suites[options.suite]
      if (!filteredSuiteEntry) {
        error(`Suite "${options.suite}" not found in config`)
        process.exit(ExitCode.CONFIG_ERROR)
      }
      const filteredConfig: Config = {
        version: config.version,
        settings: config.settings,
        suites: { [options.suite]: filteredSuiteEntry },
      }

      // Run verification with filtered config, converting from Zod Config to AttestItConfig
      const result = await verifyAttestations({ config: toAttestItConfig(filteredConfig) })

      // Output results
      if (options.json) {
        outputJson(result)
      } else {
        displayResults(result, filteredConfig.settings.maxAgeDays, options.strict)
      }

      // Determine exit code
      if (!result.success) {
        process.exit(ExitCode.FAILURE)
        return
      }

      if (options.strict && hasWarnings(result, filteredConfig.settings.maxAgeDays)) {
        process.exit(ExitCode.FAILURE)
        return
      }

      process.exit(ExitCode.SUCCESS)
      return
    }

    // Run verification with full config, converting from Zod Config to AttestItConfig
    const result = await verifyAttestations({ config: toAttestItConfig(config) })

    // Output results
    if (options.json) {
      outputJson(result)
    } else {
      displayResults(result, config.settings.maxAgeDays, options.strict)
    }

    // Determine exit code
    if (!result.success) {
      process.exit(ExitCode.FAILURE)
    }

    if (options.strict && hasWarnings(result, config.settings.maxAgeDays)) {
      process.exit(ExitCode.FAILURE)
    }

    process.exit(ExitCode.SUCCESS)
  } catch (err) {
    if (err instanceof Error) {
      error(err.message)
    } else {
      error('Unknown error occurred')
    }
    process.exit(2)
  }
}

/**
 * Display verification results in a formatted table.
 *
 * Shows signature status, errors, suite results, and remediation steps.
 *
 * @param result - Verification result from verifyAttestations
 * @param maxAgeDays - Maximum age in days before expiry
 * @param strict - Whether to show warnings as errors
 * @public
 */
function displayResults(result: VerifyResult, maxAgeDays: number, strict?: boolean): void {
  log('')

  // Signature status
  if (!result.signatureValid) {
    error('Signature verification FAILED')
    log('The attestations file may have been tampered with.')
    log('')
  }

  // Errors
  for (const errorMsg of result.errors) {
    error(errorMsg)
  }
  if (result.errors.length > 0) {
    log('')
  }

  // Suite results as table
  const tableRows: TableRow[] = result.suites.map((s) => ({
    suite: s.suite,
    status: colorizeStatus(s.status),
    fingerprint: s.fingerprint.slice(0, 16) + '...',
    age: formatAgeColumn(s),
  }))

  log(formatTable(tableRows))
  log('')

  // Summary
  if (result.success) {
    success('All attestations valid')
  } else {
    // Show remediation steps
    const needsAttestation = result.suites.filter((s) => s.status !== 'VALID')

    if (needsAttestation.length > 0) {
      log('Remediation:')
      for (const suite of needsAttestation) {
        log(`  attest-it run --suite ${suite.suite}`)
        if (suite.message) {
          log(`    ${suite.message}`)
        }
      }
    }
  }

  // Warnings (approaching expiry)
  const warningThreshold = 7 // days before expiry to warn
  const nearExpiry = result.suites.filter(
    (s) => s.status === 'VALID' && (s.age ?? 0) > maxAgeDays - warningThreshold,
  )

  if (nearExpiry.length > 0) {
    log('')
    for (const suite of nearExpiry) {
      warn(`${suite.suite} attestation approaching expiry (${String(suite.age)} days old)`)
    }
    if (strict) {
      log('(--strict mode: warnings are treated as errors)')
    }
  }
}

function formatAgeColumn(s: SuiteVerificationResult): string {
  if (s.status === 'VALID') {
    return `${String(s.age ?? 0)} days`
  }

  if (s.status === 'NEEDS_ATTESTATION') {
    return '(none)'
  }

  if (s.status === 'EXPIRED') {
    return `${String(s.age ?? 0)} days (expired)`
  }

  if (s.status === 'FINGERPRINT_CHANGED') {
    return '(changed)'
  }

  if (s.status === 'INVALIDATED_BY_PARENT') {
    return '(invalidated)'
  }

  return '-'
}

/**
 * Check if verification result has warnings.
 *
 * Returns true if any valid attestations are approaching expiry
 * (within 7 days of maxAgeDays).
 *
 * @param result - Verification result to check
 * @param maxAgeDays - Maximum age in days before expiry
 * @returns True if warnings exist, false otherwise
 * @public
 */
function hasWarnings(result: VerifyResult, maxAgeDays: number): boolean {
  const warningThreshold = 7 // days before expiry to warn
  return result.suites.some(
    (s) => s.status === 'VALID' && (s.age ?? 0) > maxAgeDays - warningThreshold,
  )
}

export { runVerify, displayResults, hasWarnings }
