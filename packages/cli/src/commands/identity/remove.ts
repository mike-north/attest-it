import { Command } from 'commander'
import { confirm } from '@inquirer/prompts'
import { loadLocalConfig, saveLocalConfig } from '@attest-it/core'
import { log, success, error, getTheme } from '../../utils/output.js'
import { ExitCode } from '../../utils/exit-codes.js'
import { formatKeyLocation } from '../../utils/format-key-location.js'
import { unlink } from 'node:fs/promises'

export const removeCommand = new Command('remove')
  .description('Delete identity and optionally delete private key')
  .argument('<slug>', 'Identity slug to remove')
  .action(async (slug: string) => {
    await runRemove(slug)
  })

/**
 * Run the remove command to delete an identity.
 */
async function runRemove(slug: string): Promise<void> {
  try {
    const config = await loadLocalConfig()

    if (!config) {
      error('No identities configured')
      process.exit(ExitCode.CONFIG_ERROR)
    }

    const identity = config.identities[slug]
    if (!identity) {
      error(`Identity "${slug}" not found`)
      process.exit(ExitCode.CONFIG_ERROR)
    }

    const theme = getTheme()

    log('')
    log(theme.blue.bold()(`Remove Identity: ${slug}`))
    log('')
    log(`  Name:  ${identity.name}`)
    if (identity.email) {
      log(`  Email: ${identity.email}`)
    }
    log('')

    // Confirm deletion
    const confirmDelete = await confirm({
      message: 'Are you sure you want to delete this identity?',
      default: false,
    })

    if (!confirmDelete) {
      log('Cancelled')
      process.exit(ExitCode.CANCELLED)
    }

    // Ask about deleting private key, showing where it's stored
    const keyLocation = formatKeyLocation(identity.privateKey)
    log(`  Private key: ${keyLocation}`)
    log('')

    const deletePrivateKey = await confirm({
      message: 'Also delete the private key from storage?',
      default: false,
    })

    // Delete private key if requested
    if (deletePrivateKey) {
      switch (identity.privateKey.type) {
        case 'file': {
          try {
            await unlink(identity.privateKey.path)
            log(`  Deleted private key file: ${identity.privateKey.path}`)
          } catch (err) {
            // Ignore file not found errors
            if (err && typeof err === 'object' && 'code' in err && err.code !== 'ENOENT') {
              throw err
            }
          }
          break
        }
        case 'keychain': {
          // Delete from macOS Keychain
          const { execFile } = await import('node:child_process')
          const { promisify } = await import('node:util')
          const execFileAsync = promisify(execFile)

          try {
            const deleteArgs = [
              'delete-generic-password',
              '-s',
              identity.privateKey.service,
              '-a',
              identity.privateKey.account,
            ]
            if (identity.privateKey.keychain) {
              deleteArgs.push(identity.privateKey.keychain)
            }
            await execFileAsync('security', deleteArgs)
            log(`  Deleted private key from macOS Keychain`)
          } catch (err) {
            // Ignore if key doesn't exist
            if (
              err instanceof Error &&
              !err.message.includes('could not be found') &&
              !err.message.includes('does not exist')
            ) {
              throw err
            }
          }
          break
        }
        case '1password': {
          // Delete from 1Password
          const { execFile } = await import('node:child_process')
          const { promisify } = await import('node:util')
          const execFileAsync = promisify(execFile)

          try {
            const opArgs = [
              'item',
              'delete',
              identity.privateKey.item,
              '--vault',
              identity.privateKey.vault,
            ]

            if (identity.privateKey.account) {
              opArgs.push('--account', identity.privateKey.account)
            }

            await execFileAsync('op', opArgs)
            log(`  Deleted private key from 1Password`)
          } catch (err) {
            // Ignore if item doesn't exist
            if (
              err instanceof Error &&
              !err.message.includes('not found') &&
              !err.message.includes("doesn't exist")
            ) {
              throw err
            }
          }
          break
        }
      }
    }

    // Remove from config
    const { [slug]: _removed, ...remainingIdentities } = config.identities

    // Check if this was the last identity
    if (Object.keys(remainingIdentities).length === 0) {
      error('Cannot remove last identity')
      log('')
      log('At least one identity must exist')
      process.exit(ExitCode.CONFIG_ERROR)
    }

    // Check if this was the active identity
    let newActiveIdentity = config.activeIdentity
    if (slug === config.activeIdentity) {
      // Set first remaining identity as active
      const firstKey = Object.keys(remainingIdentities)[0]
      if (!firstKey) {
        throw new Error('No remaining identities after removal')
      }
      newActiveIdentity = firstKey
      log('')
      log(theme.yellow(`  Removed active identity. New active identity: ${newActiveIdentity}`))
    }

    const newConfig = {
      version: 1 as const,
      activeIdentity: newActiveIdentity,
      identities: remainingIdentities,
    }

    await saveLocalConfig(newConfig)

    log('')
    success(`Identity "${slug}" removed`)
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
