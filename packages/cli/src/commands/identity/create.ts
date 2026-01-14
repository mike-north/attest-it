import { Command } from 'commander'
import { input, select } from '@inquirer/prompts'
import { generateEd25519KeyPair, loadLocalConfig, saveLocalConfig } from '@attest-it/core'
import type { Identity, LocalConfig, PrivateKeyRef } from '@attest-it/core'
import { log, success, error } from '../../utils/output.js'
import { ExitCode } from '../../utils/exit-codes.js'
import { getTheme } from '../../components/theme.js'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { writeFile, mkdir } from 'node:fs/promises'

export const createCommand = new Command('create')
  .description('Create a new identity with Ed25519 keypair')
  .action(async () => {
    await runCreate()
  })

/**
 * Run the create command to interactively create a new identity.
 */
async function runCreate(): Promise<void> {
  try {
    const theme = getTheme()

    log('')
    log(theme.blue.bold()('Create New Identity'))
    log('')

    // Load existing config if it exists
    const existingConfig = await loadLocalConfig()

    // Prompt for identity details
    const slug = await input({
      message: 'Identity slug (unique identifier):',
      validate: (value) => {
        if (!value || value.trim().length === 0) {
          return 'Slug cannot be empty'
        }
        if (!/^[a-z0-9-]+$/.test(value)) {
          return 'Slug must contain only lowercase letters, numbers, and hyphens'
        }
        if (existingConfig?.identities[value]) {
          return `Identity "${value}" already exists`
        }
        return true
      },
    })

    const name = await input({
      message: 'Display name:',
      validate: (value) => {
        if (!value || value.trim().length === 0) {
          return 'Name cannot be empty'
        }
        return true
      },
    })

    const email = await input({
      message: 'Email (optional):',
      default: '',
    })

    const github = await input({
      message: 'GitHub username (optional):',
      default: '',
    })

    // Prompt for key storage type
    const keyStorageType = await select({
      message: 'Where should the private key be stored?',
      choices: [
        { name: 'File system (~/.config/attest-it/keys/)', value: 'file' },
        { name: 'macOS Keychain', value: 'keychain' },
        { name: '1Password', value: '1password' },
      ],
    })

    log('')
    log('Generating Ed25519 keypair...')

    // Generate keypair (this is synchronous, returns KeyPair not Promise)
    const keyPair = generateEd25519KeyPair()

    // Build private key reference based on storage type
    let privateKeyRef: PrivateKeyRef
    let keyStorageDescription: string

    switch (keyStorageType) {
      case 'file': {
        // Save to filesystem
        const keysDir = join(homedir(), '.config', 'attest-it', 'keys')
        await mkdir(keysDir, { recursive: true })
        const keyPath = join(keysDir, `${slug}.pem`)
        await writeFile(keyPath, keyPair.privateKey, { mode: 0o600 })

        privateKeyRef = { type: 'file', path: keyPath }
        keyStorageDescription = keyPath
        break
      }
      case 'keychain': {
        // For macOS Keychain, we need to use the security command
        // Import the key provider to check if available
        const { MacOSKeychainKeyProvider } = await import('@attest-it/core')

        // Check if available (using static method)
        if (!MacOSKeychainKeyProvider.isAvailable()) {
          error('macOS Keychain is not available on this system')
          process.exit(ExitCode.CONFIG_ERROR)
        }

        // Store the private key in keychain using security command
        // Keys are stored as base64-encoded PEM strings
        const { execFile } = await import('node:child_process')
        const { promisify } = await import('node:util')
        const execFileAsync = promisify(execFile)

        // Encode the private key as base64 for storage
        const encodedKey = Buffer.from(keyPair.privateKey).toString('base64')

        try {
          await execFileAsync('security', [
            'add-generic-password',
            '-a',
            'attest-it',
            '-s',
            slug,
            '-w',
            encodedKey,
            '-U',
          ])
        } catch (err) {
          throw new Error(
            `Failed to store key in macOS Keychain: ${err instanceof Error ? err.message : String(err)}`,
          )
        }

        // In the keychain, -s is the service name (slug) and -a is the account ("attest-it")
        privateKeyRef = { type: 'keychain', service: slug, account: 'attest-it' }
        keyStorageDescription = 'macOS Keychain (' + slug + '/attest-it)'
        break
      }
      case '1password': {
        // For 1Password, prompt for additional details
        const vault = await input({
          message: '1Password vault name:',
          validate: (value) => {
            if (!value || value.trim().length === 0) {
              return 'Vault name cannot be empty'
            }
            return true
          },
        })

        const item = await input({
          message: '1Password item name:',
          default: `attest-it-${slug}`,
          validate: (value) => {
            if (!value || value.trim().length === 0) {
              return 'Item name cannot be empty'
            }
            return true
          },
        })

        // Store the private key in 1Password
        // We'll use the op CLI tool
        const { execFile } = await import('node:child_process')
        const { promisify } = await import('node:util')
        const execFileAsync = promisify(execFile)

        try {
          // Create the item with the private key
          await execFileAsync('op', [
            'item',
            'create',
            '--category=SecureNote',
            '--vault',
            vault,
            `--title=${item}`,
            `privateKey[password]=${keyPair.privateKey}`,
          ])
        } catch (err) {
          throw new Error(
            `Failed to store key in 1Password: ${err instanceof Error ? err.message : String(err)}`,
          )
        }

        privateKeyRef = { type: '1password', vault, item, field: 'privateKey' }
        keyStorageDescription = `1Password (${vault}/${item})`
        break
      }
      default:
        throw new Error(`Unknown key storage type: ${keyStorageType}`)
    }

    // Build identity object
    const identity: Identity = {
      name,
      publicKey: keyPair.publicKey,
      privateKey: privateKeyRef,
      ...(email && { email }),
      ...(github && { github }),
    }

    // Create or update config
    let newConfig: LocalConfig
    if (existingConfig) {
      // Add to existing config
      newConfig = {
        ...existingConfig,
        identities: {
          ...existingConfig.identities,
          [slug]: identity,
        },
      }
    } else {
      // Create new config with this identity as active
      newConfig = {
        activeIdentity: slug,
        identities: {
          [slug]: identity,
        },
      }
    }

    // Save config
    await saveLocalConfig(newConfig)

    log('')
    success('Identity created successfully')
    log('')
    log(`  Slug:        ${slug}`)
    log(`  Name:        ${name}`)
    if (email) {
      log(`  Email:       ${email}`)
    }
    if (github) {
      log(`  GitHub:      ${github}`)
    }
    log(`  Public Key:  ${keyPair.publicKey.slice(0, 32)}...`)
    log(`  Private Key: ${keyStorageDescription}`)
    log('')

    if (!existingConfig) {
      success(`Set as active identity`)
      log('')
    } else {
      log(`To use this identity, run: attest-it identity use ${slug}`)
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

export { runCreate }
