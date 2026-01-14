import { Command } from 'commander'
import { loadLocalConfig } from '@attest-it/core'
import { log, error } from '../../utils/output.js'
import { ExitCode } from '../../utils/exit-codes.js'
import { getTheme } from '../../components/theme.js'

export const listCommand = new Command('list')
  .description('List all local identities')
  .action(async () => {
    await runList()
  })

/**
 * Run the list command to display all configured identities.
 */
async function runList(): Promise<void> {
  try {
    const config = await loadLocalConfig()

    if (!config) {
      error('No identities configured')
      log('')
      log('Run: attest-it identity create')
      process.exit(ExitCode.CONFIG_ERROR)
    }

    const theme = getTheme()
    const identities = Object.entries(config.identities)

    log('')
    log(theme.blue.bold()('Local Identities:'))
    log('')

    for (const [slug, identity] of identities) {
      const isActive = slug === config.activeIdentity
      const marker = isActive ? theme.green('★') : ' '
      const nameDisplay = isActive ? theme.green.bold()(identity.name) : identity.name

      // Truncate public key for display
      const keyPreview = identity.publicKey.slice(0, 12) + '...'

      // Determine key storage type
      let keyType: string
      switch (identity.privateKey.type) {
        case 'file':
          keyType = 'file'
          break
        case 'keychain':
          keyType = 'keychain'
          break
        case '1password':
          keyType = '1password'
          break
      }

      log(`${marker} ${theme.blue(slug)}`)
      log(`  Name:       ${nameDisplay}`)
      if (identity.email) {
        log(`  Email:      ${identity.email}`)
      }
      if (identity.github) {
        log(`  GitHub:     ${identity.github}`)
      }
      log(`  Public Key: ${keyPreview}`)
      log(`  Key Type:   ${keyType}`)
      log('')
    }

    if (identities.length === 1) {
      log(`1 identity configured`)
    } else {
      log(`${identities.length.toString()} identities configured`)
    }
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

export { runList }
