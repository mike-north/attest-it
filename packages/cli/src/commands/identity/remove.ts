import { Command } from 'commander'
import { confirm } from '@inquirer/prompts'
import { loadLocalConfig, saveLocalConfig } from '@attest-it/core'
import { log, success, error, getTheme } from '../../utils/output.js'
import { ExitCode } from '../../utils/exit-codes.js'
import { formatKeyLocation } from '../../utils/format-key-location.js'
import { unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import * as path from 'node:path'

export const removeCommand = new Command('remove')
  .description('Delete identity and optionally delete private key')
  .argument('<slug>', 'Identity slug to remove')
  .action(async (slug: string) => {
    await runRemove(slug)
  })

/**
 * Run the remove command to delete an identity.
 * @public
 */
export async function runRemove(slug: string): Promise<void> {
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
        case 'file':
        case 'keychain':
        case '1password':
        case 'yubikey': {
          // VaultKeeper-managed keys: deletion is handled by VaultKeeper's backend.
          // For now, log a note — full backend deletion will be wired when the
          // VaultKeeper vault instance is available here.
          log(
            `  Note: To delete the key from VaultKeeper storage, use the VaultKeeper CLI with ID: ${identity.privateKey.id}`,
          )
          break
        }
        case 'filesystem': {
          // Legacy filesystem key — delete the file directly. The stored path
          // may contain a leading `~` (from a hand-edited v1 config); Node's
          // fs APIs don't expand it, so resolve it explicitly before deleting.
          // Mirrors `resolveLegacyPath` in
          // `@attest-it/core`'s `key-provider/legacy-filesystem-provider.ts` —
          // not shared via export because that module's internals are
          // intentionally not part of the package's public API.
          try {
            const rawPath = identity.privateKey.path
            const resolvedPath =
              rawPath === '~' || rawPath.startsWith('~/')
                ? path.join(homedir(), rawPath.slice(1))
                : rawPath
            await unlink(resolvedPath)
            log(`  Deleted legacy private key file: ${rawPath}`)
          } catch (err) {
            // Ignore file not found errors
            if (err && typeof err === 'object' && 'code' in err && err.code !== 'ENOENT') {
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
      version: 2 as const,
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
