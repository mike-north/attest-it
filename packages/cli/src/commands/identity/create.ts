import { Command } from 'commander'
import { input, select } from '@inquirer/prompts'
import {
  generateEd25519KeyPair,
  loadLocalConfig,
  saveLocalConfig,
  getAttestItConfigDir,
  OnePasswordKeyProvider,
  MacOSKeychainKeyProvider,
} from '@attest-it/core'
import type { Identity, LocalConfig, PrivateKeyRef } from '@attest-it/core'
import { log, success, error, info, getTheme } from '../../utils/output.js'
import { ExitCode } from '../../utils/exit-codes.js'
import { validateSlug, validateEmail } from './validation.js'
import { offerCompletionInstall } from '../../utils/completion-offer.js'
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
    const slug = (
      await input({
        message: 'Identity slug (unique identifier):',
        validate: (value) => validateSlug(value, existingConfig?.identities),
      })
    ).trim()

    const name = await input({
      message: 'Display name:',
      validate: (value) => {
        if (!value || value.trim().length === 0) {
          return 'Name cannot be empty'
        }
        return true
      },
    })

    const email = (
      await input({
        message: 'Email (optional):',
        default: '',
        validate: validateEmail,
      })
    ).trim()

    const github = await input({
      message: 'GitHub username (optional):',
      default: '',
    })

    // Check provider availability
    info('Checking available key storage providers...')
    const opAvailable = await OnePasswordKeyProvider.isInstalled()
    const keychainAvailable = MacOSKeychainKeyProvider.isAvailable()

    // Build choices based on availability
    const configDir = getAttestItConfigDir()
    const storageChoices: { name: string; value: string }[] = [
      { name: `File system (${join(configDir, 'keys')})`, value: 'file' },
    ]

    if (keychainAvailable) {
      storageChoices.push({ name: 'macOS Keychain', value: 'keychain' })
    }

    if (opAvailable) {
      storageChoices.push({ name: '1Password', value: '1password' })
    }

    // Passphrase-protected is always available (only requires Node.js crypto)
    storageChoices.push({ name: 'Passphrase-protected (enter password each time)', value: 'passphrase' })

    // Prompt for key storage type
    const keyStorageType = await select({
      message: 'Where should the private key be stored?',
      choices: storageChoices,
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
        // Save to filesystem (respects --home-dir override)
        const keysDir = join(getAttestItConfigDir(), 'keys')
        await mkdir(keysDir, { recursive: true })
        const keyPath = join(keysDir, `${slug}.pem`)
        await writeFile(keyPath, keyPair.privateKey, { mode: 0o600 })

        privateKeyRef = { type: 'file', path: keyPath }
        keyStorageDescription = keyPath
        break
      }
      case 'keychain': {
        // Check if available (using static method)
        if (!MacOSKeychainKeyProvider.isAvailable()) {
          error('macOS Keychain is not available on this system')
          process.exit(ExitCode.CONFIG_ERROR)
        }

        // List available keychains
        const keychains = await MacOSKeychainKeyProvider.listKeychains()

        if (keychains.length === 0) {
          throw new Error('No keychains found on this system')
        }

        // Format keychain display with bold name and dim path
        const formatKeychainChoice = (kc: { name: string; path: string }): string => {
          return `${theme.blue.bold()(kc.name)} ${theme.muted(`(${kc.path})`)}`
        }

        // Select keychain (auto-select if only one, typically "login")
        let selectedKeychain: { name: string; path: string }
        if (keychains.length === 1 && keychains[0]) {
          selectedKeychain = keychains[0]
          info(`Using keychain: ${formatKeychainChoice(selectedKeychain)}`)
        } else {
          const selectedPath = await select({
            message: 'Select keychain:',
            choices: keychains.map((kc) => ({
              name: formatKeychainChoice(kc),
              value: kc.path,
            })),
          })
          const foundKeychain = keychains.find((kc) => kc.path === selectedPath)
          if (!foundKeychain) {
            throw new Error('Selected keychain not found')
          }
          selectedKeychain = foundKeychain
        }

        // Prompt for item name
        const keychainItemName = await input({
          message: 'Keychain item name:',
          default: `attest-it-${slug}`,
          validate: (value) => {
            if (!value || value.trim().length === 0) {
              return 'Item name cannot be empty'
            }
            return true
          },
        })

        // Store the private key in keychain using security command
        // Keys are stored as base64-encoded PEM strings
        const { execFile } = await import('node:child_process')
        const { promisify } = await import('node:util')
        const execFileAsync = promisify(execFile)

        // Encode the private key as base64 for storage
        const encodedKey = Buffer.from(keyPair.privateKey).toString('base64')

        try {
          const addArgs = [
            'add-generic-password',
            '-a',
            'attest-it',
            '-s',
            keychainItemName,
            '-w',
            encodedKey,
            '-U',
            selectedKeychain.path,
          ]
          await execFileAsync('security', addArgs)
        } catch (err) {
          throw new Error(
            `Failed to store key in macOS Keychain: ${err instanceof Error ? err.message : String(err)}`,
          )
        }

        // In the keychain, -s is the service name (item) and -a is the account ("attest-it")
        privateKeyRef = {
          type: 'keychain',
          service: keychainItemName,
          account: 'attest-it',
          keychain: selectedKeychain.path,
        }
        keyStorageDescription = `macOS Keychain: ${selectedKeychain.name}/${keychainItemName}`
        break
      }
      case '1password': {
        // List available 1Password accounts
        const accounts = await OnePasswordKeyProvider.listAccounts()

        if (accounts.length === 0) {
          throw new Error(
            '1Password CLI is installed but no accounts are signed in. Run "op signin" first.',
          )
        }

        // Fetch detailed account info (including friendly name) for each account
        const { execFile } = await import('node:child_process')
        const { promisify } = await import('node:util')
        const execFileAsync = promisify(execFile)

        interface AccountDetails {
          url: string
          email: string
          name: string // Friendly name from `op account get`
        }

        const accountDetails: AccountDetails[] = await Promise.all(
          accounts.map(async (acc) => {
            try {
              // Use user_uuid for unique lookup (URL can be shared by multiple accounts)
              const { stdout } = await execFileAsync('op', [
                'account',
                'get',
                '--account',
                acc.user_uuid,
                '--format=json',
              ])
              const details: unknown = JSON.parse(stdout)
              // Extract name if it exists and is a string
              const name =
                details !== null &&
                typeof details === 'object' &&
                'name' in details &&
                typeof details.name === 'string'
                  ? details.name
                  : acc.url
              return {
                url: acc.url,
                email: acc.email,
                name,
              }
            } catch {
              // Fallback to URL if we can't get account details
              return {
                url: acc.url,
                email: acc.email,
                name: acc.url,
              }
            }
          }),
        )

        // Format account display with bold name and dim domain (matching `op signin` style)
        const formatAccountChoice = (acc: AccountDetails): string => {
          return `${theme.blue.bold()(acc.name)} ${theme.muted(`(${acc.url})`)}`
        }

        // Select account (auto-select if only one)
        // Use URL as the account identifier (required by `op` CLI)
        let selectedAccount: string | undefined
        if (accountDetails.length === 1 && accountDetails[0]) {
          selectedAccount = accountDetails[0].url
          info(`Using 1Password account: ${formatAccountChoice(accountDetails[0])}`)
        } else {
          selectedAccount = await select({
            message: 'Select 1Password account:',
            choices: accountDetails.map((acc) => ({
              name: formatAccountChoice(acc),
              value: acc.url,
            })),
          })
        }

        // List vaults for selected account
        const vaults = await OnePasswordKeyProvider.listVaults(selectedAccount)

        if (vaults.length === 0) {
          throw new Error(`No vaults found in 1Password account: ${selectedAccount}`)
        }

        // Select vault
        const selectedVault = await select({
          message: 'Select vault for private key storage:',
          choices: vaults.map((v) => ({
            name: v.name,
            value: v.name,
          })),
        })

        // Prompt for item name
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

        // Write the private key to a temp file, then upload to 1Password
        const { tmpdir } = await import('node:os')
        const tempDir = join(tmpdir(), `attest-it-${String(Date.now())}`)
        await mkdir(tempDir, { recursive: true })
        const tempPrivatePath = join(tempDir, 'private.pem')

        try {
          // Write private key to temp file for upload
          await writeFile(tempPrivatePath, keyPair.privateKey, { mode: 0o600 })

          // Upload to 1Password using op document create
          const { execFile } = await import('node:child_process')
          const { promisify } = await import('node:util')
          const execFileAsync = promisify(execFile)

          const opArgs = [
            'document',
            'create',
            tempPrivatePath,
            '--title',
            item,
            '--vault',
            selectedVault,
          ]
          if (selectedAccount) {
            opArgs.push('--account', selectedAccount)
          }

          await execFileAsync('op', opArgs)
        } finally {
          // Clean up temp files
          const { rm } = await import('node:fs/promises')
          await rm(tempDir, { recursive: true, force: true }).catch(() => {
            // Ignore cleanup errors
          })
        }

        privateKeyRef = {
          type: '1password',
          vault: selectedVault,
          item,
          ...(selectedAccount && { account: selectedAccount }),
        }
        keyStorageDescription = `1Password (${selectedVault}/${item})`
        break
      }
      case 'passphrase': {
        // Import password prompt module
        const { password } = await import('@inquirer/prompts')

        // Prompt for passphrase
        const passphrase = await password({
          message: 'Enter passphrase for new signing key:',
          mask: '*',
          validate: (value) => {
            if (!value || value.length < 8) {
              return 'Passphrase must be at least 8 characters long'
            }
            return true
          },
        })

        // Confirm passphrase
        const confirmPassphrase = await password({
          message: 'Confirm passphrase:',
          mask: '*',
        })

        if (passphrase !== confirmPassphrase) {
          throw new Error('Passphrases do not match')
        }

        // Prompt for encrypted key file name
        const encryptedKeyName = await input({
          message: 'Encrypted key file name:',
          default: `${slug}.enc`,
          validate: (value) => {
            if (!value || value.trim().length === 0) {
              return 'File name cannot be empty'
            }
            return true
          },
        })

        // Determine encrypted key path
        const keysDir = join(getAttestItConfigDir(), 'keys')
        await mkdir(keysDir, { recursive: true })
        const encryptedKeyPath = join(keysDir, encryptedKeyName)

        // Encrypt the private key using scrypt + AES-256-GCM
        const crypto = await import('node:crypto')

        // Generate random salt and IV
        const salt = crypto.randomBytes(32)
        const iv = crypto.randomBytes(12) // 96 bits for GCM

        // PBKDF2 iterations
        const iterations = 100000

        // Derive key from passphrase using PBKDF2
        const derivedKey = await new Promise<Buffer>((resolve, reject) => {
          crypto.pbkdf2(passphrase, salt, iterations, 32, 'sha256', (err, key) => {
            if (err) reject(err)
            else resolve(key)
          })
        })

        // Encrypt the private key with AES-256-GCM
        const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey, iv)
        const ciphertext = Buffer.concat([
          cipher.update(Buffer.from(keyPair.privateKey, 'utf8')),
          cipher.final(),
        ])
        const authTag = cipher.getAuthTag()

        // Create the encrypted key file
        const keyFile = {
          version: 1,
          iv: iv.toString('base64'),
          authTag: authTag.toString('base64'),
          salt: salt.toString('base64'),
          ciphertext: ciphertext.toString('base64'),
          iterations,
        }

        // Write the encrypted key file
        await writeFile(encryptedKeyPath, JSON.stringify(keyFile, null, 2), { mode: 0o600 })

        privateKeyRef = {
          type: 'passphrase',
          encryptedKeyPath,
        }
        keyStorageDescription = `Passphrase-protected: ${encryptedKeyPath}`
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

    // Offer to install shell completions
    await offerCompletionInstall()
  } catch (err) {
    if (err instanceof Error) {
      error(err.message)
    } else {
      error('Unknown error occurred')
    }
    process.exit(ExitCode.CONFIG_ERROR)
  }
}
