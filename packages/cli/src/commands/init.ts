import { Command } from 'commander'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { log, success, error } from '../utils/output.js'
import { confirmAction } from '../utils/prompts.js'
import { ExitCode } from '../utils/exit-codes.js'
import { offerCompletionInstall } from '../utils/completion-offer.js'

export const initCommand = new Command('init')
  .description('Initialize attest-it configuration')
  .option('-p, --path <path>', 'Config file path', '.attest-it/config.yaml')
  .option('-f, --force', 'Overwrite existing config')
  .action(async (options: InitOptions) => {
    await runInit(options)
  })

interface InitOptions {
  path: string
  force?: boolean
}

const CONFIG_TEMPLATE = `# attest-it configuration
# See https://github.com/attest-it/attest-it for documentation

version: 1

settings:
  # How long attestations remain valid (in days)
  maxAgeDays: 30
  # Path to the public key used for signature verification
  publicKeyPath: .attest-it/pubkey.pem
  # Path to the attestations file
  attestationsPath: .attest-it/attestations.json
  # Signing algorithm
  algorithm: rsa

# Define your test suites below. Each suite groups tests that require
# human verification before their attestations are accepted.
#
# Example:
#
# suites:
#   visual-tests:
#     description: Visual regression tests requiring human review
#     packages:
#       - packages/ui
#       - packages/components
#     command: pnpm vitest packages/ui packages/components
#
#   integration:
#     description: Integration tests with external services
#     packages:
#       - packages/api
#     command: pnpm vitest packages/api --project=integration

suites: {}
`

/**
 * Run the init command to create a new attest-it configuration.
 *
 * Creates a configuration file with sensible defaults and commented
 * examples showing how to define test suites.
 *
 * @param options - Command options
 * @param options.path - Config file path (default: .attest-it/config.yaml)
 * @param options.force - Overwrite existing config without prompting
 * @public
 */
async function runInit(options: InitOptions): Promise<void> {
  try {
    const configPath = path.resolve(options.path)
    const configDir = path.dirname(configPath)

    if (fs.existsSync(configPath) && !options.force) {
      const overwrite = await confirmAction({
        message: `Config already exists at ${configPath}. Overwrite?`,
        default: false,
      })
      if (!overwrite) {
        error('Init cancelled')
        process.exit(ExitCode.CANCELLED)
      }
    }

    // Create directory and write config
    await fs.promises.mkdir(configDir, { recursive: true })
    await fs.promises.writeFile(configPath, CONFIG_TEMPLATE, 'utf-8')

    success(`Configuration created at ${configPath}`)
    log('')
    log('Next steps:')
    log(`  1. Edit ${options.path} to define your test suites`)
    log('  2. Run: attest-it keygen')
    log('  3. Run: attest-it status')

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

export { runInit }
