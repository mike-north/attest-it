import { Command } from 'commander'
import { input, confirm } from '@inquirer/prompts'
import { loadLocalConfig, saveLocalConfig, generateEd25519KeyPair } from '@attest-it/core'
import { log, success, error } from '../../utils/output.js'
import { ExitCode } from '../../utils/exit-codes.js'
import { getTheme } from '../../components/theme.js'
import { writeFile } from 'node:fs/promises'

export const editCommand = new Command('edit')
  .description('Edit identity or rotate keypair')
  .argument('<slug>', 'Identity slug to edit')
  .action(async (slug: string) => {
    await runEdit(slug)
  })

/**
 * Run the edit command to modify an identity.
 */
async function runEdit(slug: string): Promise<void> {
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
    log(theme.blue.bold()(`Edit Identity: ${slug}`))
    log('')

    // Prompt for new values (show current values as defaults)
    const name = await input({
      message: 'Display name:',
      default: identity.name,
      validate: (value) => {
        if (!value || value.trim().length === 0) {
          return 'Name cannot be empty'
        }
        return true
      },
    })

    const email = await input({
      message: 'Email (optional):',
      default: identity.email ?? '',
    })

    const github = await input({
      message: 'GitHub username (optional):',
      default: identity.github ?? '',
    })

    // Ask about keypair rotation
    const rotateKey = await confirm({
      message: 'Rotate keypair (generate new keys)?',
      default: false,
    })

    let publicKey = identity.publicKey
    const privateKeyRef = identity.privateKey

    if (rotateKey) {
      log('')
      log('Generating new Ed25519 keypair...')

      // Generate new keypair
      const keyPair = generateEd25519KeyPair()
      publicKey = keyPair.publicKey

      // Update private key storage based on existing type
      switch (identity.privateKey.type) {
        case 'file': {
          // Update file
          await writeFile(identity.privateKey.path, keyPair.privateKey, { mode: 0o600 })
          log(`  Updated private key at: ${identity.privateKey.path}`)
          break
        }
        case 'keychain': {
          // Update macOS Keychain entry
          const { execFile } = await import('node:child_process')
          const { promisify } = await import('node:util')
          const execFileAsync = promisify(execFile)

          // Encode the private key as base64 for storage
          const encodedKey = Buffer.from(keyPair.privateKey).toString('base64')

          try {
            // Delete old entry
            await execFileAsync('security', [
              'delete-generic-password',
              '-s',
              identity.privateKey.service,
              '-a',
              identity.privateKey.account,
            ])

            // Add new entry
            await execFileAsync('security', [
              'add-generic-password',
              '-s',
              identity.privateKey.service,
              '-a',
              identity.privateKey.account,
              '-w',
              encodedKey,
              '-U',
            ])
            log(`  Updated private key in macOS Keychain`)
          } catch (err) {
            throw new Error(
              `Failed to update key in macOS Keychain: ${err instanceof Error ? err.message : String(err)}`,
            )
          }
          break
        }
        case '1password': {
          // Update 1Password item
          const { execFile } = await import('node:child_process')
          const { promisify } = await import('node:util')
          const execFileAsync = promisify(execFile)

          try {
            // Update the item field
            const opArgs = [
              'item',
              'edit',
              identity.privateKey.item,
              '--vault',
              identity.privateKey.vault,
              `privateKey[password]=${keyPair.privateKey}`,
            ]

            if (identity.privateKey.account) {
              opArgs.push('--account', identity.privateKey.account)
            }

            await execFileAsync('op', opArgs)
            log(`  Updated private key in 1Password`)
          } catch (err) {
            throw new Error(
              `Failed to update key in 1Password: ${err instanceof Error ? err.message : String(err)}`,
            )
          }
          break
        }
      }
    }

    // Update identity
    const updatedIdentity = {
      name,
      publicKey,
      privateKey: privateKeyRef,
      ...(email && { email }),
      ...(github && { github }),
    }

    const newConfig = {
      ...config,
      identities: {
        ...config.identities,
        [slug]: updatedIdentity,
      },
    }

    await saveLocalConfig(newConfig)

    log('')
    success('Identity updated successfully')
    log('')
    if (rotateKey) {
      log('  New Public Key: ' + publicKey.slice(0, 32) + '...')
      log('')
      log(
        theme.yellow(
          '  Warning: If this identity is used in team configurations,\n  you must update those configurations with the new public key.',
        ),
      )
      log('')
    }
  } catch (err) {
    if (err instanceof Error) {
      error(err.message)
    } else {
      error('Unknown error occurred')
    }
    process.exit(ExitCode.CONFIG_ERROR)
  }
}

export { runEdit }
