/**
 * Run command implementation for attest-it CLI.
 */

import { Command } from 'commander'
import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import { parse as parseShellCommand } from 'shell-quote'
import {
  loadConfig,
  computeFingerprint,
  readAttestations,
  writeSignedAttestations,
  upsertAttestation,
  createAttestation,
  getDefaultPrivateKeyPath,
  type Config,
} from '@attest-it/core'
import { log, success, error, warn, verbose } from '../utils/output.js'
import { confirmAction } from '../utils/prompts.js'
import { ExitCode } from '../utils/exit-codes.js'

export const runCommand = new Command('run')
  .description('Execute tests and create attestation')
  .option('-s, --suite <name>', 'Run specific suite (required unless --all)')
  .option('-a, --all', 'Run all suites needing attestation')
  .option('--no-attest', 'Run tests without creating attestation')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (options: RunOptions) => {
    await runTests(options)
  })

interface RunOptions {
  suite?: string
  all?: boolean
  attest?: boolean // Note: --no-attest sets this to false
  yes?: boolean
}

/**
 * Run tests and create attestations.
 *
 * Executes test commands for specified suite(s), computes fingerprints,
 * and creates signed attestations upon successful test completion.
 *
 * @param options - Command options
 * @param options.suite - Run specific suite (required unless --all)
 * @param options.all - Run all suites needing attestation
 * @param options.attest - Create attestation after tests (default: true)
 * @param options.yes - Skip confirmation prompt
 * @public
 */
async function runTests(options: RunOptions): Promise<void> {
  try {
    // Validate options
    if (!options.suite && !options.all) {
      error('Either --suite or --all is required')
      process.exit(ExitCode.CONFIG_ERROR)
    }

    // Load config
    const config = await loadConfig()

    // Determine which suites to run
    const suitesToRun = options.all
      ? Object.keys(config.suites)
      : options.suite
        ? [options.suite]
        : []

    // Validate suite exists
    if (options.suite && !config.suites[options.suite]) {
      error(`Suite "${options.suite}" not found in config`)
      process.exit(ExitCode.CONFIG_ERROR)
    }

    // Check for dirty working tree
    const isDirty = await checkDirtyWorkingTree()
    if (isDirty) {
      error('Working tree has uncommitted changes. Please commit or stash before attesting.')
      process.exit(ExitCode.CONFIG_ERROR)
    }

    // Process each suite
    for (const suiteName of suitesToRun) {
      // eslint-disable-next-line security/detect-object-injection -- suiteName is from validated config keys
      const suiteConfig = config.suites[suiteName]
      if (!suiteConfig) continue

      log(`\n=== Running suite: ${suiteName} ===\n`)

      // Compute fingerprint before running
      const fingerprintOptions = {
        packages: suiteConfig.packages,
        ...(suiteConfig.ignore && { ignore: suiteConfig.ignore }),
      }
      const fingerprintResult = await computeFingerprint(fingerprintOptions)
      verbose(`Fingerprint: ${fingerprintResult.fingerprint}`)
      verbose(`Files: ${String(fingerprintResult.fileCount)}`)

      // Build the test command
      const command = buildCommand(config, suiteConfig.command, suiteConfig.files)
      log(`Running: ${command}`)
      log('')

      // Execute tests
      const exitCode = await executeCommand(command)

      if (exitCode !== 0) {
        error(`Tests failed with exit code ${String(exitCode)}`)
        process.exit(ExitCode.FAILURE)
      }

      success('Tests passed!')

      // Skip attestation if --no-attest
      if (options.attest === false) {
        log('Skipping attestation (--no-attest)')
        continue
      }

      // Confirm attestation
      const shouldAttest =
        options.yes ??
        (await confirmAction({
          message: 'Create attestation?',
          default: true,
        }))

      if (!shouldAttest) {
        warn('Attestation cancelled')
        process.exit(ExitCode.CANCELLED)
      }

      // Create attestation
      const attestation = createAttestation({
        suite: suiteName,
        fingerprint: fingerprintResult.fingerprint,
        command,
        attestedBy: os.userInfo().username,
      })

      // Load existing attestations
      const attestationsPath = config.settings.attestationsPath
      const existingFile = await readAttestations(attestationsPath)
      const existingAttestations = existingFile?.attestations ?? []

      // Upsert the new attestation
      const newAttestations = upsertAttestation(existingAttestations, attestation)

      // Get private key path (from config or default)
      const privateKeyPath = getDefaultPrivateKeyPath()

      // Check if private key exists
      if (!fs.existsSync(privateKeyPath)) {
        error(`Private key not found: ${privateKeyPath}`)
        error('Run "attest-it keygen" first to generate a keypair.')
        process.exit(ExitCode.MISSING_KEY)
      }

      // Write signed attestations
      await writeSignedAttestations({
        filePath: attestationsPath,
        attestations: newAttestations,
        privateKeyPath,
      })

      success(`Attestation created for ${suiteName}`)
      log(`  Fingerprint: ${fingerprintResult.fingerprint}`)
      log(`  Attested by: ${attestation.attestedBy}`)
      log(`  Attested at: ${attestation.attestedAt}`)
    }

    log('')
    success('All suites completed!')
    log(
      `\nTo commit: git add ${config.settings.attestationsPath} && git commit -m "Update attestations"`,
    )
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
 * Build the test command to execute.
 *
 * Uses suite-specific command if provided, otherwise falls back to
 * default command from settings. Substitutes ${files} placeholder
 * with suite file patterns.
 *
 * @param config - Configuration object
 * @param suiteCommand - Suite-specific command (optional)
 * @param suiteFiles - File patterns for suite (optional)
 * @returns Constructed command string
 * @public
 */
function buildCommand(config: Config, suiteCommand?: string, suiteFiles?: string[]): string {
  // Use suite command if specified, otherwise default
  let command = suiteCommand ?? config.settings.defaultCommand

  if (!command) {
    error('No command specified for suite and no defaultCommand in settings')
    process.exit(ExitCode.CONFIG_ERROR)
  }

  // Substitute ${files} if present (replace all occurrences)
  if (command.includes('${files}') && suiteFiles) {
    const files = suiteFiles.join(' ')
    command = command.replaceAll('${files}', files)
  }

  return command
}

/**
 * Parsed command result.
 */
interface ParsedCommand {
  executable: string
  args: string[]
}

/**
 * Parse a command string into executable and arguments.
 *
 * Uses shell-quote to safely parse shell syntax without using shell: true.
 *
 * @param command - Command string to parse
 * @returns Parsed command with executable and arguments
 * @throws Error if command is empty or contains only control operators
 * @public
 */
function parseCommand(command: string): ParsedCommand {
  const parsed = parseShellCommand(command)

  // shell-quote returns an array of strings and special control operators
  // We only want the string arguments
  const stringArgs = parsed.filter((token): token is string => {
    return typeof token === 'string'
  })

  if (stringArgs.length === 0) {
    throw new Error('Command string is empty or contains only control operators')
  }

  const [executable, ...args] = stringArgs
  // TypeScript doesn't know that stringArgs.length > 0 guarantees executable is defined
  // The check above ensures stringArgs[0] exists, but we assert it for type safety
  if (executable === undefined) {
    throw new Error('Command string is empty or contains only control operators')
  }

  return { executable, args }
}

/**
 * Execute a command and return its exit code.
 *
 * Spawns a child process and streams output to the terminal.
 *
 * @param command - Command string to execute
 * @returns Exit code from the command (0 for success)
 * @public
 */
async function executeCommand(command: string): Promise<number> {
  return new Promise((resolve) => {
    let parsed: ParsedCommand
    try {
      parsed = parseCommand(command)
    } catch (err) {
      if (err instanceof Error) {
        error(`Failed to parse command: ${err.message}`)
      } else {
        error('Failed to parse command: Unknown error')
      }
      resolve(1)
      return
    }

    const child = spawn(parsed.executable, parsed.args, {
      stdio: 'inherit', // Stream output to terminal
    })

    child.on('close', (code) => {
      resolve(code ?? 1)
    })

    child.on('error', (err) => {
      error(`Failed to execute command: ${err.message}`)
      resolve(1)
    })
  })
}

/**
 * Check if the git working tree has uncommitted changes.
 *
 * @returns True if there are uncommitted changes, false otherwise
 * @public
 */
async function checkDirtyWorkingTree(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('git', ['status', '--porcelain'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let output = ''
    child.stdout.on('data', (data: Buffer) => {
      output += data.toString()
    })

    child.on('close', () => {
      // If output is non-empty, there are uncommitted changes
      resolve(output.trim().length > 0)
    })

    child.on('error', () => {
      // If git not available, assume not dirty
      resolve(false)
    })
  })
}

// Export for testing
export { buildCommand, parseCommand, executeCommand, checkDirtyWorkingTree }
