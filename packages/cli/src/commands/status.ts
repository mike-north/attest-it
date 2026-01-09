import { Command } from 'commander'
import {
  loadConfig,
  computeFingerprint,
  readAttestations,
  findAttestation,
  type VerificationStatus,
  type AttestationsFile,
  type Attestation,
} from '@attest-it/core'
import {
  log,
  success,
  error,
  formatTable,
  colorizeStatus,
  outputJson,
  type TableRow,
} from '../utils/output.js'
import { ExitCode } from '../utils/exit-codes.js'

export const statusCommand = new Command('status')
  .description('Show attestation status for all suites')
  .option('-s, --suite <name>', 'Show status for specific suite only')
  .option('--json', 'Output JSON for machine parsing')
  .action(async (options: StatusOptions) => {
    await runStatus(options)
  })

interface StatusOptions {
  suite?: string
  json?: boolean
}

interface SuiteStatus {
  name: string
  status: VerificationStatus
  currentFingerprint: string
  attestedFingerprint?: string | undefined
  attestedAt?: string | undefined
  age?: number | undefined
}

/**
 * Run the status command to show attestation status.
 *
 * Displays the current status of attestations for all suites or a specific suite,
 * including validation status, fingerprints, and age information.
 *
 * @param options - Command options
 * @param options.suite - Show status for specific suite only
 * @param options.json - Output JSON for machine parsing
 * @public
 */
async function runStatus(options: StatusOptions): Promise<void> {
  try {
    // Load config
    const config = await loadConfig()

    // Load attestations (may not exist)
    const attestationsPath = config.settings.attestationsPath
    let attestationsFile: AttestationsFile | null = null
    try {
      attestationsFile = await readAttestations(attestationsPath)
    } catch (err) {
      // Attestations file may not exist yet - that's okay
      if (err instanceof Error && !err.message.includes('ENOENT')) {
        throw err
      }
    }
    const attestations = attestationsFile?.attestations ?? []

    // Get suites to check
    const suiteNames = options.suite ? [options.suite] : Object.keys(config.suites)

    // Validate suite exists
    if (options.suite && !config.suites[options.suite]) {
      error(`Suite "${options.suite}" not found in config`)
      process.exit(ExitCode.CONFIG_ERROR)
    }

    // Check each suite
    const results: SuiteStatus[] = []
    let hasInvalid = false

    for (const suiteName of suiteNames) {
      // eslint-disable-next-line security/detect-object-injection
      const suiteConfig = config.suites[suiteName]
      if (!suiteConfig) continue

      // Compute current fingerprint
      const fingerprintResult = await computeFingerprint({
        packages: suiteConfig.packages,
        ...(suiteConfig.ignore && { ignore: suiteConfig.ignore }),
      })

      // Find existing attestation
      const attestation = findAttestation(
        {
          schemaVersion: '1',
          attestations,
          signature: '',
        },
        suiteName,
      )

      // Determine status
      const status = determineStatus(
        attestation ?? null,
        fingerprintResult.fingerprint,
        config.settings.maxAgeDays,
      )

      // Calculate age if attestation exists
      let age: number | undefined
      if (attestation) {
        const attestedAt = new Date(attestation.attestedAt)
        age = Math.floor((Date.now() - attestedAt.getTime()) / (1000 * 60 * 60 * 24))
      }

      if (status !== 'VALID') {
        hasInvalid = true
      }

      results.push({
        name: suiteName,
        status,
        currentFingerprint: fingerprintResult.fingerprint,
        attestedFingerprint: attestation?.fingerprint,
        attestedAt: attestation?.attestedAt,
        age,
      })
    }

    // Output results
    if (options.json) {
      outputJson(results)
    } else {
      displayStatusTable(results, hasInvalid)
    }

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

function determineStatus(
  attestation: Attestation | null,
  currentFingerprint: string,
  maxAgeDays: number,
): VerificationStatus {
  if (!attestation) {
    return 'NEEDS_ATTESTATION'
  }

  if (attestation.fingerprint !== currentFingerprint) {
    return 'FINGERPRINT_CHANGED'
  }

  const attestedAt = new Date(attestation.attestedAt)
  const ageInDays = Math.floor((Date.now() - attestedAt.getTime()) / (1000 * 60 * 60 * 24))

  if (ageInDays > maxAgeDays) {
    return 'EXPIRED'
  }

  return 'VALID'
}

function displayStatusTable(results: SuiteStatus[], hasInvalid: boolean): void {
  const tableRows: TableRow[] = results.map((r) => ({
    suite: r.name,
    status: colorizeStatus(r.status),
    fingerprint: r.currentFingerprint.slice(0, 16) + '...',
    age: formatAge(r),
  }))

  log('')
  log(formatTable(tableRows))
  log('')

  if (hasInvalid) {
    log('Run `attest-it run --suite <name>` to update attestations')
  } else {
    success('All attestations valid')
  }
}

function formatAge(result: SuiteStatus): string {
  if (result.status === 'VALID') {
    return `${String(result.age ?? 0)} days`
  }

  if (result.status === 'FINGERPRINT_CHANGED') {
    return '(changed)'
  }

  if (result.status === 'NEEDS_ATTESTATION') {
    return '(none)'
  }

  if (result.status === 'EXPIRED') {
    return `${String(result.age ?? 0)} days (expired)`
  }

  return '-'
}

export { runStatus }
