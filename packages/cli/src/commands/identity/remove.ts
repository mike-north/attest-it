import { Command } from 'commander'
import { confirm } from '@inquirer/prompts'
import { loadLocalConfig, saveLocalConfig, deletePrivateKey } from '@attest-it/core'
import type { PrivateKeyRef } from '@attest-it/core'
import { log, success, warn, error, getTheme } from '../../utils/output.js'
import { ExitCode } from '../../utils/exit-codes.js'
import { formatKeyLocation } from '../../utils/format-key-location.js'
import { handlePromptableError, resolveConfirmation } from '../../utils/prompts.js'
import { unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import * as path from 'node:path'

export const removeCommand = new Command('remove')
  .description('Delete identity and its private key')
  .argument('<slug>', 'Identity slug to remove')
  .option('-y, --yes', 'Skip the confirmation prompt(s) and remove non-interactively')
  .option(
    '--keep-key',
    'Do not delete the underlying private key material -- only remove the local identity entry (default: also delete the key)',
  )
  .action(async (slug: string, options: RemoveOptions) => {
    await runRemove(slug, options)
  })

interface RemoveOptions {
  yes?: boolean
  keepKey?: boolean
}

/**
 * Run the remove command to delete an identity.
 *
 * @remarks
 * Non-interactive with `--yes`: proceeds without prompting. Without
 * `--yes`, a closed/piped stdin fails fast naming `--yes` instead of
 * hanging on (or looping through) a prompt that can never resolve. See
 * issue #94.
 *
 * By default, removing an identity also deletes its private key material
 * for backends attest-it can safely clean up on its own (`file` --
 * VaultKeeper-managed, and the legacy `filesystem` type). Pass `--keep-key`
 * to leave the key material in place. For backends attest-it does not
 * delete from unilaterally (`1password`, `keychain`, `yubikey`), the key
 * always remains and the command prints an explicit, actionable message
 * saying so -- it is never left behind silently under a success message.
 * See issue #101.
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

    const keyLocation = formatKeyLocation(identity.privateKey)
    log(`  Private key: ${keyLocation}`)
    log('')

    const keepKey = options.keepKey ?? false

    if (keepKey) {
      log(`  Keeping private key (--keep-key): ${keyLocation}`)
    } else {
      await deleteKeyMaterial(identity.privateKey)
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

/**
 * Delete (or explain how to delete) the private key material behind a
 * `PrivateKeyRef`.
 *
 * @remarks
 * For backends attest-it exclusively owns (`file`, `filesystem`), this
 * actually deletes the secret and reports success. For backends attest-it
 * cannot unilaterally clean up (`1password`, `keychain`, `yubikey`), this
 * never attempts deletion -- it always prints an explicit warning that key
 * material remains, along with how the user can remove it themselves. See
 * issue #101.
 */
async function deleteKeyMaterial(privateKey: PrivateKeyRef): Promise<void> {
  switch (privateKey.type) {
    case 'file': {
      await deletePrivateKey('file', privateKey.id)
      log('  Deleted private key from storage')
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
        const rawPath = privateKey.path
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
    case 'keychain':
    case '1password':
    case 'yubikey': {
      warnKeyMaterialRemains(privateKey)
      break
    }
  }
}

/**
 * Print an explicit, actionable warning that key material was left behind
 * for a backend attest-it does not delete from unilaterally (`1password`,
 * `keychain`, `yubikey`). See issue #101.
 */
function warnKeyMaterialRemains(
  privateKey: Exclude<PrivateKeyRef, { type: 'file' | 'filesystem' }>,
): void {
  const location = formatKeyLocation(privateKey)

  warn(`Private key material was NOT deleted. attest-it does not automatically remove keys`)
  log(`    from ${backendDisplayName(privateKey.type)} — that store may be shared with other tools`)
  log(`    or devices you manage outside attest-it.`)
  log(`    Location: ${location}`)
  log(`    Secret ID: ${privateKey.id}`)
  log('')
  log(`    To remove it yourself:`)
  for (const line of manualRemovalInstructions(privateKey)) {
    log(`      - ${line}`)
  }
}

function backendDisplayName(type: 'keychain' | '1password' | 'yubikey'): string {
  switch (type) {
    case 'keychain':
      return 'macOS Keychain'
    case '1password':
      return '1Password'
    case 'yubikey':
      return 'YubiKey'
  }
}

function manualRemovalInstructions(
  privateKey: Exclude<PrivateKeyRef, { type: 'file' | 'filesystem' }>,
): string[] {
  switch (privateKey.type) {
    case 'keychain':
      return [
        'Open Keychain Access.app and locate the entry, or run',
        `  \`security delete-generic-password -a "${privateKey.id}"\` (adjust for your keychain's exact service/account naming).`,
      ]
    case '1password': {
      const vaultFlag = privateKey.vault ? ` --vault "${privateKey.vault}"` : ''
      return [
        'Open the 1Password app and delete the item, or run',
        `  \`op item delete "${privateKey.id}"${vaultFlag}\` (if the id matches the item name/ID).`,
      ]
    }
    case 'yubikey':
      return [
        'This key material lives on the physical YubiKey hardware, not on this machine.',
        'Use `ykman` or the vendor management tooling for your device to manage or reset the associated credential.',
      ]
  }
}
