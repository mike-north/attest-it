import { Command } from 'commander'
import { loadLocalConfig, getActiveIdentity } from '@attest-it/core'
import { log, error } from '../utils/output.js'
import { ExitCode } from '../utils/exit-codes.js'
import { getTheme } from '../components/theme.js'

export const whoamiCommand = new Command('whoami')
  .description('Show the current active identity')
  .action(async () => {
    await runWhoami()
  })

/**
 * Run the whoami command to display the current active identity.
 */
async function runWhoami(): Promise<void> {
  try {
    const config = await loadLocalConfig()

    if (!config) {
      error('No identities configured')
      log('')
      log('Run: attest-it identity create')
      process.exit(ExitCode.CONFIG_ERROR)
    }

    const identity = getActiveIdentity(config)

    if (!identity) {
      error('Active identity not found')
      process.exit(ExitCode.CONFIG_ERROR)
    }

    const theme = getTheme()

    log('')
    log(theme.green.bold()(identity.name))
    if (identity.email) {
      log(theme.muted(identity.email))
    }
    if (identity.github) {
      log(theme.muted('@' + identity.github))
    }
    log('')
    log(`Identity: ${theme.blue(config.activeIdentity)}`)
    log('')
  } catch (err) {
    if (err instanceof Error) {
      error(err.message)
    } else {
      error('Unknown error occurred')
    }
    process.exit(ExitCode.CONFIG_ERROR)
  }
}
