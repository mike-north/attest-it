import { Command } from 'commander'
import { loadLocalConfig, saveLocalConfig } from '@attest-it/core'
import { success, error } from '../../utils/output.js'
import { ExitCode } from '../../utils/exit-codes.js'

export const useCommand = new Command('use')
  .description('Set the active identity')
  .argument('<slug>', 'Identity slug to activate')
  .action(async (slug: string) => {
    await runUse(slug)
  })

/**
 * Run the use command to set the active identity.
 */
async function runUse(slug: string): Promise<void> {
  try {
    const config = await loadLocalConfig()

    if (!config) {
      error('No identities configured')
      process.exit(ExitCode.CONFIG_ERROR)
    }

    // Check if identity exists
    const identity = config.identities[slug]
    if (!identity) {
      error(`Identity "${slug}" not found`)
      process.exit(ExitCode.CONFIG_ERROR)
    }

    // Update active identity
    const newConfig = {
      ...config,
      activeIdentity: slug,
    }

    await saveLocalConfig(newConfig)

    success(`Active identity set to: ${identity.name} (${slug})`)
  } catch (err) {
    if (err instanceof Error) {
      error(err.message)
    } else {
      error('Unknown error occurred')
    }
    process.exit(ExitCode.CONFIG_ERROR)
  }
}
