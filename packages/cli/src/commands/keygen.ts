import { Command } from 'commander'
import * as fs from 'node:fs'
import {
  checkOpenSSL,
  generateKeyPair,
  getDefaultPrivateKeyPath,
  getDefaultPublicKeyPath,
  setKeyPermissions,
  type Algorithm,
} from '@attest-it/core'
import { log, success, error, warn, info } from '../utils/output.js'
import { confirmAction } from '../utils/prompts.js'
import { ExitCode } from '../utils/exit-codes.js'

export const keygenCommand = new Command('keygen')
  .description('Generate a new keypair for signing attestations')
  .option('-a, --algorithm <alg>', 'Algorithm: ed25519 (default) or rsa', 'ed25519')
  .option('-o, --output <path>', 'Private key output path')
  .option('-p, --public <path>', 'Public key output path')
  .option('-f, --force', 'Overwrite existing keys')
  .action(async (options: KeygenOptions) => {
    await runKeygen(options)
  })

interface KeygenOptions {
  algorithm: string
  output?: string
  public?: string
  force?: boolean
}

/**
 * Run the keygen command to generate a new cryptographic keypair.
 *
 * Checks for OpenSSL availability, generates a keypair using the specified
 * algorithm, and sets appropriate permissions on the private key.
 *
 * @param options - Command options
 * @param options.algorithm - Signing algorithm (ed25519 or rsa)
 * @param options.output - Private key output path
 * @param options.public - Public key output path
 * @param options.force - Overwrite existing keys without prompting
 * @public
 */
async function runKeygen(options: KeygenOptions): Promise<void> {
  try {
    // Validate algorithm
    const algorithm = validateAlgorithm(options.algorithm)

    // Check OpenSSL
    log('Checking OpenSSL...')
    const version = await checkOpenSSL()
    info(`OpenSSL: ${version}`)

    // Determine paths
    const privatePath = options.output ?? getDefaultPrivateKeyPath()
    const publicPath = options.public ?? getDefaultPublicKeyPath()

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
    log(`\nGenerating ${algorithm.toUpperCase()} keypair...`)

    const result = await generateKeyPair({
      algorithm,
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
    log('')
    info('Important: Back up your private key securely!')
    log('')
    log('Next steps:')
    log(`  1. git add ${result.publicPath}`)
    log('  2. Update .attest-it/config.yaml publicKeyPath if needed')
    log('  3. attest-it run --suite <suite-name>')
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
 * Validate and normalize the algorithm string.
 *
 * @param alg - Algorithm string to validate (case-insensitive)
 * @returns Normalized algorithm name ('ed25519' or 'rsa')
 * @throws Exits process with error if algorithm is invalid
 * @public
 */
function validateAlgorithm(alg: string): Algorithm {
  const normalized = alg.toLowerCase()
  if (normalized === 'ed25519' || normalized === 'rsa') {
    return normalized
  }
  error(`Invalid algorithm: ${alg}. Use 'ed25519' or 'rsa'.`)
  process.exit(ExitCode.CONFIG_ERROR)
}

export { runKeygen, validateAlgorithm }
