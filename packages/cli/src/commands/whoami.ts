import { Command } from 'commander'
import { loadLocalConfig, getActiveIdentity } from '@attest-it/core'
import type { PrivateKeyRef } from '@attest-it/core'
import { log, error, getTheme } from '../utils/output.js'
import { ExitCode } from '../utils/exit-codes.js'

/**
 * Format the private key storage location for display.
 */
function formatKeyLocation(privateKey: PrivateKeyRef): string {
  const theme = getTheme()

  switch (privateKey.type) {
    case 'file':
      return `${theme.blue.bold()('File')}: ${theme.muted(privateKey.path)}`
    case 'keychain': {
      let keychainName = 'default'
      if (privateKey.keychain) {
        const filename = privateKey.keychain.split('/').pop() ?? privateKey.keychain
        keychainName = filename.replace(/\.keychain(-db)?$/, '')
      }
      return `${theme.blue.bold()('macOS Keychain')}: ${theme.muted(`${keychainName}/${privateKey.service}`)}`
    }
    case '1password': {
      const parts = [privateKey.vault, privateKey.item]
      if (privateKey.account) {
        parts.unshift(privateKey.account)
      }
      return `${theme.blue.bold()('1Password')}: ${theme.muted(parts.join('/'))}`
    }
    default:
      return 'Unknown storage'
  }
}

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
    log(theme.blue.bold()('Active Identity'))
    log('')
    log(`  Slug:       ${theme.green.bold()(config.activeIdentity)}`)
    log(`  Name:       ${identity.name}`)
    if (identity.email) {
      log(`  Email:      ${theme.muted(identity.email)}`)
    }
    if (identity.github) {
      log(`  GitHub:     ${theme.muted('@' + identity.github)}`)
    }
    log(`  Public Key: ${theme.muted(identity.publicKey.slice(0, 24) + '...')}`)
    log(`  Key Store:  ${formatKeyLocation(identity.privateKey)}`)
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
