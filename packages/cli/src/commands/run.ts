/**
 * Run command implementation for attest-it CLI.
 */

import { Command } from 'commander'
import { spawn } from 'node:child_process'
import { parse as parseShellCommand } from 'shell-quote'
import {
  loadSplitConfig,
  computeFingerprint,
  computeFingerprintSync,
  KeyProviderRegistry,
  loadLocalConfigSync,
  getActiveIdentity,
  isAuthorizedSigner,
  createSealWithProvider,
  readSealsSync,
  writeSealsSync,
  writeSealFileSync,
  resolveSealsRoot,
  verifyPatternArtifactSeal,
  type AttestItConfig,
  type GateConfig,
  type Identity,
  type Seal,
} from '@attest-it/core'
import {
  isPatternGate,
  computePatternFingerprintsSync,
  readPatternSealsByArtifactSync,
} from '../utils/pattern-gate.js'
import { log, success, error, warn, verbose } from '../utils/output.js'
import { confirmAction, isInteractiveTTY, handlePromptableError } from '../utils/prompts.js'
import { resolveKeyPassphrase } from '../utils/passphrase.js'
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
  .option('-y, --yes', 'Automatically confirm seal creation without prompting')
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
  yes?: boolean
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
    handlePromptableError(err, ExitCode.CONFIG_ERROR)
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
function buildCommand(
  config: AttestItConfig,
  suiteCommand?: string,
  suiteFiles?: string[],
): string {
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
  const config = await loadSplitConfig()

  // Validate suite exists
  if (!config.suites[options.suite]) {
    error(`Suite "${options.suite}" not found in config`)
    process.exit(ExitCode.CONFIG_ERROR)
  }

  // Check for dirty working tree (skip if ATTEST_IT_ALLOW_DIRTY is set - for dogfooding)
  if (!process.env.ATTEST_IT_ALLOW_DIRTY) {
    const isDirty = await checkDirtyWorkingTree()
    if (isDirty) {
      error('Working tree has uncommitted changes. Please commit or stash before attesting.')
      process.exit(ExitCode.DIRTY_WORKING_TREE)
    }
  }

  // Run the suite
  const outcome = await runSingleSuite(options.suite, config, options)

  // An unauthorized signer never created a seal -- reporting "Suite
  // completed!" (and a "To commit" hint for a seal that was never written)
  // would tell a human or CI script that attestation succeeded when it did
  // not. See issue #136.
  if (outcome === 'unauthorized') {
    log('')
    error(`Suite '${options.suite}' failed: no seal was created (unauthorized signer)`)
    process.exit(ExitCode.FAILURE)
  }

  log('')
  success('Suite completed!')
  log(`\nTo commit: git add ${config.settings.sealsPath} && git commit -m "Update seals"`)
}

/**
 * Run all suites that need attestation (--all mode).
 *
 * @param options - Run options
 * @public
 */
async function runAllPending(options: RunOptions): Promise<void> {
  const config = await loadSplitConfig()
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

  // Check for dirty working tree (skip if ATTEST_IT_ALLOW_DIRTY is set - for dogfooding)
  if (!process.env.ATTEST_IT_ALLOW_DIRTY) {
    const isDirty = await checkDirtyWorkingTree()
    if (isDirty) {
      error('Working tree has uncommitted changes. Please commit or stash before attesting.')
      process.exit(ExitCode.DIRTY_WORKING_TREE)
    }
  }

  // Run each suite using existing direct mode logic
  for (const suite of suitesToRun) {
    const outcome = await runSingleSuite(suite.name, config, options)

    // Same reasoning as runDirectMode: an unauthorized signer wrote no seal,
    // so the run must not be reported as complete/successful. See issue #136.
    if (outcome === 'unauthorized') {
      log('')
      error(`Suite '${suite.name}' failed: no seal was created (unauthorized signer)`)
      process.exit(ExitCode.FAILURE)
    }
  }

  log('')
  success('All suites completed!')
  log(`\nTo commit: git add ${config.settings.sealsPath} && git commit -m "Update seals"`)
}

/**
 * Outcome of {@link runSingleSuite}'s seal-creation step, used by its callers
 * to decide whether the overall command may report success.
 *
 * Only `'unauthorized'` suppresses the "Suite completed!" success banner and
 * forces a nonzero exit -- an unauthorized signer's attempt writes no seal at
 * all, so reporting success would tell the caller (human or CI script) a seal
 * exists when it does not. See issue #136.
 *
 * The other skip reasons inside `promptForSeal` (no local identity
 * configured, active identity not found, or the seal-creation call itself
 * throwing) intentionally keep their pre-existing "warn and continue"
 * behavior -- they are a distinct, non-security reporting gap tracked
 * separately and are out of scope for this fix.
 */
type SealAttemptOutcome = 'sealed' | 'unauthorized' | 'not-attempted'

/**
 * Run a single suite's tests and optionally create an attestation.
 *
 * @param suiteName - Name of the suite to run
 * @param config - Configuration object
 * @param options - Run options
 * @returns The outcome of the suite's seal-creation attempt
 * @public
 */
async function runSingleSuite(
  suiteName: string,
  config: AttestItConfig,
  options: RunOptions,
): Promise<SealAttemptOutcome> {
  // eslint-disable-next-line security/detect-object-injection -- suiteName is from validated config keys
  const suiteConfig = config.suites[suiteName]
  if (!suiteConfig) {
    error(`Suite "${suiteName}" not found in config`)
    process.exit(ExitCode.CONFIG_ERROR)
  }

  // Look up the gate configuration
  const gateId = suiteConfig.gate
  // eslint-disable-next-line security/detect-object-injection -- gateId is from validated config
  const gateConfig = config.gates?.[gateId]
  if (!gateConfig) {
    error(`Gate "${gateId}" not found for suite "${suiteName}"`)
    process.exit(ExitCode.CONFIG_ERROR)
  }

  log(`\n=== Running suite: ${suiteName} ===\n`)

  // Compute fingerprint using gate's fingerprint configuration
  const fingerprintOptions = {
    paths: gateConfig.fingerprint.paths,
    ...(gateConfig.fingerprint.exclude && { exclude: gateConfig.fingerprint.exclude }),
  }
  const fingerprintResult = await computeFingerprint(fingerprintOptions)
  verbose(`Fingerprint: ${fingerprintResult.fingerprint}`)
  verbose(`Files: ${String(fingerprintResult.fileCount)}`)

  // Build the test command
  const command = buildCommand(config, suiteConfig.command)
  log(`Running: ${command}`)
  log('')

  // Execute tests
  const exitCode = await executeCommand(command)

  if (exitCode !== 0) {
    error(`Tests failed with exit code ${String(exitCode)}`)
    process.exit(ExitCode.FAILURE)
  }

  success('Tests passed!')

  // Skip sealing if --no-attest
  if (options.attest === false) {
    log('Skipping seal creation (--no-attest)')
    return 'not-attempted'
  }

  // A successful run authorizes creating a seal for the suite's gate. The seal
  // is the single cryptographic record of the passing run (the legacy
  // attestations file has been retired).
  return await promptForSeal(suiteName, suiteConfig.gate, config, options.yes)
}

/**
 * Prompt for seal creation after successful suite execution.
 *
 * Gated behind "flag not supplied AND stdin is an interactive TTY": with
 * `--yes`, sealing proceeds without prompting; interactively without `--yes`,
 * the existing confirm prompt runs unchanged; non-interactively without
 * `--yes`, this fails fast instead of hanging on a prompt that can never
 * resolve. See issue #80.
 *
 * A user who explicitly declines the prompt exits {@link ExitCode.CANCELLED}
 * rather than falling through to the caller's normal "Suite completed!"
 * success path -- tests passing is not the same as attestation succeeding,
 * and a CI script must be able to tell a declined seal apart from
 * `SUCCESS` (0). See issue #100.
 *
 * An unauthorized signer is reported the same way: it returns `'unauthorized'`
 * (never writes a seal) so the caller can turn the whole command into a hard
 * failure instead of the previous "warn and report success" behavior. See
 * issue #136.
 *
 * @param suiteName - Name of the suite that was executed
 * @param gateId - ID of the gate linked to the suite
 * @param config - Configuration object
 * @param autoConfirm - Skip the confirmation prompt and seal automatically (from `--yes`)
 * @returns The outcome of the seal-creation attempt
 */
async function promptForSeal(
  suiteName: string,
  gateId: string,
  config: AttestItConfig,
  autoConfirm?: boolean,
): Promise<SealAttemptOutcome> {
  log('')
  log(`Suite '${suiteName}' is linked to gate '${gateId}'`)

  // Load local identity config
  const localConfig = loadLocalConfigSync()
  if (!localConfig) {
    warn('No local identity configuration found - cannot create seal')
    warn('Run "attest-it identity create" to set up your identity')
    return 'not-attempted'
  }

  // Get active identity
  const identity = getActiveIdentity(localConfig)
  if (!identity) {
    warn(`Active identity '${localConfig.activeIdentity}' not found in local config`)
    return 'not-attempted'
  }

  // Check if user is authorized to seal this gate. Nothing has been signed or
  // written yet, so refusing here is purely a reporting decision -- but it is
  // the one that matters: reporting success (or even a soft warning) for an
  // unauthorized attempt would tell the caller a seal exists when none was
  // ever created. See issue #136.
  const authorized = isAuthorizedSigner(config, gateId, identity.publicKey)
  if (!authorized) {
    // eslint-disable-next-line security/detect-object-injection -- gateId is from validated config
    const authorizedSigners = config.gates?.[gateId]?.authorizedSigners ?? []
    error(
      `Not authorized to seal gate '${gateId}' ` +
        `(authorized signers: ${authorizedSigners.join(', ') || 'none'}). No seal was created.`,
    )
    return 'unauthorized'
  }

  // Resolve seal confirmation: --yes skips the prompt; interactively without
  // it, the existing confirm prompt runs; non-interactively without it, fail
  // fast rather than hang on a prompt that can never resolve.
  let shouldSeal: boolean
  if (autoConfirm) {
    shouldSeal = true
  } else if (isInteractiveTTY()) {
    shouldSeal = await confirmAction({
      message: `Create seal for gate '${gateId}'`,
      default: true,
    })
  } else {
    throw new Error(
      `Missing required --yes to confirm seal creation for gate '${gateId}' ` +
        '(no interactive terminal available to prompt for it). Pass --yes to run non-interactively.',
    )
  }

  if (!shouldSeal) {
    // The user was explicitly asked and declined -- this is a cancellation,
    // not a skip. Exiting SUCCESS here would let a CI script read a declined
    // seal as a passing attestation. See issue #100.
    log('Cancelled')
    process.exit(ExitCode.CANCELLED)
  }

  try {
    // Get gate config
    if (!config.gates?.[gateId]) {
      error(`Gate '${gateId}' not found in configuration`)
      return 'not-attempted'
    }

    // eslint-disable-next-line security/detect-object-injection
    const gate = config.gates[gateId]
    const identitySlug = localConfig.activeIdentity

    // A pattern gate seals each matched file independently (one per-file seal
    // via the low-level writer), consistent with `attest-it seal`. Without this
    // branch a suite over a `kind: pattern` gate silently produced a single
    // combined seal (issue #130).
    if (isPatternGate(gate)) {
      return await sealPatternGateForRun(gateId, gate, config, identity, identitySlug)
    }

    // Compute fingerprint for the gate
    const gateFingerprint = computeFingerprintSync({
      paths: gate.fingerprint.paths,
      ...(gate.fingerprint.exclude && { exclude: gate.fingerprint.exclude }),
    })

    // Create key provider from identity's private key reference
    const keyProvider = createKeyProviderFromIdentity(identity)
    const keyRef = getKeyRefFromIdentity(identity)

    // Sign the seal via the identity's backend. Delegated-signing backends sign
    // without ever exposing the raw key; the fallback retrieves the PEM and, when
    // it is passphrase-encrypted (e.g. `identity create --passphrase-stdin`),
    // resolves the passphrase from the environment, a prompt, or fails fast
    // (see issue #80).
    const seal = await createSealWithProvider({
      gateId,
      fingerprint: gateFingerprint.fingerprint,
      sealedBy: identitySlug,
      keyProvider,
      keyRef,
      resolvePassphrase: resolveKeyPassphrase,
    })

    // Read existing seals
    const projectRoot = process.cwd()
    const sealsFile = readSealsSync(projectRoot, config.settings.sealsPath)

    // Add seal to seals file
    // eslint-disable-next-line security/detect-object-injection
    sealsFile.seals[gateId] = seal

    // Write seals file
    writeSealsSync(projectRoot, sealsFile, config.settings.sealsPath)

    success(`Seal created for gate '${gateId}'`)
    log(`  Sealed by: ${identitySlug} (${identity.name})`)
    log(`  Timestamp: ${seal.timestamp}`)
    return 'sealed'
  } catch (err) {
    if (err instanceof Error) {
      error(`Failed to create seal: ${err.message}`)
    } else {
      error('Failed to create seal: Unknown error')
    }
    return 'not-attempted'
  }
}

/**
 * Seal every matched file of a **pattern gate** (`kind: pattern`) independently,
 * mirroring `attest-it seal`'s per-file path: each file is fingerprinted on its
 * own and written as a standalone `.seal` via the low-level
 * {@link writeSealFileSync} (never the aggregate writer, which would prune the
 * siblings). Files that already carry a valid per-file seal are left untouched.
 *
 * @returns `'sealed'` when at least one file was (re)sealed or all files were
 *   already valid, `'not-attempted'` when the gate matched no files.
 */
async function sealPatternGateForRun(
  gateId: string,
  gate: GateConfig,
  config: AttestItConfig,
  identity: Identity,
  identitySlug: string,
): Promise<SealAttemptOutcome> {
  const projectRoot = process.cwd()
  const perFile = computePatternFingerprintsSync(gate, projectRoot)
  if (perFile.length === 0) {
    warn(`Pattern gate '${gateId}' matched no files - no seal created`)
    return 'not-attempted'
  }

  const existingSeals = readPatternSealsByArtifactSync(
    projectRoot,
    config.settings.sealsPath,
    gateId,
  )
  const sealsRoot = resolveSealsRoot(projectRoot, config.settings.sealsPath)

  const keyProvider = createKeyProviderFromIdentity(identity)
  const keyRef = getKeyRefFromIdentity(identity)

  let sealedCount = 0
  for (const { path: filePath, fingerprint } of perFile) {
    const existing = existingSeals.get(filePath)
    if (existing) {
      const verification = verifyPatternArtifactSeal(
        config,
        gateId,
        filePath,
        existing,
        fingerprint,
        gate.maxAge,
      )
      if (verification.state === 'VALID') {
        continue
      }
    }

    const seal = await createSealWithProvider({
      gateId,
      fingerprint,
      sealedBy: identitySlug,
      keyProvider,
      keyRef,
      resolvePassphrase: resolveKeyPassphrase,
    })
    const perFileSeal: Seal = { ...seal, artifactPath: filePath }
    writeSealFileSync(sealsRoot, perFileSeal)
    sealedCount++
    log(`  Sealed ${gateId} file: ${filePath}`)
  }

  success(
    `Seal(s) created for pattern gate '${gateId}' (${String(sealedCount)} of ${String(perFile.length)} file(s) resealed)`,
  )
  log(`  Sealed by: ${identitySlug} (${identity.name})`)
  return 'sealed'
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
      // VaultKeeper file backend — id is the VaultKeeper secret ID
      return KeyProviderRegistry.create({ type: 'filesystem', options: {} })
    case 'keychain':
      // VaultKeeper keychain backend — id is the VaultKeeper secret ID
      return KeyProviderRegistry.create({ type: 'macos-keychain', options: {} })
    case '1password':
      // VaultKeeper 1Password backend — id is the VaultKeeper secret ID
      return KeyProviderRegistry.create({ type: '1password', options: {} })
    case 'yubikey':
      // VaultKeeper YubiKey backend — id is the VaultKeeper secret ID
      return KeyProviderRegistry.create({ type: 'yubikey', options: {} })
    case 'filesystem':
      // Legacy filesystem provider — for v1 identities not yet imported into VaultKeeper
      return KeyProviderRegistry.create({
        type: 'filesystem-legacy',
        options: {},
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
 * For v2 VaultKeeper-backed types, the key reference is the secret ID.
 * For the legacy filesystem type, the key reference is the file path.
 *
 * @param identity - The identity containing the private key reference
 * @returns The key reference string
 */
function getKeyRefFromIdentity(identity: Identity): string {
  const { privateKey } = identity

  switch (privateKey.type) {
    case 'file':
      return privateKey.id
    case 'keychain':
      return privateKey.id
    case '1password':
      return privateKey.id
    case 'yubikey':
      return privateKey.id
    case 'filesystem':
      return privateKey.path
    default: {
      const _exhaustiveCheck: never = privateKey
      throw new Error(`Unsupported private key type: ${String(_exhaustiveCheck)}`)
    }
  }
}

// Export for testing
export { buildCommand, parseCommand, executeCommand, checkDirtyWorkingTree }
