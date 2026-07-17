import { Command } from 'commander'
import { confirm } from '@inquirer/prompts'
import { loadLocalConfig, saveLocalConfig } from '@attest-it/core'
import { log, success, error, getTheme } from '../../utils/output.js'
import { ExitCode } from '../../utils/exit-codes.js'
import { formatKeyLocation } from '../../utils/format-key-location.js'
import { handlePromptableError, resolveConfirmation } from '../../utils/prompts.js'
import { unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import * as path from 'node:path'

export const removeCommand = new Command('remove')
  .description('Delete identity and optionally delete private key')
  .argument('<slug>', 'Identity slug to remove')
  .option('-y, --yes', 'Skip the confirmation prompt(s) and remove non-interactively')
  .option(
    '--delete-key',
    'Also delete the private key from storage when used with --yes (interactively, this is still asked separately; default: false)',
  )
  .action(async (slug: string, options: RemoveOptions) => {
    await runRemove(slug, options)
  })

interface RemoveOptions {
  yes?: boolean
  deleteKey?: boolean
}

/**
 * Run the remove command to delete an identity.
 *
 * Non-interactive with `--yes`: both confirmations resolve without prompting
 * (identity removal proceeds; private-key deletion defaults to `false`
 * unless `--delete-key` is also given -- the more destructive of the two
 * actions is opt-in, not implied by `--yes` alone). Without `--yes`, a
 * closed/piped stdin fails fast naming `--yes` instead of hanging on (or
 * looping through) a prompt that can never resolve. See issue #94.
 *
 * @public
 */
export async function runRemove(slug: string, options: RemoveOptions = {}): Promise<void> {
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

    // Confirm deletion. Gated behind "flag not supplied AND stdin is an
    // interactive TTY": with --yes this proceeds without prompting; a closed
    // or piped stdin with no flag fails fast instead of ever handing that
    // stdin to the prompt library. See issue #94.
    const confirmDelete = await resolveConfirmation(options.yes, '--yes', () =>
      confirm({
        message: 'Are you sure you want to delete this identity?',
        default: false,
      }),
    )

    if (!confirmDelete) {
      log('Cancelled')
      process.exit(ExitCode.CANCELLED)
    }

    // Ask about deleting private key, showing where it's stored
    const keyLocation = formatKeyLocation(identity.privateKey)
    log(`  Private key: ${keyLocation}`)
    log('')

    // Reaching this point already proved --yes was supplied or stdin is an
    // interactive TTY (resolveConfirmation above would have thrown
    // otherwise), so no separate non-interactive guard is needed here --
    // only which default to use.
    const deletePrivateKey = options.yes
      ? (options.deleteKey ?? false)
      : await confirm({
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
    handlePromptableError(err, ExitCode.CONFIG_ERROR)
  }
}
