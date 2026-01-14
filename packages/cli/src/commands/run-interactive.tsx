/**
 * Entry point for interactive run mode.
 *
 * This module bridges the Commander.js CLI and the React-based interactive UI.
 * It handles:
 * - Loading configuration and suite statuses
 * - Checking for session resumption (--continue)
 * - Dry run mode (just show what would run)
 * - Rendering the InteractiveRun component with ink
 * - Providing test execution and attestation creation callbacks
 *
 * @packageDocumentation
 */

import * as React from 'react'
import { render } from 'ink'
import { spawn } from 'node:child_process'
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
  FilesystemKeyProvider,
  KeyProviderRegistry,
  type Config,
  type KeyProvider,
} from '@attest-it/core'
import { InteractiveRun } from '../components/InteractiveRun.js'
import { getAllSuiteStatuses, type SuiteStatus } from './run-utils.js'
import { loadSession, saveSession as persistSession, clearSession } from '../session/session.js'
import { error, log } from '../utils/output.js'
import { ExitCode } from '../utils/exit-codes.js'

/**
 * Options for interactive mode.
 * @public
 */
export interface InteractiveOptions {
  /** Show what would run without executing */
  dryRun?: boolean | undefined
  /** Resume from saved session */
  continue?: boolean | undefined
  /** Filter pattern for suite names */
  filter?: string | undefined
}

/**
 * Run the interactive mode UI.
 *
 * @param options - Interactive mode options
 * @public
 */
export async function runInteractive(options: InteractiveOptions): Promise<void> {
  // Load config
  const config = await loadConfig()

  // Get all suite statuses
  const allSuites = await getAllSuiteStatuses(config)

  // Check if resuming from session
  let preSelected: string[] | undefined
  if (options.continue) {
    const session = await loadSession()
    if (session && session.remaining.length > 0) {
      preSelected = session.remaining
      log(`Resuming session with ${String(preSelected.length)} remaining suite(s)`)
    }
  }

  // Dry run mode - just show what would run
  if (options.dryRun) {
    handleDryRun(allSuites, config, options.filter)
    return
  }

  // Check for pending suites
  const pendingSuites = allSuites.filter((s) => s.status !== 'VALID')
  if (pendingSuites.length === 0) {
    log('All suites are valid. Nothing to run.')
    process.exit(ExitCode.NO_WORK)
  }

  // Check for dirty working tree
  const isDirty = await checkDirtyWorkingTree()
  if (isDirty) {
    error('Working tree has uncommitted changes. Please commit or stash before attesting.')
    process.exit(ExitCode.CONFIG_ERROR)
  }

  // Create test executor
  const executeTest = createTestExecutor(config)

  // Create attestation creator
  const createAttestationFn = createAttestationCreator(config)

  // Create session saver
  const saveSessionFn = createSessionSaver()

  // Render the interactive UI
  const interactiveRunProps = {
    allSuites,
    config,
    executeTest,
    createAttestation: createAttestationFn,
    saveSession: saveSessionFn,
    ...(preSelected !== undefined && { preSelected }),
  }

  const { waitUntilExit } = render(<InteractiveRun {...interactiveRunProps} />)

  // Wait for UI to exit
  await waitUntilExit()
}

/**
 * Handle dry run mode.
 * Shows what would run without actually executing.
 *
 * @param allSuites - All suite statuses
 * @param config - Configuration object
 * @param filterPattern - Optional filter pattern
 * @internal
 */
function handleDryRun(allSuites: SuiteStatus[], config: Config, filterPattern?: string): void {
  let pendingSuites = allSuites.filter((s) => s.status !== 'VALID')

  if (filterPattern) {
    const regex = new RegExp('^' + filterPattern.replace(/\*/g, '.*') + '$', 'i')
    pendingSuites = pendingSuites.filter((s) => regex.test(s.name))
  }

  if (pendingSuites.length === 0) {
    log('No suites would run (all valid or filtered out).')
    process.exit(ExitCode.NO_WORK)
  }

  log(`Would run ${String(pendingSuites.length)} suite(s):`)
  pendingSuites.forEach((s, i) => {
    log(`  ${String(i + 1)}. ${s.name} (${s.status})`)
  })
  log('')
  log('Use `attest-it run` to execute.')
  process.exit(ExitCode.SUCCESS)
}

/**
 * Create a test executor function for a suite.
 *
 * @param config - Configuration object
 * @returns Function that executes a suite's test command
 * @internal
 */
function createTestExecutor(config: Config): (suite: string) => Promise<boolean> {
  return async (suiteName: string): Promise<boolean> => {
    // eslint-disable-next-line security/detect-object-injection -- Safe access with validated suite name
    const suiteConfig = config.suites[suiteName]
    if (!suiteConfig) {
      error(`Suite "${suiteName}" not found in config`)
      return false
    }

    // Build command
    let command = suiteConfig.command ?? config.settings.defaultCommand
    if (!command) {
      error(`No command specified for suite "${suiteName}"`)
      return false
    }

    // Substitute ${files} if present
    if (command.includes('${files}') && suiteConfig.files) {
      command = command.replaceAll('${files}', suiteConfig.files.join(' '))
    }

    log(`Running: ${command}`)

    // Execute command
    const exitCode = await executeCommand(command)
    return exitCode === 0
  }
}

/**
 * Create an attestation creator function.
 *
 * @param config - Configuration object
 * @returns Function that creates and saves an attestation for a suite
 * @internal
 */
function createAttestationCreator(config: Config): (suite: string) => Promise<void> {
  return async (suiteName: string): Promise<void> => {
    // eslint-disable-next-line security/detect-object-injection -- Safe access with validated suite name
    const suiteConfig = config.suites[suiteName]
    if (!suiteConfig) {
      throw new Error(`Suite "${suiteName}" not found`)
    }

    // Compute fingerprint
    const fingerprintResult = await computeFingerprint({
      packages: suiteConfig.packages,
      ...(suiteConfig.ignore && { ignore: suiteConfig.ignore }),
    })

    // Create attestation
    const attestation = createAttestation({
      suite: suiteName,
      fingerprint: fingerprintResult.fingerprint,
      command: suiteConfig.command ?? config.settings.defaultCommand ?? '',
      attestedBy: os.userInfo().username,
    })

    // Load existing attestations
    const attestationsPath = config.settings.attestationsPath
    const existingFile = await readAttestations(attestationsPath).catch(() => null)
    const existingAttestations = existingFile?.attestations ?? []

    // Upsert the new attestation
    const newAttestations = upsertAttestation(existingAttestations, attestation)

    // Set up key provider from config or use default
    let keyProvider: KeyProvider
    let keyRef: string

    if (config.settings.keyProvider) {
      keyProvider = KeyProviderRegistry.create(config.settings.keyProvider)
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
      const providerName = keyProvider.displayName
      const keygenMessage =
        keyProvider.type === 'filesystem'
          ? 'Run "attest-it keygen" first to generate a keypair.'
          : 'Run "attest-it keygen" to generate and store a key.'
      throw new Error(`Private key not found in ${providerName}. ${keygenMessage}`)
    }

    // Write signed attestations
    await writeSignedAttestations({
      filePath: attestationsPath,
      attestations: newAttestations,
      keyProvider,
      keyRef,
    })

    log(`✓ Attestation created for ${suiteName}`)
  }
}

/**
 * Create session saver function.
 *
 * @returns Function that saves or clears session state
 * @internal
 */
function createSessionSaver(): (
  completed: string[],
  failed: string[],
  remaining: string[],
) => Promise<void> {
  return async (completed: string[], failed: string[], remaining: string[]): Promise<void> => {
    if (completed.length === 0 && failed.length === 0 && remaining.length === 0) {
      // All done - clear session
      await clearSession()
    } else {
      // Save session for --continue
      await persistSession({
        started: new Date().toISOString(),
        selected: [...completed, ...failed, ...remaining],
        completed,
        failed,
        remaining,
      })
    }
  }
}

/**
 * Execute a shell command and return exit code.
 *
 * @param command - Shell command to execute
 * @returns Promise resolving to exit code
 * @internal
 */
async function executeCommand(command: string): Promise<number> {
  return new Promise((resolve) => {
    const parsed = parseShellCommand(command)
    const stringArgs = parsed.filter((t): t is string => typeof t === 'string')

    if (stringArgs.length === 0) {
      error('Empty command')
      resolve(1)
      return
    }

    const [executable, ...args] = stringArgs
    if (!executable) {
      resolve(1)
      return
    }

    const child = spawn(executable, args, { stdio: 'inherit' })

    child.on('close', (code) => {
      resolve(code ?? 1)
    })
    child.on('error', (err) => {
      error(`Command failed: ${err.message}`)
      resolve(1)
    })
  })
}

/**
 * Check for uncommitted changes in the working tree.
 *
 * @returns Promise resolving to true if there are uncommitted changes
 * @internal
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
      resolve(output.trim().length > 0)
    })
    child.on('error', () => {
      resolve(false)
    })
  })
}
