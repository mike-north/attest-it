import { Command } from 'commander'
import { input, select } from '@inquirer/prompts'
import {
  generateEd25519KeyPair,
  loadLocalConfig,
  saveLocalConfig,
  getIdentityConfigDir,
  isOnePasswordInstalled,
  listOnePasswordAccounts,
  listOnePasswordVaults,
  isMacOSKeychainAvailable,
  listMacOSKeychains,
  isYubiKeyInstalled,
  isYubiKeyConnected,
  listYubiKeyDevices,
  isYubiKeyChallengeResponseConfigured,
  KeyProviderRegistry,
  savePublicKey,
  storePrivateKey,
} from '@attest-it/core'
import type { Identity, LocalConfig, PrivateKeyRef } from '@attest-it/core'
import { log, success, error, info, verbose, getTheme } from '../../utils/output.js'
import { ExitCode } from '../../utils/exit-codes.js'
import { validateSlug, validateEmail } from './validation.js'
import { offerCompletionInstall } from '../../utils/completion-offer.js'
import {
  resolveOrPrompt,
  resolveOptionalOrPrompt,
  isInteractiveTTY,
  readStdin,
} from '../../utils/prompts.js'
import { join } from 'node:path'

/**
 * Storage backend values accepted by `--storage`.
 *
 * These are the CLI-facing names (matching the existing interactive picker's
 * choice values); {@link STORAGE_TYPE_TO_REGISTRY} maps each to the
 * `KeyProviderRegistry` type it corresponds to, so a `--storage` value is
 * always validated against whatever is *currently* registered rather than a
 * list that can silently drift from it.
 */
const STORAGE_TYPES = ['file', 'keychain', '1password', 'yubikey'] as const
type StorageType = (typeof STORAGE_TYPES)[number]

const STORAGE_TYPE_TO_REGISTRY: Record<StorageType, string> = {
  file: 'filesystem',
  keychain: 'macos-keychain',
  '1password': '1password',
  yubikey: 'yubikey',
}

function isStorageType(value: string): value is StorageType {
  return STORAGE_TYPES.some((storageType) => storageType === value)
}

/**
 * Turn a display name into a lowercase, hyphenated slug candidate.
 * @internal
 */
function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return base.length > 0 ? base : 'identity'
}

/**
 * Derive a slug from a display name, disambiguating against existing
 * identities with a numeric suffix if needed.
 * @internal
 */
function deriveUniqueSlug(name: string, existingIdentities?: Record<string, unknown>): string {
  const base = slugify(name)
  if (!existingIdentities?.[base]) {
    return base
  }
  let suffix = 2
  while (existingIdentities[`${base}-${String(suffix)}`]) {
    suffix += 1
  }
  return `${base}-${String(suffix)}`
}

interface CreateOptions {
  name?: string
  slug?: string
  email?: string
  github?: string
  storage?: string
  passphraseStdin?: boolean
  keychainPath?: string
  keychainItem?: string
  opAccount?: string
  opVault?: string
  opItem?: string
  yubikeySerial?: string
  encryptedKeyName?: string
}

export const createCommand = new Command('create')
  .description('Create a new identity with Ed25519 keypair')
  .option('--name <name>', 'Display name for the identity')
  .option('--slug <slug>', 'Unique identity slug (derived from --name when omitted)')
  .option('--email <email>', 'Email address (optional)')
  .option('--github <username>', 'GitHub username (optional)')
  .option('--storage <backend>', `Key storage backend: ${STORAGE_TYPES.join('|')}`)
  .option(
    '--passphrase-stdin',
    'Read a passphrase from stdin to encrypt a file-backed private key (only used with --storage file)',
  )
  .option(
    '--keychain-path <path>',
    'macOS Keychain path (needed only when multiple keychains exist)',
  )
  .option('--keychain-item <name>', 'macOS Keychain item name (default: attest-it-<slug>)')
  .option(
    '--op-account <uuid>',
    '1Password account UUID (needed only when multiple accounts are signed in)',
  )
  .option('--op-vault <name>', '1Password vault name (needed only when multiple vaults exist)')
  .option('--op-item <name>', '1Password item name (default: attest-it-<slug>)')
  .option(
    '--yubikey-serial <serial>',
    'YubiKey serial number (needed only when multiple devices are connected)',
  )
  .option(
    '--encrypted-key-name <name>',
    'Encrypted key file name for YubiKey storage (default: <slug>.enc)',
  )
  .action(async (options: CreateOptions) => {
    await runCreate(options)
  })

/**
 * Run the create command to create a new identity.
 *
 * Interactive by default when stdin is a TTY and flags are omitted. Every
 * prompt is gated behind "flag not supplied AND stdin is an interactive TTY";
 * when stdin is not a TTY and a required value is missing, this fails fast
 * with an error naming the missing flag rather than hanging on a prompt that
 * can never resolve. See issue #80.
 */
async function runCreate(options: CreateOptions): Promise<void> {
  try {
    const theme = getTheme()

    log('')
    log(theme.blue.bold()('Create New Identity'))
    log('')

    // Load existing config if it exists
    const existingConfig = await loadLocalConfig()

    // Display name (required)
    const name = await resolveOrPrompt(options.name, '--name', () =>
      input({
        message: 'Display name:',
        validate: (value) => {
          if (!value || value.trim().length === 0) {
            return 'Name cannot be empty'
          }
          return true
        },
      }),
    )
    if (name.trim().length === 0) {
      throw new Error('--name cannot be empty')
    }

    // Slug (optional -- auto-derived from the name when omitted)
    let slug: string
    if (options.slug !== undefined) {
      slug = options.slug.trim()
      const validation = validateSlug(slug, existingConfig?.identities)
      if (validation !== true) {
        throw new Error(validation)
      }
    } else {
      const derived = deriveUniqueSlug(name, existingConfig?.identities)
      slug = isInteractiveTTY()
        ? (
            await input({
              message: 'Identity slug (unique identifier):',
              default: derived,
              validate: (value) => validateSlug(value, existingConfig?.identities),
            })
          ).trim()
        : derived
    }

    // Email (optional)
    let email: string
    if (options.email !== undefined) {
      email = options.email.trim()
      const emailValidation = validateEmail(email)
      if (emailValidation !== true) {
        throw new Error(emailValidation)
      }
    } else {
      email = isInteractiveTTY()
        ? (
            await input({
              message: 'Email (optional):',
              default: '',
              validate: validateEmail,
            })
          ).trim()
        : ''
    }

    // GitHub username (optional)
    const github =
      options.github !== undefined
        ? options.github.trim()
        : isInteractiveTTY()
          ? (await input({ message: 'GitHub username (optional):', default: '' })).trim()
          : ''

    // Check provider availability
    // Note: Checking 1Password/YubiKey may trigger authentication prompts
    info('Checking available key storage providers...')
    info(
      'You may see authentication prompts from 1Password, macOS Keychain, or other security tools.',
    )

    const opAvailable = await isOnePasswordInstalled()
    verbose(`  1Password CLI (op): ${opAvailable ? 'found' : 'not found'}`)

    const keychainAvailable = isMacOSKeychainAvailable()
    verbose(`  macOS Keychain: ${keychainAvailable ? 'available' : 'not available (not macOS)'}`)

    const yubikeyInstalled = await isYubiKeyInstalled()
    verbose(`  YubiKey CLI (ykman): ${yubikeyInstalled ? 'found' : 'not found'}`)

    const yubikeyConnected = yubikeyInstalled ? await isYubiKeyConnected() : false
    if (yubikeyInstalled) {
      verbose(`  YubiKey device: ${yubikeyConnected ? 'connected' : 'not connected'}`)
    }

    // Build choices based on availability
    const configDir = getIdentityConfigDir()
    const storageChoices: { name: string; value: StorageType }[] = [
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
      // Show YubiKey as disabled option so users know it exists. The value
      // is never read (the entry is disabled and cannot be selected), so it
      // reuses the real 'yubikey' literal rather than inventing a sentinel
      // that would need a type assertion to fit StorageType.
      storageChoices.push({
        name: theme.muted('YubiKey (install ykman CLI to enable)'),
        value: 'yubikey',
        // @ts-expect-error -- @inquirer/prompts supports disabled property but types may not reflect it
        disabled: true,
      })
    }

    // Storage backend selector (required)
    let flagStorage: StorageType | undefined
    if (options.storage !== undefined) {
      if (!isStorageType(options.storage)) {
        throw new Error(
          `Unknown --storage value "${options.storage}". Supported values: ${STORAGE_TYPES.join(', ')}`,
        )
      }
      const registryType = STORAGE_TYPE_TO_REGISTRY[options.storage]
      if (!KeyProviderRegistry.getProviderTypes().includes(registryType)) {
        throw new Error(
          `Storage backend "${options.storage}" is not registered in this build ` +
            `(expected registry type "${registryType}"). Registered types: ${KeyProviderRegistry.getProviderTypes().join(', ')}`,
        )
      }
      if (options.storage === 'keychain' && !keychainAvailable) {
        throw new Error('macOS Keychain is not available on this system')
      }
      if (options.storage === '1password' && !opAvailable) {
        throw new Error('1Password CLI (op) is not installed')
      }
      if (options.storage === 'yubikey' && !yubikeyInstalled) {
        throw new Error('YubiKey CLI (ykman) is not installed')
      }
      flagStorage = options.storage
    }

    const keyStorageType = await resolveOrPrompt(flagStorage, '--storage', () =>
      select({
        message: 'Where should the private key be stored?',
        choices: storageChoices,
      }),
    )

    // ============================================================
    // PHASE 1: Collect all provider-specific configuration
    // (before generating key to avoid holding key material during prompts)
    // ============================================================

    // Storage configuration interfaces
    interface FileStorageConfig {
      type: 'file'
      keyPath: string
      passphrase?: string
    }
    interface KeychainStorageConfig {
      type: 'keychain'
      selectedKeychain: { name: string; path: string }
      keychainItemName: string
    }
    interface OnePasswordStorageConfig {
      type: '1password'
      selectedAccountUuid: string
      accountDisplayName: string
      selectedVault: string
      item: string
    }
    interface YubiKeyStorageConfig {
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
        const keysDir = join(getIdentityConfigDir(), 'keys')
        const keyPath = join(keysDir, `${slug}.pem`)

        let passphrase: string | undefined
        if (options.passphraseStdin) {
          passphrase = await readStdin()
          if (passphrase.length === 0) {
            throw new Error('--passphrase-stdin was set but stdin was empty')
          }
        }

        storageConfig = { type: 'file', keyPath, ...(passphrase !== undefined && { passphrase }) }
        break
      }
      case 'keychain': {
        // Check if available (using static method)
        if (!isMacOSKeychainAvailable()) {
          error('macOS Keychain is not available on this system')
          process.exit(ExitCode.CONFIG_ERROR)
        }

        // Notify user about keychain access
        log('')
        info('Accessing macOS Keychain to list available keychains...')
        info('You may be prompted to allow access or enter your password.')

        // List available keychains
        const keychains = await listMacOSKeychains()

        if (keychains.length === 0) {
          throw new Error('No keychains found on this system')
        }

        // Format keychain display with bold name and dim path
        const formatKeychainChoice = (kc: { name: string; path: string }): string => {
          return `${theme.blue.bold()(kc.name)} ${theme.muted(`(${kc.path})`)}`
        }

        // Select keychain (flag > auto-select if only one > prompt)
        let selectedKeychain: { name: string; path: string }
        if (options.keychainPath !== undefined) {
          const found = keychains.find((kc) => kc.path === options.keychainPath)
          if (!found) {
            throw new Error(
              `--keychain-path "${options.keychainPath}" not found. Available keychains: ${keychains.map((kc) => kc.path).join(', ')}`,
            )
          }
          selectedKeychain = found
        } else if (keychains.length === 1 && keychains[0]) {
          selectedKeychain = keychains[0]
          info(`Using keychain: ${formatKeychainChoice(selectedKeychain)}`)
        } else {
          selectedKeychain = await resolveOrPrompt(undefined, '--keychain-path', async () => {
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
            return foundKeychain
          })
        }

        // Prompt for item name
        const keychainItemName = await resolveOptionalOrPrompt(
          options.keychainItem,
          '--keychain-item',
          `attest-it-${slug}`,
          () =>
            input({
              message: 'Keychain item name:',
              default: `attest-it-${slug}`,
              validate: (value) => {
                if (!value || value.trim().length === 0) {
                  return 'Item name cannot be empty'
                }
                return true
              },
            }),
        )

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

        // List available 1Password accounts (includes friendly names)
        const { accounts, inaccessible } = await listOnePasswordAccounts()

        if (accounts.length === 0) {
          throw new Error(
            '1Password CLI is installed but no accounts are signed in. Run "op signin" first.',
          )
        }

        // Report inaccessible accounts so users understand why they're not offered
        if (inaccessible.length > 0) {
          log('')
          log(theme.yellow(`Some accounts could not be accessed (${String(inaccessible.length)}):`))
          for (const acc of inaccessible) {
            log(theme.muted(`  - ${acc.email} (${acc.url})`))
            log(theme.muted(`    Reason: ${acc.reason}`))
          }
        }

        // Format account display with bold name and dim domain (matching `op signin` style)
        // Provider guarantees name is present for all returned accounts
        const formatAccountChoice = (acc: { name: string; url: string }): string => {
          return `${theme.blue.bold()(acc.name)} ${theme.muted(`(${acc.url})`)}`
        }

        // Select account (flag > auto-select if only one > prompt)
        // Use account_uuid as the identifier (required by `op` CLI)
        let selectedAccountUuid: string
        let selectedAccountDisplayName: string
        if (options.opAccount !== undefined) {
          const found = accounts.find((acc) => acc.account_uuid === options.opAccount)
          if (!found) {
            throw new Error(
              `--op-account "${options.opAccount}" not found among signed-in accounts`,
            )
          }
          selectedAccountUuid = found.account_uuid
          selectedAccountDisplayName = found.name
        } else if (accounts.length === 1 && accounts[0]) {
          selectedAccountUuid = accounts[0].account_uuid
          selectedAccountDisplayName = accounts[0].name
          info(`Using 1Password account: ${formatAccountChoice(accounts[0])}`)
        } else {
          selectedAccountUuid = await resolveOrPrompt(undefined, '--op-account', () =>
            select({
              message: 'Select 1Password account:',
              choices: accounts.map((acc) => ({
                name: formatAccountChoice(acc),
                value: acc.account_uuid,
              })),
            }),
          )
          const selectedAcc = accounts.find((acc) => acc.account_uuid === selectedAccountUuid)
          if (!selectedAcc) {
            throw new Error('Selected account not found')
          }
          selectedAccountDisplayName = selectedAcc.name
        }

        // List vaults for selected account
        const vaults = await listOnePasswordVaults(selectedAccountUuid)

        if (vaults.length === 0) {
          throw new Error(`No vaults found in 1Password account: ${selectedAccountDisplayName}`)
        }

        // Select vault (flag > auto-select if only one > prompt)
        let selectedVault: string
        if (options.opVault !== undefined) {
          const found = vaults.find((v) => v.name === options.opVault)
          if (!found) {
            throw new Error(
              `--op-vault "${options.opVault}" not found in account ${selectedAccountDisplayName}`,
            )
          }
          selectedVault = found.name
        } else if (vaults.length === 1 && vaults[0]) {
          selectedVault = vaults[0].name
        } else {
          selectedVault = await resolveOrPrompt(undefined, '--op-vault', () =>
            select({
              message: 'Select vault for private key storage:',
              choices: vaults.map((v) => ({
                name: v.name,
                value: v.name,
              })),
            }),
          )
        }

        // Prompt for item name
        const item = await resolveOptionalOrPrompt(
          options.opItem,
          '--op-item',
          `attest-it-${slug}`,
          () =>
            input({
              message: '1Password item name:',
              default: `attest-it-${slug}`,
              validate: (value) => {
                if (!value || value.trim().length === 0) {
                  return 'Item name cannot be empty'
                }
                return true
              },
            }),
        )

        storageConfig = {
          type: '1password',
          selectedAccountUuid,
          accountDisplayName: selectedAccountDisplayName,
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
        if (!(await isYubiKeyConnected())) {
          error('No YubiKey detected. Please insert your YubiKey and try again.')
          process.exit(ExitCode.CONFIG_ERROR)
        }

        // List connected YubiKeys
        const yubikeys = await listYubiKeyDevices()

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

        // Select YubiKey (flag > auto-select if only one > prompt)
        let selectedSerial: string
        if (options.yubikeySerial !== undefined) {
          const found = yubikeys.find((yk) => yk.serial === options.yubikeySerial)
          if (!found) {
            throw new Error(
              `--yubikey-serial "${options.yubikeySerial}" not found among connected devices`,
            )
          }
          selectedSerial = found.serial
        } else if (yubikeys.length === 1 && yubikeys[0]) {
          selectedSerial = yubikeys[0].serial
          info(`Using YubiKey: ${formatYubiKeyChoice(yubikeys[0])}`)
        } else {
          selectedSerial = await resolveOrPrompt(undefined, '--yubikey-serial', () =>
            select({
              message: 'Select YubiKey:',
              choices: yubikeys.map((yk) => ({
                name: formatYubiKeyChoice(yk),
                value: yk.serial,
              })),
            }),
          )
        }

        // Check if challenge-response is configured on slot 2
        const slot: 1 | 2 = 2 // Default to slot 2 for challenge-response
        const isChallengeResponseConfigured = await isYubiKeyChallengeResponseConfigured(
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
        const encryptedKeyName = await resolveOptionalOrPrompt(
          options.encryptedKeyName,
          '--encrypted-key-name',
          `${slug}.enc`,
          () =>
            input({
              message: 'Encrypted key file name:',
              default: `${slug}.enc`,
              validate: (value) => {
                if (!value || value.trim().length === 0) {
                  return 'File name cannot be empty'
                }
                return true
              },
            }),
        )

        // Determine encrypted key path
        const keysDir = join(getIdentityConfigDir(), 'keys')
        const encryptedKeyPath = join(keysDir, encryptedKeyName)

        storageConfig = { type: 'yubikey', selectedSerial, slot, encryptedKeyPath }
        break
      }
      default:
        throw new Error(`Unknown key storage type: ${String(keyStorageType)}`)
    }

    // ============================================================
    // PHASE 2: Generate key pair (now that we have all user input)
    // ============================================================
    log('')
    log('Generating Ed25519 keypair...')

    // Generate keypair (this is synchronous, returns KeyPair not Promise)
    const keyPair = generateEd25519KeyPair(
      storageConfig.type === 'file' && storageConfig.passphrase !== undefined
        ? { passphrase: storageConfig.passphrase }
        : {},
    )

    // ============================================================
    // PHASE 3: Store the key using collected configuration
    // ============================================================

    // Build private key reference based on storage type
    let privateKeyRef: PrivateKeyRef
    let keyStorageDescription: string

    switch (storageConfig.type) {
      case 'file': {
        log('')
        info('Storing private key via VaultKeeper (file backend)...')
        // When --passphrase-stdin is set, PHASE 2 already encrypted the PEM, so
        // the value handed to VaultKeeper is the passphrase-protected key.
        const result = await storePrivateKey('file', keyPair.privateKey, name)
        privateKeyRef = { type: 'file', id: result.secretId }
        keyStorageDescription = storageConfig.passphrase
          ? `${result.storageDescription} (passphrase-encrypted)`
          : result.storageDescription
        break
      }
      case 'keychain': {
        log('')
        info('Storing private key via VaultKeeper (macOS Keychain backend)...')
        const result = await storePrivateKey('keychain', keyPair.privateKey, name)
        privateKeyRef = { type: 'keychain', id: result.secretId }
        keyStorageDescription = result.storageDescription
        break
      }
      case '1password': {
        log('')
        info('Storing private key via VaultKeeper (1Password backend)...')
        const result = await storePrivateKey('1password', keyPair.privateKey, name)
        privateKeyRef = {
          type: '1password',
          id: result.secretId,
          vault: storageConfig.selectedVault,
        }
        keyStorageDescription = `VaultKeeper 1Password (${storageConfig.accountDisplayName}/${storageConfig.selectedVault}): ${result.secretId}`
        break
      }
      case 'yubikey': {
        log('')
        info('Storing private key via VaultKeeper (YubiKey backend)...')
        const result = await storePrivateKey('yubikey', keyPair.privateKey, name)
        privateKeyRef = { type: 'yubikey', id: result.secretId }
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
        version: 2,
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

// Exported for testing
export { slugify, deriveUniqueSlug, runCreate }
