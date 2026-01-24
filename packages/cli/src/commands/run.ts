/**
 * Run command implementation for attest-it CLI.
 */

import { Command } from 'commander'
import { spawn } from 'node:child_process'
import * as os from 'node:os'
import { parse as parseShellCommand } from 'shell-quote'
import {
  loadConfig,
  toAttestItConfig,
  computeFingerprint,
  computeFingerprintSync,
  readAttestations,
  writeSignedAttestations,
  upsertAttestation,
  createAttestation,
  getDefaultPrivateKeyPath,
  FilesystemKeyProvider,
  KeyProviderRegistry,
  loadLocalConfigSync,
  getActiveIdentity,
  isAuthorizedSigner,
  createSeal,
  readSealsSync,
  writeSealsSync,
  type Config,
  type KeyProvider,
  type Identity,
} from '@attest-it/core'
import { log, success, error, warn, verbose } from '../utils/output.js'
import { confirmAction } from '../utils/prompts.js'
import { ExitCode } from '../utils/exit-codes.js'
import { runInteractive } from './run-interactive.js'
import { getAllSuiteStatuses } from './run-utils.js'

export const runCommand = new Command('run')
  .description('Execute tests and create attestation')
  .option('-s, --suite <name>', 'Run specific suite (required unless --all or interactive mode)')
  .option('-a, --all', 'Run all suites needing attestation')
  .option('--no-attest', 'Run tests without creating attestation')
  .option('--dry-run', 'Show what would run without executing')
  .option('-c, --continue', 'Resume interrupted session')
  .option('--filter <pattern>', 'Filter suites by pattern (glob-style)')
  .action(async (options: RunOptions) => {
    await runTests(options)
  })

interface RunOptions {
  suite?: string
  all?: boolean
  attest?: boolean // Note: --no-attest sets this to false
  dryRun?: boolean
  continue?: boolean
  filter?: string
}

/**
 * Run tests and create attestations.
 *
 * Routes to the appropriate execution mode based on options:
 * - Direct mode: --suite specified
 * - All pending mode: --all specified
 * - Interactive mode: no --suite and no --all
 *
 * @param options - Command options
 * @param options.suite - Run specific suite
 * @param options.all - Run all suites needing attestation
 * @param options.attest - Create attestation after tests (default: true)
 * @param options.dryRun - Show what would run without executing
 * @param options.continue - Resume interrupted session
 * @param options.filter - Filter suites by pattern
 * @public
 */
async function runTests(options: RunOptions): Promise<void> {
  try {
    // If --suite provided, use existing direct mode
    if (options.suite) {
      await runDirectMode(options)
      return
    }

    // If --all with no --suite, run all pending non-interactively
    if (options.all) {
      await runAllPending(options)
      return
    }

    // No --suite and no --all means interactive mode
    // This includes: no args, --dry-run, --continue, --filter
    await runInteractive({
      dryRun: options.dryRun,
      continue: options.continue,
      filter: options.filter,
    })
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

/**
 * Run tests for a specific suite (direct mode with --suite).
 *
 * @param options - Run options with suite specified
 * @public
 */
async function runDirectMode(options: RunOptions): Promise<void> {
  if (!options.suite) {
    error('Suite name is required for direct mode')
    process.exit(ExitCode.CONFIG_ERROR)
  }

  // Load config
  const config = await loadConfig()

  // Validate suite exists
  if (!config.suites[options.suite]) {
    error(`Suite "${options.suite}" not found in config`)
    process.exit(ExitCode.CONFIG_ERROR)
  }

  // Check for dirty working tree
  const isDirty = await checkDirtyWorkingTree()
  if (isDirty) {
    error('Working tree has uncommitted changes. Please commit or stash before attesting.')
    process.exit(ExitCode.CONFIG_ERROR)
  }

  // Run the suite
  await runSingleSuite(options.suite, config, options)

  log('')
  success('Suite completed!')
  log(
    `\nTo commit: git add ${config.settings.attestationsPath} && git commit -m "Update attestations"`,
  )
}

/**
 * Run all suites that need attestation (--all mode).
 *
 * @param options - Run options
 * @public
 */
async function runAllPending(options: RunOptions): Promise<void> {
  const config = await loadConfig()
  const allSuites = await getAllSuiteStatuses(config)
  const pendingSuites = allSuites.filter((s) => s.status !== 'VALID')

  if (pendingSuites.length === 0) {
    log('All suites are valid. Nothing to run.')
    process.exit(ExitCode.NO_WORK)
  }

  // Apply filter if specified
  let suitesToRun = pendingSuites
  if (options.filter) {
    const regex = new RegExp('^' + options.filter.replace(/\*/g, '.*') + '$', 'i')
    suitesToRun = pendingSuites.filter((s) => regex.test(s.name))

    if (suitesToRun.length === 0) {
      log(`No suites match filter: ${options.filter}`)
      process.exit(ExitCode.NO_WORK)
    }
  }

  // Dry run - just show and exit
  if (options.dryRun) {
    log(`Would run ${String(suitesToRun.length)} suite(s):`)
    suitesToRun.forEach((s, i) => {
      log(`  ${String(i + 1)}. ${s.name} (${s.status})`)
    })
    process.exit(ExitCode.SUCCESS)
  }

  // Check for dirty working tree
  const isDirty = await checkDirtyWorkingTree()
  if (isDirty) {
    error('Working tree has uncommitted changes. Please commit or stash before attesting.')
    process.exit(ExitCode.CONFIG_ERROR)
  }

  // Run each suite using existing direct mode logic
  for (const suite of suitesToRun) {
    await runSingleSuite(suite.name, config, options)
  }

  log('')
  success('All suites completed!')
  log(
    `\nTo commit: git add ${config.settings.attestationsPath} && git commit -m "Update attestations"`,
  )
}

/**
 * Run a single suite's tests and optionally create an attestation.
 *
 * @param suiteName - Name of the suite to run
 * @param config - Configuration object
 * @param options - Run options
 * @public
 */
async function runSingleSuite(
  suiteName: string,
  config: Config,
  options: RunOptions,
): Promise<void> {
  // eslint-disable-next-line security/detect-object-injection -- suiteName is from validated config keys
  const suiteConfig = config.suites[suiteName]
  if (!suiteConfig) {
    error(`Suite "${suiteName}" not found in config`)
    process.exit(ExitCode.CONFIG_ERROR)
  }

  if (!suiteConfig.packages) {
    error(`Suite "${suiteName}" has no packages defined`)
    process.exit(ExitCode.CONFIG_ERROR)
  }

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
    return
  }

  // Confirm attestation
  const shouldAttest = await confirmAction({
    message: 'Create attestation',
    default: false,
  })

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

  // Set up key provider from config or use default
  let keyProvider: KeyProvider
  let keyRef: string

  if (config.settings.keyProvider) {
    keyProvider = KeyProviderRegistry.create({
      type: config.settings.keyProvider.type,
      options: config.settings.keyProvider.options ?? {},
    })
    if (config.settings.keyProvider.type === 'filesystem') {
      keyRef = config.settings.keyProvider.options?.privateKeyPath ?? getDefaultPrivateKeyPath()
    } else if (config.settings.keyProvider.type === '1password') {
      keyRef = config.settings.keyProvider.options?.itemName ?? 'attest-it-private-key'
    } else {
      throw new Error(`Unsupported key provider type: ${config.settings.keyProvider.type}`)
    }
  } else {
    // Default to filesystem provider with default path
    keyProvider = new FilesystemKeyProvider()
    keyRef = getDefaultPrivateKeyPath()
  }

  // Check if key exists
  if (!(await keyProvider.keyExists(keyRef))) {
    error(`Private key not found in ${keyProvider.displayName}`)
    if (keyProvider.type === 'filesystem') {
      error('Run "attest-it identity create" first to generate a keypair.')
    } else {
      error('Run "attest-it identity create" to generate and store a key.')
    }
    process.exit(ExitCode.MISSING_KEY)
  }

  // Write signed attestations
  await writeSignedAttestations({
    filePath: attestationsPath,
    attestations: newAttestations,
    keyProvider,
    keyRef,
  })

  success(`Attestation created for ${suiteName}`)
  log(`  Fingerprint: ${fingerprintResult.fingerprint}`)
  log(`  Attested by: ${attestation.attestedBy}`)
  log(`  Attested at: ${attestation.attestedAt}`)

  // Check if this suite has a linked gate, and if so, prompt for seal
  if (suiteConfig.gate) {
    await promptForSeal(suiteName, suiteConfig.gate, config)
  }
}

/**
 * Prompt for seal creation after successful suite execution.
 *
 * @param suiteName - Name of the suite that was executed
 * @param gateId - ID of the gate linked to the suite
 * @param config - Configuration object
 */
async function promptForSeal(suiteName: string, gateId: string, config: Config): Promise<void> {
  log('')
  log(`Suite '${suiteName}' is linked to gate '${gateId}'`)

  // Load local identity config
  const localConfig = loadLocalConfigSync()
  if (!localConfig) {
    warn('No local identity configuration found - cannot create seal')
    warn('Run "attest-it identity create" to set up your identity')
    return
  }

  // Get active identity
  const identity = getActiveIdentity(localConfig)
  if (!identity) {
    warn(`Active identity '${localConfig.activeIdentity}' not found in local config`)
    return
  }

  // Convert to AttestItConfig
  const attestItConfig = toAttestItConfig(config)

  // Check if user is authorized to seal this gate
  const authorized = isAuthorizedSigner(attestItConfig, gateId, identity.publicKey)
  if (!authorized) {
    warn(`You are not authorized to seal gate '${gateId}'`)
    return
  }

  // Prompt for seal confirmation
  const shouldSeal = await confirmAction({
    message: `Create seal for gate '${gateId}'`,
    default: true,
  })

  if (!shouldSeal) {
    log('Seal creation skipped')
    return
  }

  try {
    // Get gate config
    if (!attestItConfig.gates?.[gateId]) {
      error(`Gate '${gateId}' not found in configuration`)
      return
    }

    // eslint-disable-next-line security/detect-object-injection
    const gate = attestItConfig.gates[gateId]

    // Compute fingerprint for the gate
    const gateFingerprint = computeFingerprintSync({
      packages: gate.fingerprint.paths,
      ...(gate.fingerprint.exclude && { ignore: gate.fingerprint.exclude }),
    })

    // Create key provider from identity's private key reference
    const keyProvider = createKeyProviderFromIdentity(identity)
    const keyRef = getKeyRefFromIdentity(identity)

    // Get private key from provider
    const keyResult = await keyProvider.getPrivateKey(keyRef)

    // Read the key file content
    const fs = await import('node:fs/promises')
    const privateKeyPem = await fs.readFile(keyResult.keyPath, 'utf8')

    // Clean up after reading
    await keyResult.cleanup()

    // Create seal using identity slug (not display name) for verification lookup
    const identitySlug = localConfig.activeIdentity
    const seal = createSeal({
      gateId,
      fingerprint: gateFingerprint.fingerprint,
      sealedBy: identitySlug,
      privateKey: privateKeyPem,
    })

    // Read existing seals
    const projectRoot = process.cwd()
    const sealsFile = readSealsSync(projectRoot, attestItConfig.settings.sealsPath)

    // Add seal to seals file
    // eslint-disable-next-line security/detect-object-injection
    sealsFile.seals[gateId] = seal

    // Write seals file
    writeSealsSync(projectRoot, sealsFile, attestItConfig.settings.sealsPath)

    success(`Seal created for gate '${gateId}'`)
    log(`  Sealed by: ${identitySlug} (${identity.name})`)
    log(`  Timestamp: ${seal.timestamp}`)
  } catch (err) {
    if (err instanceof Error) {
      error(`Failed to create seal: ${err.message}`)
    } else {
      error('Failed to create seal: Unknown error')
    }
  }
}

/**
 * Create a key provider from an identity's private key reference.
 *
 * @param identity - The identity containing the private key reference
 * @returns A key provider instance
 */
function createKeyProviderFromIdentity(
  identity: Identity,
): ReturnType<typeof KeyProviderRegistry.create> {
  const { privateKey } = identity

  switch (privateKey.type) {
    case 'file':
      return KeyProviderRegistry.create({
        type: 'filesystem',
        options: { privateKeyPath: privateKey.path },
      })
    case 'keychain':
      return KeyProviderRegistry.create({
        type: 'macos-keychain',
        options: {
          service: privateKey.service,
          account: privateKey.account,
        },
      })
    case '1password':
      return KeyProviderRegistry.create({
        type: '1password',
        options: {
          account: privateKey.account,
          vault: privateKey.vault,
          itemName: privateKey.item,
          field: privateKey.field,
        },
      })
    case 'yubikey':
      return KeyProviderRegistry.create({
        type: 'yubikey',
        options: {
          encryptedKeyPath: privateKey.encryptedKeyPath,
          slot: privateKey.slot,
          serial: privateKey.serial,
        },
      })
    default: {
      // This should never happen due to TypeScript's discriminated union
      const _exhaustiveCheck: never = privateKey
      throw new Error(`Unsupported private key type: ${String(_exhaustiveCheck)}`)
    }
  }
}

/**
 * Get the key reference string from an identity's private key reference.
 *
 * @param identity - The identity containing the private key reference
 * @returns The key reference string
 */
function getKeyRefFromIdentity(identity: Identity): string {
  const { privateKey } = identity

  switch (privateKey.type) {
    case 'file':
      return privateKey.path
    case 'keychain':
      return `${privateKey.service}:${privateKey.account}`
    case '1password':
      return privateKey.item
    case 'yubikey':
      return privateKey.encryptedKeyPath
    default: {
      const _exhaustiveCheck: never = privateKey
      throw new Error(`Unsupported private key type: ${String(_exhaustiveCheck)}`)
    }
  }
}

// Export for testing
export { buildCommand, parseCommand, executeCommand, checkDirtyWorkingTree }
