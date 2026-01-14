/**
 * Seal command implementation for attest-it CLI.
 * Creates cryptographic seals for gates.
 */

import { Command } from 'commander'
import {
  loadConfig,
  toAttestItConfig,
  loadLocalConfigSync,
  getActiveIdentity,
  computeFingerprintSync,
  isAuthorizedSigner,
  getGate,
  createSeal,
  readSealsSync,
  writeSealsSync,
  KeyProviderRegistry,
  type AttestItConfig,
  type Identity,
  type SealsFile,
} from '@attest-it/core'
import { log, success, error, warn, verbose } from '../utils/output.js'
import { ExitCode } from '../utils/exit-codes.js'

export const sealCommand = new Command('seal')
  .description('Create seals for gates')
  .argument('[gates...]', 'Gate IDs to seal (defaults to all gates without valid seals)')
  .option('--force', 'Force seal creation even if gate already has a valid seal')
  .option('--dry-run', 'Show what would be sealed without creating seals')
  .action(async (gates: string[], options: SealOptions) => {
    await runSeal(gates, options)
  })

interface SealOptions {
  force?: boolean
  dryRun?: boolean
}

interface SealSummary {
  sealed: string[]
  skipped: {
    gate: string
    reason: string
  }[]
  failed: {
    gate: string
    error: string
  }[]
}

/**
 * Run the seal command to create seals for gates.
 *
 * @param gates - Array of gate IDs to seal, or empty for all gates
 * @param options - Command options
 * @public
 */
async function runSeal(gates: string[], options: SealOptions): Promise<void> {
  try {
    // Load project config
    const config = await loadConfig()
    const attestItConfig = toAttestItConfig(config)

    // Check if gates are defined
    if (!attestItConfig.gates || Object.keys(attestItConfig.gates).length === 0) {
      error('No gates defined in configuration')
      process.exit(ExitCode.CONFIG_ERROR)
    }

    // Load local identity config
    const localConfig = loadLocalConfigSync()
    if (!localConfig) {
      error('No local identity configuration found')
      error('Run "attest-it keygen" first to set up your identity')
      process.exit(ExitCode.CONFIG_ERROR)
    }

    // Get active identity
    const identity = getActiveIdentity(localConfig)
    if (!identity) {
      error(`Active identity '${localConfig.activeIdentity}' not found in local config`)
      process.exit(ExitCode.CONFIG_ERROR)
    }

    // Read existing seals
    const projectRoot = process.cwd()
    const sealsFile = readSealsSync(projectRoot)

    // Determine which gates to seal
    const gatesToSeal = gates.length > 0 ? gates : getAllGateIds(attestItConfig)

    // Validate that specified gates exist
    for (const gateId of gatesToSeal) {
      if (!attestItConfig.gates[gateId]) {
        error(`Gate '${gateId}' not found in configuration`)
        process.exit(ExitCode.CONFIG_ERROR)
      }
    }

    // Process each gate
    const summary: SealSummary = {
      sealed: [],
      skipped: [],
      failed: [],
    }

    for (const gateId of gatesToSeal) {
      try {
        const result = await processSingleGate(gateId, attestItConfig, identity, sealsFile, options)

        if (result.sealed) {
          summary.sealed.push(gateId)
        } else if (result.skipped) {
          summary.skipped.push({ gate: gateId, reason: result.reason ?? 'Unknown' })
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error'
        summary.failed.push({ gate: gateId, error: errorMsg })
      }
    }

    // Write seals file if not dry run and we sealed anything
    if (!options.dryRun && summary.sealed.length > 0) {
      writeSealsSync(projectRoot, sealsFile)
    }

    // Display summary
    displaySummary(summary, options.dryRun)

    // Exit with appropriate code
    if (summary.failed.length > 0) {
      process.exit(ExitCode.FAILURE)
    } else if (summary.sealed.length === 0 && summary.skipped.length === 0) {
      process.exit(ExitCode.NO_WORK)
    } else {
      process.exit(ExitCode.SUCCESS)
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

interface ProcessGateResult {
  sealed: boolean
  skipped: boolean
  reason?: string
}

/**
 * Process a single gate for sealing.
 *
 * @param gateId - Gate identifier
 * @param config - The attest-it configuration
 * @param identity - Active identity for signing
 * @param sealsFile - The seals file to update
 * @param options - Command options
 * @returns Result indicating whether gate was sealed or skipped
 */
async function processSingleGate(
  gateId: string,
  config: AttestItConfig,
  identity: Identity,
  sealsFile: SealsFile,
  options: SealOptions,
): Promise<ProcessGateResult> {
  verbose(`Processing gate: ${gateId}`)

  // Get gate config
  const gate = getGate(config, gateId)
  if (!gate) {
    return { sealed: false, skipped: true, reason: 'Gate not found in configuration' }
  }

  // Check if gate already has a valid seal and --force not specified
  // eslint-disable-next-line security/detect-object-injection
  const existingSeal = sealsFile.seals[gateId]
  if (existingSeal && !options.force) {
    return {
      sealed: false,
      skipped: true,
      reason: 'Gate already has a seal (use --force to override)',
    }
  }

  // Compute current fingerprint
  const fingerprintResult = computeFingerprintSync({
    packages: gate.fingerprint.paths,
    ...(gate.fingerprint.exclude && { ignore: gate.fingerprint.exclude }),
  })
  verbose(`  Fingerprint: ${fingerprintResult.fingerprint}`)

  // Check if user is authorized to seal this gate
  const authorized = isAuthorizedSigner(config, gateId, identity.publicKey)
  if (!authorized) {
    return {
      sealed: false,
      skipped: true,
      reason: `Not authorized to seal this gate (authorized signers: ${gate.authorizedSigners.join(', ')})`,
    }
  }

  // If dry-run, stop here
  if (options.dryRun) {
    log(`  Would seal gate: ${gateId}`)
    return { sealed: true, skipped: false }
  }

  // Create key provider from identity's private key reference
  const keyProvider = createKeyProviderFromIdentity(identity)

  // Get private key from provider
  const keyRef = getKeyRefFromIdentity(identity)
  const keyResult = await keyProvider.getPrivateKey(keyRef)

  // Read the key file content
  const fs = await import('node:fs/promises')
  const privateKeyPem = await fs.readFile(keyResult.keyPath, 'utf8')

  // Clean up after reading
  await keyResult.cleanup()

  // Create seal
  const seal = createSeal({
    gateId,
    fingerprint: fingerprintResult.fingerprint,
    sealedBy: identity.name,
    privateKey: privateKeyPem,
  })

  // Add seal to seals file
  // eslint-disable-next-line security/detect-object-injection
  sealsFile.seals[gateId] = seal

  log(`  Sealed gate: ${gateId}`)
  verbose(`    Sealed by: ${identity.name}`)
  verbose(`    Timestamp: ${seal.timestamp}`)

  return { sealed: true, skipped: false }
}

/**
 * Get all gate IDs from configuration.
 *
 * @param config - The attest-it configuration
 * @returns Array of gate IDs
 */
function getAllGateIds(config: AttestItConfig): string[] {
  return Object.keys(config.gates ?? {})
}

/**
 * Display summary of seal operations.
 *
 * @param summary - Summary of operations
 * @param dryRun - Whether this was a dry run
 */
function displaySummary(summary: SealSummary, dryRun?: boolean): void {
  log('')

  const prefix = dryRun ? 'Would seal' : 'Sealed'

  if (summary.sealed.length > 0) {
    success(`${prefix} ${String(summary.sealed.length)} gate(s): ${summary.sealed.join(', ')}`)
  }

  if (summary.skipped.length > 0) {
    log('')
    warn(`Skipped ${String(summary.skipped.length)} gate(s):`)
    for (const skip of summary.skipped) {
      log(`  ${skip.gate}: ${skip.reason}`)
    }
  }

  if (summary.failed.length > 0) {
    log('')
    error(`Failed to seal ${String(summary.failed.length)} gate(s):`)
    for (const fail of summary.failed) {
      log(`  ${fail.gate}: ${fail.error}`)
    }
  }

  if (summary.sealed.length === 0 && summary.skipped.length === 0 && summary.failed.length === 0) {
    log('No gates to seal')
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
      // MacOSKeychainKeyProvider uses 'itemName' which becomes the service name
      // The account is hardcoded to 'attest-it' in the provider
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
          account: privateKey.account,
          vault: privateKey.vault,
          itemName: privateKey.item,
          field: privateKey.field,
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
      // The provider uses the service name as the keyRef
      // Account is hardcoded to 'attest-it' in MacOSKeychainKeyProvider
      return privateKey.service
    case '1password':
      return privateKey.item
    default: {
      const _exhaustiveCheck: never = privateKey
      throw new Error(`Unsupported private key type: ${String(_exhaustiveCheck)}`)
    }
  }
}
