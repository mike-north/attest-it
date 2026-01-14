import { Command } from 'commander'
import * as fs from 'node:fs'
import {
  checkOpenSSL,
  generateKeyPair,
  getDefaultPrivateKeyPath,
  getDefaultPublicKeyPath,
  setKeyPermissions,
  OnePasswordKeyProvider,
} from '@attest-it/core'
import { log, success, error, warn, info } from '../utils/output.js'
import { confirmAction } from '../utils/prompts.js'
import { ExitCode } from '../utils/exit-codes.js'
import { runKeygenInteractive } from './keygen-interactive.js'

export const keygenCommand = new Command('keygen')
  .description('Generate a new RSA keypair for signing attestations')
  .option('-o, --output <path>', 'Public key output path')
  .option('-p, --private <path>', 'Private key output path (filesystem only)')
  .option('--provider <type>', 'Key provider: filesystem or 1password (skips interactive)')
  .option('--vault <name>', '1Password vault name')
  .option('--item-name <name>', '1Password item name')
  .option('--account <email>', '1Password account')
  .option('-f, --force', 'Overwrite existing keys')
  .option('--no-interactive', 'Disable interactive mode')
  .action(async (options: KeygenOptions) => {
    await runKeygen(options)
  })

interface KeygenOptions {
  output?: string
  private?: string
  provider?: string
  vault?: string
  itemName?: string
  account?: string
  force?: boolean
  interactive?: boolean
}

/**
 * Run the keygen command to generate a new cryptographic keypair.
 *
 * Generates an RSA-2048 keypair with SHA-256 signatures, which is universally
 * supported across all OpenSSL and LibreSSL versions.
 *
 * @param options - Command options
 * @param options.output - Public key output path
 * @param options.private - Private key output path (filesystem only)
 * @param options.provider - Key provider type (skips interactive)
 * @param options.vault - 1Password vault name
 * @param options.itemName - 1Password item name
 * @param options.account - 1Password account email
 * @param options.force - Overwrite existing keys without prompting
 * @param options.interactive - Enable interactive mode (default: true)
 * @public
 */
async function runKeygen(options: KeygenOptions): Promise<void> {
  try {
    // Use interactive mode if not explicitly disabled and provider not specified
    const useInteractive = options.interactive !== false && !options.provider

    if (useInteractive) {
      // Run interactive flow
      // Build options, only including properties if defined
      const interactiveOptions: { publicKeyPath?: string; force?: boolean } = {}
      if (options.output !== undefined) {
        interactiveOptions.publicKeyPath = options.output
      }
      if (options.force !== undefined) {
        interactiveOptions.force = options.force
      }

      const result = await runKeygenInteractive(interactiveOptions)

      // Show success message with next steps
      success('Keypair generated successfully!')
      log('')
      log('Private key stored in:')
      log(`  ${result.storageDescription}`)
      log('')
      log('Public key (commit to repo):')
      log(`  ${result.publicKeyPath}`)
      log('')

      if (result.provider === '1password') {
        log('Add to your .attest-it/config.yaml:')
        log('')
        log('settings:')
        log(`  publicKeyPath: ${result.publicKeyPath}`)
        log('  keyProvider:')
        log('    type: 1password')
        log('    options:')
        if (result.account) {
          log(`      account: ${result.account}`)
        }
        log(`      vault: ${result.vault ?? ''}`)
        log(`      itemName: ${result.itemName ?? ''}`)
        log('')
      }

      log('Next steps:')
      log(`  1. git add ${result.publicKeyPath}`)
      if (result.provider === '1password') {
        log('  2. Update .attest-it/config.yaml with keyProvider settings')
      } else {
        log('  2. Update .attest-it/config.yaml publicKeyPath if needed')
      }
      log('  3. attest-it run --suite <suite-name>')
    } else {
      // Non-interactive mode
      await runNonInteractiveKeygen(options)
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

/**
 * Run keygen in non-interactive mode.
 * @internal
 */
async function runNonInteractiveKeygen(options: KeygenOptions): Promise<void> {
  // Check OpenSSL
  log('Checking OpenSSL...')
  const version = await checkOpenSSL()
  info(`OpenSSL: ${version}`)

  const publicPath = options.output ?? getDefaultPublicKeyPath()

  if (options.provider === '1password') {
    // 1Password provider mode
    if (!options.vault || !options.itemName) {
      throw new Error('--vault and --item-name are required for 1password provider')
    }

    // Build provider options, only including account if defined
    const providerOptions: { vault: string; itemName: string; account?: string } = {
      vault: options.vault,
      itemName: options.itemName,
    }
    if (options.account !== undefined) {
      providerOptions.account = options.account
    }

    const provider = new OnePasswordKeyProvider(providerOptions)

    log(`Generating keypair with 1Password storage...`)
    log(`Vault: ${options.vault}`)
    log(`Item: ${options.itemName}`)

    // Build generation options, only including force if defined
    const genOptions: { publicKeyPath: string; force?: boolean } = { publicKeyPath: publicPath }
    if (options.force !== undefined) {
      genOptions.force = options.force
    }

    const result = await provider.generateKeyPair(genOptions)

    success('Keypair generated successfully!')
    log('')
    log('Private key stored in:')
    log(`  ${result.storageDescription}`)
    log('')
    log('Public key (commit to repo):')
    log(`  ${result.publicKeyPath}`)
  } else {
    // Filesystem provider mode (default)
    const privatePath = options.private ?? getDefaultPrivateKeyPath()

    log(`Private key: ${privatePath}`)
    log(`Public key: ${publicPath}`)

    // Check if keys already exist
    const privateExists = fs.existsSync(privatePath)
    const publicExists = fs.existsSync(publicPath)

    if ((privateExists || publicExists) && !options.force) {
      if (privateExists) {
        warn(`Private key already exists: ${privatePath}`)
      }
      if (publicExists) {
        warn(`Public key already exists: ${publicPath}`)
      }

      const shouldOverwrite = await confirmAction({
        message: 'Overwrite existing keys?',
        default: false,
      })

      if (!shouldOverwrite) {
        error('Keygen cancelled')
        process.exit(ExitCode.CANCELLED)
      }
    }

    // Generate keypair
    log('\nGenerating RSA-2048 keypair...')

    const result = await generateKeyPair({
      privatePath,
      publicPath,
      force: true,
    })

    // Set permissions on private key
    await setKeyPermissions(result.privatePath)

    success('Keypair generated successfully!')
    log('')
    log('Private key (KEEP SECRET):')
    log(`  ${result.privatePath}`)
    log('')
    log('Public key (commit to repo):')
    log(`  ${result.publicPath}`)
  }

  log('')
  info('Important: Back up your private key securely!')
  log('')
  log('Next steps:')
  log(`  1. git add ${publicPath}`)
  log('  2. Update .attest-it/config.yaml publicKeyPath if needed')
  log('  3. attest-it run --suite <suite-name>')
}

export { runKeygen }
