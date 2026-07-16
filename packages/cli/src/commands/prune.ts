/**
 * Prune command implementation for attest-it CLI.
 *
 * Operates on the seal model. A seal is prunable when its gate no longer exists
 * in the policy (an orphaned seal that can never verify again). The legacy
 * attestations file is no longer used.
 *
 * NOTE: The full R10 pruning semantics (artifact-existence checks, superseded
 * seals, file-per-seal storage) are tracked separately in #73, which builds on
 * the seal storage work in #70. This command intentionally implements only the
 * unambiguous orphaned-gate case so that no legacy attestation code path
 * remains after the generation-1 retirement.
 */

import { Command } from 'commander'
import { loadSplitConfig, readSealsSync, writeSealsSync, type Seal } from '@attest-it/core'
import { log, success, error, info, verbose } from '../utils/output.js'
import { ExitCode } from '../utils/exit-codes.js'

export const pruneCommand = new Command('prune')
  .description('Remove orphaned seals whose gate no longer exists')
  .option('-n, --dry-run', 'Show what would be removed without removing')
  .action(async (options: PruneOptions) => {
    await runPrune(options)
  })

interface PruneOptions {
  dryRun?: boolean
}

/**
 * Run the prune command to remove orphaned seals.
 *
 * A seal is orphaned when the gate it was created for no longer exists in the
 * policy. Such a seal can never match a gate again, so it is storage garbage
 * rather than a verification failure.
 *
 * @param options - Command options
 * @param options.dryRun - Show what would be removed without removing
 * @public
 */
async function runPrune(options: PruneOptions): Promise<void> {
  try {
    // Load split config (policy + operational, merged)
    const config = await loadSplitConfig()

    // Load seals from the configured seal storage
    const projectRoot = process.cwd()
    const sealsFile = readSealsSync(projectRoot, config.settings.sealsPath)

    const gateIds = new Set(Object.keys(config.gates ?? {}))
    const entries = Object.entries(sealsFile.seals)

    if (entries.length === 0) {
      info('No seals to prune')
      process.exit(ExitCode.SUCCESS)
      return
    }

    // A seal is orphaned when its gate is no longer defined in the policy.
    const orphaned: [string, Seal][] = []
    const kept: Record<string, Seal> = {}

    for (const [gateId, seal] of entries) {
      if (gateIds.has(gateId)) {
        // eslint-disable-next-line security/detect-object-injection -- gateId from validated seal keys
        kept[gateId] = seal
      } else {
        orphaned.push([gateId, seal])
        verbose(`Orphaned: ${gateId} (gate no longer defined in policy)`)
      }
    }

    if (orphaned.length === 0) {
      success('No orphaned seals found')
      process.exit(ExitCode.SUCCESS)
      return
    }

    log(`Found ${String(orphaned.length)} orphaned seal(s):`)
    for (const [gateId, seal] of orphaned) {
      log(`  - ${gateId} (sealed by ${seal.sealedBy})`)
    }

    if (options.dryRun) {
      info('Dry run - no changes made')
      process.exit(ExitCode.SUCCESS)
      return
    }

    // Write back the seals we are keeping
    writeSealsSync(projectRoot, { ...sealsFile, seals: kept }, config.settings.sealsPath)

    success(`Pruned ${String(orphaned.length)} orphaned seal(s)`)
    log(`Remaining: ${String(Object.keys(kept).length)} seal(s)`)
    process.exit(ExitCode.SUCCESS)
  } catch (err) {
    if (err instanceof Error) {
      error(err.message)
    } else {
      error('Unknown error occurred')
    }
    process.exit(ExitCode.CONFIG_ERROR)
    return
  }
}

export { runPrune }
