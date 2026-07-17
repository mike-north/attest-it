/**
 * Seal command implementation for attest-it CLI.
 * Creates cryptographic seals for gates.
 */

import { Command } from 'commander'
import {
  loadSplitConfig,
  loadLocalConfigSync,
  getActiveIdentity,
  computeFingerprintSync,
  isAuthorizedSigner,
  getGate,
  createSeal,
  readSealsSync,
  writeSealsSync,
  verifyGateSeal,
  isEncryptedPrivateKeyPem,
  KeyProviderRegistry,
  API_SCHEMA_VERSION,
  type AttestItConfig,
  type FailureClass,
  type Identity,
  type Seal,
  type SealsFile,
} from '@attest-it/core'
import { log, success, error, warn, verbose, outputJson } from '../utils/output.js'
import { ExitCode } from '../utils/exit-codes.js'
import { resolveKeyPassphrase } from '../utils/passphrase.js'

export const sealCommand = new Command('seal')
  .description('Create seals for gates')
  .argument('[gates...]', 'Gate IDs to seal (defaults to all gates without valid seals)')
  .option('--force', 'Force seal creation even if gate already has a valid seal')
  .option('--dry-run', 'Show what would be sealed without creating seals')
  .option('--json', 'Output JSON for machine parsing (non-interactive)')
  .action(async (gates: string[], options: SealOptions) => {
    await runSeal(gates, options)
  })

interface SealOptions {
  force?: boolean
  dryRun?: boolean
  json?: boolean
}

interface SealSummary {
  sealed: { gate: string; fingerprint: string; sealedBy: string; sealedAt: string }[]
  skipped: {
    gate: string
    reason: string
    failureClass?: FailureClass
  }[]
  failed: {
    gate: string
    error: string
  }[]
}

/**
 * Emit a top-level error, either as a structured JSON object (`--json`) or as a
 * human-readable line, then exit with the given code. Used for the early-exit
 * configuration/identity error paths so the `--json` surface never prints
 * unstructured text.
 */
function failFast(message: string, code: number, json: boolean | undefined): never {
  if (json) {
    outputJson({ schemaVersion: API_SCHEMA_VERSION, ok: false, error: message })
  } else {
    error(message)
  }
  process.exit(code)
}

/**
 * Run the seal command to create seals for gates.
 *
 * @param gates - Array of gate IDs to seal, or empty for all gates
 * @param options - Command options
 * @public
 */
async function runSeal(gates: string[], options: SealOptions): Promise<void> {
  const json = options.json
  try {
    // Load split config (policy + operational, merged)
    const config = await loadSplitConfig()

    // Check if gates are defined
    if (!config.gates || Object.keys(config.gates).length === 0) {
      failFast('No gates defined in configuration', ExitCode.CONFIG_ERROR, json)
    }

    // Load local identity config
    const localConfig = loadLocalConfigSync()
    if (!localConfig) {
      failFast(
        'No local identity configuration found. Run "attest-it identity create" first to set up your identity',
        ExitCode.CONFIG_ERROR,
        json,
      )
    }

    // Get active identity
    const identity = getActiveIdentity(localConfig)
    if (!identity) {
      failFast(
        `Active identity '${localConfig.activeIdentity}' not found in local config`,
        ExitCode.CONFIG_ERROR,
        json,
      )
    }

    // Read existing seals
    const projectRoot = process.cwd()
    const sealsFile = readSealsSync(projectRoot, config.settings.sealsPath)

    // Determine which gates to seal
    const gatesToSeal = gates.length > 0 ? gates : getAllGateIds(config)

    // Validate that specified gates exist
    for (const gateId of gatesToSeal) {
      if (!config.gates[gateId]) {
        failFast(`Gate '${gateId}' not found in configuration`, ExitCode.CONFIG_ERROR, json)
      }
    }

    // Process each gate
    const summary: SealSummary = {
      sealed: [],
      skipped: [],
      failed: [],
    }

    // Get the identity slug for sealedBy field
    const identitySlug = localConfig.activeIdentity

    for (const gateId of gatesToSeal) {
      try {
        const result = await processSingleGate(
          gateId,
          config,
          identity,
          identitySlug,
          sealsFile,
          options,
        )

        if (result.sealed && result.seal) {
          summary.sealed.push({
            gate: gateId,
            fingerprint: result.seal.fingerprint,
            sealedBy: result.seal.sealedBy,
            sealedAt: result.seal.timestamp,
          })
        } else if (result.sealed) {
          // Dry-run: report intent without a concrete seal.
          summary.sealed.push({
            gate: gateId,
            fingerprint: '',
            sealedBy: identitySlug,
            sealedAt: '',
          })
        } else if (result.skipped) {
          summary.skipped.push({
            gate: gateId,
            reason: result.reason ?? 'Unknown',
            ...(result.failureClass && { failureClass: result.failureClass }),
          })
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error'
        summary.failed.push({ gate: gateId, error: errorMsg })
      }
    }

    // Write seals file if not dry run and we sealed anything
    if (!options.dryRun && summary.sealed.length > 0) {
      writeSealsSync(projectRoot, sealsFile, config.settings.sealsPath)
    }

    // Output summary
    if (json) {
      outputJson({
        schemaVersion: API_SCHEMA_VERSION,
        ok: summary.failed.length === 0,
        dryRun: options.dryRun ?? false,
        ...summary,
      })
    } else {
      displaySummary(summary, options.dryRun)
    }

    // Exit with appropriate code
    if (summary.failed.length > 0) {
      process.exit(ExitCode.FAILURE)
    } else if (summary.sealed.length === 0 && summary.skipped.length === 0) {
      process.exit(ExitCode.NO_WORK)
    } else {
      process.exit(ExitCode.SUCCESS)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error occurred'
    failFast(message, ExitCode.CONFIG_ERROR, json)
  }
}

interface ProcessGateResult {
  sealed: boolean
  skipped: boolean
  reason?: string
  /** Taxonomy class for a skip that maps to a failure taxonomy state. */
  failureClass?: FailureClass
  /** The created seal, when one was created (absent for dry-run/skip). */
  seal?: Seal
}

/**
 * Process a single gate for sealing.
 *
 * @param gateId - Gate identifier
 * @param config - The attest-it configuration
 * @param identity - Active identity for signing
 * @param identitySlug - The identity slug (used for sealedBy field)
 * @param sealsFile - The seals file to update
 * @param options - Command options
 * @returns Result indicating whether gate was sealed or skipped
 */
async function processSingleGate(
  gateId: string,
  config: AttestItConfig,
  identity: Identity,
  identitySlug: string,
  sealsFile: SealsFile,
  options: SealOptions,
): Promise<ProcessGateResult> {
  if (!options.json) {
    verbose(`Processing gate: ${gateId}`)
  }

  // Get gate config
  const gate = getGate(config, gateId)
  if (!gate) {
    return { sealed: false, skipped: true, reason: 'Gate not found in configuration' }
  }

  // Compute current fingerprint (needed both for seal creation and validity check)
  const fingerprintResult = computeFingerprintSync({
    paths: gate.fingerprint.paths,
    ...(gate.fingerprint.exclude && { exclude: gate.fingerprint.exclude }),
  })
  if (!options.json) {
    verbose(`  Fingerprint: ${fingerprintResult.fingerprint}`)
  }

  // Check if gate already has a valid seal (full verification, not just existence)
  // and --force not specified
  // eslint-disable-next-line security/detect-object-injection
  const existingSeal = sealsFile.seals[gateId]
  if (existingSeal && !options.force) {
    const verification = verifyGateSeal(config, gateId, sealsFile, fingerprintResult.fingerprint)
    if (verification.state === 'VALID') {
      return {
        sealed: false,
        skipped: true,
        reason: 'Gate already has a valid seal (use --force to override)',
      }
    }
    if (!options.json) {
      verbose(`  Existing seal is invalid (${verification.state}), replacing`)
    }
  }

  // Check if user is authorized to seal this gate
  const authorized = isAuthorizedSigner(config, gateId, identity.publicKey)
  if (!authorized) {
    return {
      sealed: false,
      skipped: true,
      reason: `Not authorized to seal this gate (authorized signers: ${gate.authorizedSigners.join(', ')})`,
      failureClass: 'unauthorized-signer',
    }
  }

  // If dry-run, stop here
  if (options.dryRun) {
    if (!options.json) {
      log(`  Would seal gate: ${gateId}`)
    }
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

  // A file-backed key created with `identity create --passphrase-stdin` is
  // encrypted; resolve the passphrase needed to sign with it from the
  // environment, an interactive prompt, or fail fast. Shared with `run`'s
  // seal-creation path -- see issue #94.
  const passphrase = isEncryptedPrivateKeyPem(privateKeyPem)
    ? await resolveKeyPassphrase()
    : undefined

  // Create seal using identity slug (not display name) for verification lookup
  const seal = createSeal({
    gateId,
    fingerprint: fingerprintResult.fingerprint,
    sealedBy: identitySlug,
    privateKey: privateKeyPem,
    ...(passphrase !== undefined && { passphrase }),
  })

  // Add seal to seals file
  // eslint-disable-next-line security/detect-object-injection
  sealsFile.seals[gateId] = seal

  if (!options.json) {
    log(`  Sealed gate: ${gateId}`)
    verbose(`    Sealed by: ${identitySlug} (${identity.name})`)
    verbose(`    Timestamp: ${seal.timestamp}`)
  }

  return { sealed: true, skipped: false, seal }
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
    const gateNames = summary.sealed.map((s) => s.gate).join(', ')
    success(`${prefix} ${String(summary.sealed.length)} gate(s): ${gateNames}`)
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

export { runSeal }
