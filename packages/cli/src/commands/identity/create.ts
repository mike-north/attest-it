import { Command } from 'commander'
import { input, select } from '@inquirer/prompts'
import {
  generateEd25519KeyPair,
  loadLocalConfig,
  saveLocalConfig,
  getAttestItConfigDir,
  OnePasswordKeyProvider,
  MacOSKeychainKeyProvider,
  YubiKeyProvider,
  savePublicKey,
} from '@attest-it/core'
import type { Identity, LocalConfig, PrivateKeyRef } from '@attest-it/core'
import { log, success, error, info, verbose, getTheme } from '../../utils/output.js'
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
    // Note: Checking 1Password/YubiKey may trigger authentication prompts
    info('Checking available key storage providers...')
    info(
      'You may see authentication prompts from 1Password, macOS Keychain, or other security tools.',
    )

    const opAvailable = await OnePasswordKeyProvider.isInstalled()
    verbose(`  1Password CLI (op): ${opAvailable ? 'found' : 'not found'}`)

    const keychainAvailable = MacOSKeychainKeyProvider.isAvailable()
    verbose(`  macOS Keychain: ${keychainAvailable ? 'available' : 'not available (not macOS)'}`)

    const yubikeyInstalled = await YubiKeyProvider.isInstalled()
    verbose(`  YubiKey CLI (ykman): ${yubikeyInstalled ? 'found' : 'not found'}`)

    const yubikeyConnected = yubikeyInstalled ? await YubiKeyProvider.isConnected() : false
    if (yubikeyInstalled) {
      verbose(`  YubiKey device: ${yubikeyConnected ? 'connected' : 'not connected'}`)
    }

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

    if (yubikeyInstalled) {
      const yubikeyLabel = yubikeyConnected
        ? 'YubiKey (encrypted with challenge-response)'
        : 'YubiKey (not connected - insert YubiKey first)'
      storageChoices.push({ name: yubikeyLabel, value: 'yubikey' })
    } else {
      // Show YubiKey as disabled option so users know it exists
      storageChoices.push({
        name: theme.muted('YubiKey (install ykman CLI to enable)'),
        value: 'yubikey-disabled',
        // @ts-expect-error -- @inquirer/prompts supports disabled property but types may not reflect it
        disabled: true,
      })
    }

    // Prompt for key storage type
    const keyStorageType = await select({
      message: 'Where should the private key be stored?',
      choices: storageChoices,
    })

    // ============================================================
    // PHASE 1: Collect all provider-specific configuration
    // (before generating key to avoid holding key material during prompts)
    // ============================================================

    // Storage configuration types
    type FileStorageConfig = { type: 'file'; keyPath: string }
    type KeychainStorageConfig = {
      type: 'keychain'
      selectedKeychain: { name: string; path: string }
      keychainItemName: string
    }
    type OnePasswordStorageConfig = {
      type: '1password'
      selectedAccount: string
      accountDisplayName: string
      selectedVault: string
      item: string
    }
    type YubiKeyStorageConfig = {
      type: 'yubikey'
      selectedSerial: string
      slot: 1 | 2
      encryptedKeyPath: string
    }
    type StorageConfig =
      | FileStorageConfig
      | KeychainStorageConfig
      | OnePasswordStorageConfig
      | YubiKeyStorageConfig

    let storageConfig: StorageConfig

    switch (keyStorageType) {
      case 'file': {
        // Determine file path (respects --home-dir override)
        const keysDir = join(getAttestItConfigDir(), 'keys')
        const keyPath = join(keysDir, `${slug}.pem`)
        storageConfig = { type: 'file', keyPath }
        break
      }
      case 'keychain': {
        // Check if available (using static method)
        if (!MacOSKeychainKeyProvider.isAvailable()) {
          error('macOS Keychain is not available on this system')
          process.exit(ExitCode.CONFIG_ERROR)
        }

        // Notify user about keychain access
        log('')
        info('Accessing macOS Keychain to list available keychains...')
        info('You may be prompted to allow access or enter your password.')

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

        storageConfig = { type: 'keychain', selectedKeychain, keychainItemName }
        break
      }
      case '1password': {
        // Notify user about 1Password access
        log('')
        info('Accessing 1Password to list your accounts and vaults...')
        info(
          'You may see biometric prompts or be asked to unlock 1Password for each configured account.',
        )

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
                  : '[Could not read account name]'
              return {
                url: acc.url,
                email: acc.email,
                name,
              }
            } catch {
              // Fallback if we can't get account details (e.g., vault locked)
              return {
                url: acc.url,
                email: acc.email,
                name: '[Could not read account name]',
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
        let selectedAccount: string
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

        // Get account display name for description
        const selectedAccountDetails = accountDetails.find((acc) => acc.url === selectedAccount)
        const accountDisplayName = selectedAccountDetails?.name ?? selectedAccount

        storageConfig = {
          type: '1password',
          selectedAccount,
          accountDisplayName,
          selectedVault,
          item,
        }
        break
      }
      case 'yubikey': {
        // Notify user about YubiKey access
        log('')
        info('Accessing YubiKey to detect connected devices...')
        info('Your private key will be encrypted using HMAC challenge-response from the YubiKey.')

        // Check if YubiKey is connected
        if (!(await YubiKeyProvider.isConnected())) {
          error('No YubiKey detected. Please insert your YubiKey and try again.')
          process.exit(ExitCode.CONFIG_ERROR)
        }

        // List connected YubiKeys
        const yubikeys = await YubiKeyProvider.listDevices()

        if (yubikeys.length === 0) {
          throw new Error('No YubiKeys detected. Please insert a YubiKey and try again.')
        }

        // Format YubiKey display
        const formatYubiKeyChoice = (yk: {
          serial: string
          type: string
          firmware: string
        }): string => {
          return `${theme.blue.bold()(yk.type)} ${theme.muted(`(Serial: ${yk.serial}, FW: ${yk.firmware})`)}`
        }

        // Select YubiKey (auto-select if only one)
        let selectedSerial: string
        if (yubikeys.length === 1 && yubikeys[0]) {
          selectedSerial = yubikeys[0].serial
          info(`Using YubiKey: ${formatYubiKeyChoice(yubikeys[0])}`)
        } else {
          selectedSerial = await select({
            message: 'Select YubiKey:',
            choices: yubikeys.map((yk) => ({
              name: formatYubiKeyChoice(yk),
              value: yk.serial,
            })),
          })
        }

        // Check if challenge-response is configured on slot 2
        const slot: 1 | 2 = 2 // Default to slot 2 for challenge-response
        const isChallengeResponseConfigured = await YubiKeyProvider.isChallengeResponseConfigured(
          slot,
          selectedSerial,
        )

        if (!isChallengeResponseConfigured) {
          log('')
          error(`YubiKey slot ${String(slot)} is not configured for HMAC challenge-response.`)
          log('')
          log('To configure it, run:')
          log(theme.blue(`  ykman otp chalresp --generate ${String(slot)}`))
          log('')
          log('This will configure slot 2 with a randomly generated secret.')
          log(theme.muted('Note: Make sure to back up the secret if needed for recovery.'))
          process.exit(ExitCode.CONFIG_ERROR)
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
        const encryptedKeyPath = join(keysDir, encryptedKeyName)

        storageConfig = { type: 'yubikey', selectedSerial, slot, encryptedKeyPath }
        break
      }
      default:
        throw new Error(`Unknown key storage type: ${keyStorageType}`)
    }

    // ============================================================
    // PHASE 2: Generate key pair (now that we have all user input)
    // ============================================================
    log('')
    log('Generating Ed25519 keypair...')

    // Generate keypair (this is synchronous, returns KeyPair not Promise)
    const keyPair = generateEd25519KeyPair()

    // ============================================================
    // PHASE 3: Store the key using collected configuration
    // ============================================================

    // Build private key reference based on storage type
    let privateKeyRef: PrivateKeyRef
    let keyStorageDescription: string

    switch (storageConfig.type) {
      case 'file': {
        // Notify user about file creation
        log('')
        info('Creating private key file on disk...')

        // Save to filesystem (respects --home-dir override)
        const keysDir = join(getAttestItConfigDir(), 'keys')
        await mkdir(keysDir, { recursive: true })
        await writeFile(storageConfig.keyPath, keyPair.privateKey, { mode: 0o600 })

        privateKeyRef = { type: 'file', path: storageConfig.keyPath }
        keyStorageDescription = storageConfig.keyPath
        break
      }
      case 'keychain': {
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
            storageConfig.keychainItemName,
            '-w',
            encodedKey,
            '-U',
            storageConfig.selectedKeychain.path,
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
          service: storageConfig.keychainItemName,
          account: 'attest-it',
          keychain: storageConfig.selectedKeychain.path,
        }
        keyStorageDescription = `macOS Keychain: ${storageConfig.selectedKeychain.name}/${storageConfig.keychainItemName}`
        break
      }
      case '1password': {
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
            storageConfig.item,
            '--vault',
            storageConfig.selectedVault,
            '--account',
            storageConfig.selectedAccount,
          ]

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
          vault: storageConfig.selectedVault,
          item: storageConfig.item,
          account: storageConfig.selectedAccount,
        }

        keyStorageDescription = `1Password (${storageConfig.accountDisplayName}/${storageConfig.selectedVault}/${storageConfig.item})`
        break
      }
      case 'yubikey': {
        // Create keys directory if needed
        const keysDir = join(getAttestItConfigDir(), 'keys')
        await mkdir(keysDir, { recursive: true })

        // Encrypt the private key with YubiKey challenge-response
        const result = await YubiKeyProvider.encryptPrivateKey({
          privateKey: keyPair.privateKey,
          encryptedKeyPath: storageConfig.encryptedKeyPath,
          slot: storageConfig.slot,
          serial: storageConfig.selectedSerial,
        })

        privateKeyRef = {
          type: 'yubikey',
          encryptedKeyPath: result.encryptedKeyPath,
          slot: storageConfig.slot,
          serial: storageConfig.selectedSerial,
        }
        keyStorageDescription = result.storageDescription
        break
      }
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

    // Save public key to home and project directories
    const publicKeyResult = await savePublicKey(slug, keyPair.publicKey)

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
    log(theme.blue.bold()('Public key saved to:'))
    log(`  ${publicKeyResult.homePath}`)
    log('')
    log('To add yourself to a project, run:')
    log(theme.blue('  attest-it team join'))
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
