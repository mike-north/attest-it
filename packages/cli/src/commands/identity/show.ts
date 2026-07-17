import { Command } from 'commander'
import { loadLocalConfig } from '@attest-it/core'
import { log, error } from '../../utils/output.js'
import { ExitCode } from '../../utils/exit-codes.js'
import { getTheme } from '../../components/theme.js'

export const showCommand = new Command('show')
  .description('Show identity details')
  .argument('[slug]', 'Identity slug (defaults to active identity)')
  .action(async (slug?: string) => {
    await runShow(slug)
  })

/**
 * Run the show command to display identity details.
 */
async function runShow(slug?: string): Promise<void> {
  try {
    const config = await loadLocalConfig()

    if (!config) {
      error('No identities configured')
      process.exit(ExitCode.CONFIG_ERROR)
    }

    const theme = getTheme()

    // Determine which identity to show
    let targetSlug: string
    let isActive: boolean

    if (slug) {
      targetSlug = slug
      isActive = slug === config.activeIdentity
    } else {
      targetSlug = config.activeIdentity
      isActive = true
    }

    const identity = config.identities[targetSlug]
    if (!identity) {
      error(`Identity "${targetSlug}" not found`)
      process.exit(ExitCode.CONFIG_ERROR)
    }

    log('')
    log(theme.blue.bold()('Identity Details:'))
    log('')
    log(`  Slug:       ${theme.blue(targetSlug)}${isActive ? theme.green(' (active)') : ''}`)
    log(`  Name:       ${identity.name}`)
    if (identity.email) {
      log(`  Email:      ${identity.email}`)
    }
    if (identity.github) {
      log(`  GitHub:     ${identity.github}`)
    }
    log('')
    log(`  Public Key: ${identity.publicKey}`)
    log('')

    // Show private key reference details
    log('  Private Key Storage:')
    switch (identity.privateKey.type) {
      case 'file':
        log(`    Type: VaultKeeper File`)
        log(`    ID: ${identity.privateKey.id}`)
        break
      case 'keychain':
        log(`    Type: macOS Keychain (via VaultKeeper)`)
        log(`    ID: ${identity.privateKey.id}`)
        break
      case '1password':
        log(`    Type: 1Password (via VaultKeeper)`)
        log(`    ID: ${identity.privateKey.id}`)
        if (identity.privateKey.vault) {
          log(`    Vault: ${identity.privateKey.vault}`)
        }
        break
      case 'yubikey':
        log(`    Type: YubiKey (via VaultKeeper)`)
        log(`    ID: ${identity.privateKey.id}`)
        break
      case 'filesystem':
        log(`    Type: File (legacy — not managed by VaultKeeper)`)
        log(`    Path: ${identity.privateKey.path}`)
        break
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
