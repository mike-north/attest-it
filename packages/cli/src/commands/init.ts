import { Command } from 'commander'
import * as fs from 'node:fs'
import * as path from 'node:path'
import YAML from 'yaml'
import { log, success, error, info } from '../utils/output.js'
import { confirmAction, getInput, selectOption } from '../utils/prompts.js'
import { ExitCode } from '../utils/exit-codes.js'

export const initCommand = new Command('init')
  .description('Initialize attest-it configuration')
  .option('-p, --path <path>', 'Config file path', '.attest-it/config.yaml')
  .option('-f, --force', 'Overwrite existing config')
  .option('--json', 'Output JSON instead of YAML')
  .action(async (options: InitOptions) => {
    await runInit(options)
  })

interface InitOptions {
  path: string
  force?: boolean
  json?: boolean
}

interface SuiteInput {
  name: string
  description: string
  packages: string[]
  command: string
}

interface ConfigSuite {
  description?: string
  packages: string[]
  command: string
}

interface Config {
  version: number
  settings: {
    maxAgeDays: number
    publicKeyPath: string
    attestationsPath: string
    algorithm: string
  }
  suites: Record<string, ConfigSuite>
}

/**
 * Run the init command to create a new attest-it configuration.
 *
 * Interactively prompts the user for settings and suite configurations,
 * then creates a configuration file in the specified location.
 *
 * @param options - Command options
 * @param options.path - Config file path (default: .attest-it/config.yaml)
 * @param options.force - Overwrite existing config without prompting
 * @param options.json - Output JSON instead of YAML
 * @public
 */
async function runInit(options: InitOptions): Promise<void> {
  try {
    // Check if config already exists
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

    log('')
    info('Welcome to attest-it!')
    log('This will create a configuration file for human-gated test attestations.')
    log('')

    // Gather settings
    const maxAgeDays = await getInput({
      message: 'Maximum attestation age (days):',
      default: '30',
      validate: (v) => {
        const n = parseInt(v, 10)
        return !isNaN(n) && n > 0 ? true : 'Must be a positive number'
      },
    })

    const algorithm = await selectOption({
      message: 'Signing algorithm:',
      choices: [
        {
          value: 'ed25519',
          name: 'Ed25519 (Recommended)',
          description: 'Fast, modern, secure',
        },
        { value: 'rsa', name: 'RSA', description: 'Broader compatibility' },
      ],
    })

    // Gather suites
    const suites: SuiteInput[] = []
    let addMore = true

    log('')
    info('Now configure your test suites.')
    log('Suites are groups of tests that require human verification.')
    log('')

    while (addMore) {
      const suiteName = await getInput({
        message: 'Suite name:',
        validate: (v) => (v.length > 0 ? true : 'Required'),
      })

      const description = await getInput({
        message: 'Description (optional):',
      })

      const packagesInput = await getInput({
        message: 'Package paths (comma-separated):',
        default: `packages/${suiteName}`,
        validate: (v) => (v.length > 0 ? true : 'At least one package required'),
      })

      const command = await getInput({
        message: 'Test command:',
        default: `pnpm vitest ${packagesInput.split(',')[0]?.trim() ?? ''}`,
      })

      suites.push({
        name: suiteName,
        description,
        packages: packagesInput
          .split(',')
          .map((p) => p.trim())
          .filter(Boolean),
        command,
      })

      addMore = await confirmAction({
        message: 'Add another suite?',
        default: false,
      })
    }

    if (suites.length === 0) {
      error('At least one suite is required')
      process.exit(ExitCode.CONFIG_ERROR)
    }

    // Build config object
    const config: Config = {
      version: 1,
      settings: {
        maxAgeDays: parseInt(maxAgeDays, 10),
        publicKeyPath: '.attest-it/pubkey.pem',
        attestationsPath: '.attest-it/attestations.json',
        algorithm,
      },
      suites: Object.fromEntries(
        suites.map((s) => {
          const suite: ConfigSuite = {
            packages: s.packages,
            command: s.command,
          }
          // Only add description if it's not empty
          if (s.description) {
            suite.description = s.description
          }
          return [s.name, suite]
        }),
      ),
    }

    // Create directory
    await fs.promises.mkdir(configDir, { recursive: true })

    // Write config
    const content = options.json
      ? JSON.stringify(config, null, 2)
      : YAML.stringify(config, { indent: 2 })

    await fs.promises.writeFile(configPath, content, 'utf-8')

    // Create .gitkeep for attestations directory
    const attestDir = path.dirname(
      path.resolve(path.dirname(configPath), config.settings.attestationsPath),
    )
    await fs.promises.mkdir(attestDir, { recursive: true })

    success(`Configuration created at ${configPath}`)
    log('')
    log('Next steps:')
    log('  1. Review and edit the configuration as needed')
    log('  2. Run: attest-it keygen')
    log('  3. Run: attest-it run --suite <suite-name>')
    log('  4. Commit the attestation file')
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
