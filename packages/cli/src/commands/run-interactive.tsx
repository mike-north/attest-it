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
import { parse as parseShellCommand } from 'shell-quote'
import {
  loadConfig,
  toAttestItConfig,
  computeFingerprintSync,
  KeyProviderRegistry,
  loadLocalConfigSync,
  getActiveIdentity,
  getIdentityConfigDir,
  isAuthorizedSigner,
  createSeal,
  readSealsSync,
  writeSealsSync,
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
  /** Override the attest-it home directory for identity config */
  homeDir?: string | undefined
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

  // Check for dirty working tree (skip if ATTEST_IT_ALLOW_DIRTY is set - for dogfooding)
  if (!process.env.ATTEST_IT_ALLOW_DIRTY) {
    const isDirty = await checkDirtyWorkingTree()
    if (isDirty) {
      error('Working tree has uncommitted changes. Please commit or stash before attesting.')
      process.exit(ExitCode.CONFIG_ERROR)
    }
  }

  // Create test executor
  const executeTest = createTestExecutor(config)

  // Create attestation creator (pass homeDir for identity config override)
  const createAttestationFn = createAttestationCreator(config, options.homeDir)

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
    const command = suiteConfig.command ?? config.settings.defaultCommand
    if (!command) {
      error(`No command specified for suite "${suiteName}"`)
      return false
    }

    log(`Running: ${command}`)

    // Small delay to allow React to process isExecuting state change
    // This ensures the TUI is hidden before child process starts writing
    await new Promise((resolve) => setTimeout(resolve, 50))

    // Execute command
    const exitCode = await executeCommand(command)
    return exitCode === 0
  }
}

/**
 * Create an attestation creator function.
 *
 * @param config - Configuration object
 * @param homeDir - Optional override for the attest-it home directory
 * @returns Function that creates and saves an attestation for a suite
 * @internal
 */
function createAttestationCreator(
  config: Config,
  homeDir: string = getIdentityConfigDir(),
): (suite: string) => Promise<void> {
  return async (suiteName: string): Promise<void> => {
    // eslint-disable-next-line security/detect-object-injection -- Safe access with validated suite name
    const suiteConfig = config.suites[suiteName]
    if (!suiteConfig) {
      throw new Error(`Suite "${suiteName}" not found`)
    }

    if (!suiteConfig.gate || !config.gates) {
      throw new Error(`Suite "${suiteName}" must have a gate defined`)
    }

    await createSealForGate(suiteName, suiteConfig.gate, config, homeDir)
  }
}

/**
 * Create a seal for a gate after successful suite execution.
 *
 * @param suiteName - Name of the suite that was executed
 * @param gateId - ID of the gate linked to the suite
 * @param config - Configuration object
 * @param homeDir - Optional override for the attest-it home directory
 * @internal
 */
async function createSealForGate(
  suiteName: string,
  gateId: string,
  config: Config,
  homeDir: string = getIdentityConfigDir(),
): Promise<void> {
  log('')
  log(`Suite '${suiteName}' is linked to gate '${gateId}'`)

  // Load local identity config
  const localConfig = loadLocalConfigSync(`${homeDir}/config.yaml`)
  if (!localConfig) {
    throw new Error(
      'No local identity configuration found. Run "attest-it identity create" to set up your identity.',
    )
  }

  // Get active identity
  const identity = getActiveIdentity(localConfig)
  if (!identity) {
    throw new Error(`Active identity '${localConfig.activeIdentity}' not found in local config`)
  }

  // Convert to AttestItConfig for authorization check
  const attestItConfig = toAttestItConfig(config)

  // Check if user is authorized to seal this gate
  const authorized = isAuthorizedSigner(attestItConfig, gateId, identity.publicKey)
  if (!authorized) {
    throw new Error(
      `You are not authorized to seal gate '${gateId}'. ` +
        `Your public key is not in the gate's authorizedSigners list.`,
    )
  }

  // Note: No confirmation prompt here - TestRunner already confirmed with user
  // via its "Create attestation? [Y/n]" prompt before calling this function

  // Get gate config for fingerprint
  // eslint-disable-next-line security/detect-object-injection -- gate name from validated config
  const gateConfig = config.gates?.[gateId]
  if (!gateConfig) {
    throw new Error(`Gate '${gateId}' not found in configuration`)
  }

  // Compute fingerprint for the gate
  const fingerprintResult = computeFingerprintSync({
    packages: gateConfig.fingerprint.paths,
    ...(gateConfig.fingerprint.exclude && { ignore: gateConfig.fingerprint.exclude }),
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
    fingerprint: fingerprintResult.fingerprint,
    sealedBy: identitySlug,
    privateKey: privateKeyPem,
  })

  // Read existing seals
  const projectRoot = process.cwd()
  const sealsFile = readSealsSync(projectRoot, attestItConfig.settings.sealsPath)

  // Add seal to seals file
  // eslint-disable-next-line security/detect-object-injection -- gate name from validated config
  sealsFile.seals[gateId] = seal

  // Write seals file
  writeSealsSync(projectRoot, sealsFile, attestItConfig.settings.sealsPath)

  log(`✓ Seal created for gate '${gateId}'`)
  log(`  Sealed by: ${identitySlug} (${identity.name})`)
  log(`  Timestamp: ${seal.timestamp}`)
}

/**
 * Create a key provider from an identity's private key reference.
 *
 * @param identity - The identity containing the private key reference
 * @returns A key provider instance
 * @internal
 */
function createKeyProviderFromIdentity(
  identity: ReturnType<typeof getActiveIdentity>,
): KeyProvider {
  if (!identity) {
    throw new Error('Identity is required')
  }
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
          itemName: privateKey.service,
        },
      })
    case '1password':
      return KeyProviderRegistry.create({
        type: '1password',
        options: {
          accountUuid: privateKey.account,
          vault: privateKey.vault,
          itemName: privateKey.item,
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
 * @internal
 */
function getKeyRefFromIdentity(identity: ReturnType<typeof getActiveIdentity>): string {
  if (!identity) {
    throw new Error('Identity is required')
  }
  const { privateKey } = identity

  switch (privateKey.type) {
    case 'file':
      return privateKey.path
    case 'keychain':
      return privateKey.service
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
