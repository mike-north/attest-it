/**
 * Prune command implementation for attest-it CLI.
 */

import { Command } from 'commander'
import * as fs from 'node:fs'
import {
  loadConfig,
  readAttestations,
  writeSignedAttestations,
  computeFingerprint,
  getDefaultPrivateKeyPath,
  type Attestation,
} from '@attest-it/core'
import { log, success, error, info, verbose } from '../utils/output.js'
import { ExitCode } from '../utils/exit-codes.js'

export const pruneCommand = new Command('prune')
  .description('Remove stale attestations')
  .option('-n, --dry-run', 'Show what would be removed without removing')
  .option('-k, --keep-days <n>', 'Keep attestations newer than n days', '30')
  .action(async (options: PruneOptions) => {
    await runPrune(options)
  })

interface PruneOptions {
  dryRun?: boolean
  keepDays: string
}

/**
 * Run the prune command to remove stale attestations.
 *
 * Removes attestations that are outdated (older than keepDays and
 * fingerprint doesn't match current code) or orphaned (suite no
 * longer exists in config). Re-signs the attestations file.
 *
 * @param options - Command options
 * @param options.dryRun - Show what would be removed without removing
 * @param options.keepDays - Keep attestations newer than n days
 * @public
 */
async function runPrune(options: PruneOptions): Promise<void> {
  try {
    const keepDays = parseInt(options.keepDays, 10)
    if (isNaN(keepDays) || keepDays < 1) {
      error('--keep-days must be a positive integer')
      process.exit(ExitCode.CONFIG_ERROR)
      return
    }

    // Load config
    const config = await loadConfig()

    // Load attestations
    const attestationsPath = config.settings.attestationsPath
    const file = await readAttestations(attestationsPath)

    if (!file || file.attestations.length === 0) {
      info('No attestations to prune')
      process.exit(ExitCode.SUCCESS)
      return
    }

    const now = Date.now()
    const keepMs = keepDays * 24 * 60 * 60 * 1000

    // Identify stale attestations
    const stale: Attestation[] = []
    const keep: Attestation[] = []

    for (const attestation of file.attestations) {
      const attestedAt = new Date(attestation.attestedAt).getTime()
      const ageMs = now - attestedAt
      const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24))

      // Check if suite still exists in config
      const suiteExists = attestation.suite in config.suites

      // Check if fingerprint still matches current code
      let fingerprintMatches = false
      if (suiteExists) {
        const suiteConfig = config.suites[attestation.suite]
        if (suiteConfig) {
          const fingerprintOptions = {
            packages: suiteConfig.packages,
            ...(suiteConfig.ignore && { ignore: suiteConfig.ignore }),
          }
          const result = await computeFingerprint(fingerprintOptions)
          fingerprintMatches = result.fingerprint === attestation.fingerprint
        }
      }

      // Keep if:
      // 1. Age is within keepDays AND fingerprint matches, OR
      // 2. Fingerprint matches current code (regardless of age)
      const isStale = !fingerprintMatches && ageMs > keepMs
      const orphaned = !suiteExists

      if (isStale || orphaned) {
        stale.push(attestation)
        const reason = orphaned
          ? 'suite removed'
          : !fingerprintMatches
            ? 'fingerprint changed'
            : 'expired'
        verbose(`Stale: ${attestation.suite} (${reason}, ${String(ageDays)} days old)`)
      } else {
        keep.push(attestation)
      }
    }

    // Report what will be pruned
    if (stale.length === 0) {
      success('No stale attestations found')
      process.exit(ExitCode.SUCCESS)
      return
    }

    log(`Found ${String(stale.length)} stale attestation(s):`)
    for (const attestation of stale) {
      const ageDays = Math.floor(
        (now - new Date(attestation.attestedAt).getTime()) / (1000 * 60 * 60 * 24),
      )
      log(`  - ${attestation.suite} (${String(ageDays)} days old)`)
    }

    if (options.dryRun) {
      info('Dry run - no changes made')
      process.exit(ExitCode.SUCCESS)
      return
    }

    // Check for private key
    const privateKeyPath = getDefaultPrivateKeyPath()
    if (!fs.existsSync(privateKeyPath)) {
      error(`Private key not found: ${privateKeyPath}`)
      error('Cannot re-sign attestations file.')
      process.exit(ExitCode.MISSING_KEY)
      return
    }

    // Write updated attestations
    await writeSignedAttestations({
      filePath: attestationsPath,
      attestations: keep,
      privateKeyPath,
    })

    success(`Pruned ${String(stale.length)} stale attestation(s)`)
    log(`Remaining: ${String(keep.length)} attestation(s)`)
    process.exit(ExitCode.SUCCESS)
  } catch (err) {
    if (err instanceof Error) {
      error(err.message)
    } else {
      error('Unknown error occurred')
    }
    process.exit(2)
    return
  }
}

export { runPrune }
