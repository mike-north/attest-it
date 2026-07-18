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
  computePolicyFingerprintSync,
  findPolicyPath,
  isAuthorizedSigner,
  getGate,
  createSealWithProvider,
  readSealsSync,
  writeSealsSync,
  writeSealFileSync,
  resolveSealsRoot,
  verifyGateSeal,
  verifyPatternArtifactSeal,
  KeyProviderRegistry,
  ROOT_GATE_ID,
  API_SCHEMA_VERSION,
  type AttestItConfig,
  type FailureClass,
  type GateConfig,
  type Identity,
  type Seal,
  type SealsFile,
} from '@attest-it/core'
import {
  isPatternGate,
  computePatternFingerprintsSync,
  readPatternSealsByArtifactSync,
} from '../utils/pattern-gate.js'
import { log, success, error, warn, verbose, outputJson } from '../utils/output.js'
import { ExitCode } from '../utils/exit-codes.js'
import { resolveKeyPassphrase } from '../utils/passphrase.js'
import { createRootSealForIdentity } from '../utils/identity-key.js'

export const sealCommand = new Command('seal')
  .description('Create seals for gates')
  .argument('[gates...]', 'Gate IDs to seal (defaults to all gates without valid seals)')
  .option('--force', 'Force seal creation even if gate already has a valid seal')
  .option('--root', 'Seal the reserved root gate over .attest-it/policy.yaml (root signers only)')
  .option('--dry-run', 'Show what would be sealed without creating seals')
  .option('--json', 'Output JSON for machine parsing (non-interactive)')
  .action(async (gates: string[], options: SealOptions) => {
    if (options.root) {
      await runSealRoot(options)
      return
    }
    await runSeal(gates, options)
  })

interface SealOptions {
  force?: boolean
  root?: boolean
  dryRun?: boolean
  json?: boolean
}

interface SealSummary {
  sealed: {
    gate: string
    /** Set for a pattern gate's per-file seal (the matched file it covers). */
    artifactPath?: string
    fingerprint: string
    sealedBy: string
    sealedAt: string
  }[]
  skipped: {
    gate: string
    artifactPath?: string
    reason: string
    failureClass?: FailureClass
  }[]
  failed: {
    gate: string
    artifactPath?: string
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

    // Track whether any aggregate (single-gate) seal was added, so we only
    // rewrite the aggregate seals when it actually changed. Pattern-gate per-file
    // seals are written directly through the low-level writer and never enter the
    // aggregate, so they must not force an aggregate rewrite.
    let aggregateSealsAdded = false

    for (const gateId of gatesToSeal) {
      // eslint-disable-next-line security/detect-object-injection -- gateId validated against config.gates above
      const gateForKind = config.gates[gateId]
      if (gateForKind && isPatternGate(gateForKind)) {
        try {
          await processPatternGate(
            gateId,
            gateForKind,
            config,
            identity,
            identitySlug,
            options,
            summary,
          )
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : 'Unknown error'
          summary.failed.push({ gate: gateId, error: errorMsg })
        }
        continue
      }

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
          aggregateSealsAdded = true
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

    // Persist the aggregate seals only when a single-gate seal actually changed
    // it. Pattern-gate per-file seals were already written directly through the
    // low-level per-file writer inside processPatternGate — routing them through
    // the aggregate writeSeals would prune the sibling per-file seals.
    if (!options.dryRun && aggregateSealsAdded) {
      writeSealsSync(projectRoot, sealsFile, config.settings.sealsPath)
    }

    // An unauthorized-signer attempt must never be reported as success: no seal
    // was written for that gate, so `ok`/the exit code must reflect a hard
    // failure rather than the generic "skipped" bucket (which also holds
    // benign, non-failing skips like "already has a valid seal"). See #136.
    const hasUnauthorizedSkip = summary.skipped.some(
      (skip) => skip.failureClass === 'unauthorized-signer',
    )

    // Output summary
    if (json) {
      outputJson({
        schemaVersion: API_SCHEMA_VERSION,
        ok: summary.failed.length === 0 && !hasUnauthorizedSkip,
        dryRun: options.dryRun ?? false,
        ...summary,
      })
    } else {
      displaySummary(summary, options.dryRun)
    }

    // Exit with appropriate code
    if (summary.failed.length > 0 || hasUnauthorizedSkip) {
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

/**
 * Seal the reserved root gate over `.attest-it/policy.yaml`.
 *
 * The root seal anchors the trust chain: it authorizes the CURRENT content of
 * the policy file (team & gate authorization data). Only a team member listed in
 * `rootGate.authorizedSigners` may create it — which is exactly what prevents a
 * branch from bootstrapping a new root of trust for itself (changing the root
 * signers requires a seal from an existing root signer).
 *
 * @param options - Command options (only `--json` and `--dry-run` apply here).
 * @public
 */
async function runSealRoot(options: SealOptions): Promise<void> {
  const json = options.json
  try {
    const config = await loadSplitConfig()

    if (!config.rootGate) {
      failFast(
        'No rootGate defined in .attest-it/policy.yaml. Run the "attest-it init" bootstrap ' +
          'ceremony to establish a root signer before sealing the root gate.',
        ExitCode.CONFIG_ERROR,
        json,
      )
    }

    const localConfig = loadLocalConfigSync()
    if (!localConfig) {
      failFast(
        'No local identity configuration found. Run "attest-it identity create" first.',
        ExitCode.CONFIG_ERROR,
        json,
      )
    }

    const identity = getActiveIdentity(localConfig)
    if (!identity) {
      failFast(
        `Active identity '${localConfig.activeIdentity}' not found in local config`,
        ExitCode.CONFIG_ERROR,
        json,
      )
    }

    const identitySlug = localConfig.activeIdentity

    // Only an authorized root signer may seal the root gate.
    if (!config.rootGate.authorizedSigners.includes(identitySlug)) {
      failFast(
        `Active identity '${identitySlug}' is not an authorized root signer ` +
          `(authorized: ${config.rootGate.authorizedSigners.join(', ')}). ` +
          'A branch cannot bootstrap a new root of trust for itself.',
        ExitCode.FAILURE,
        json,
      )
    }

    const projectRoot = process.cwd()
    const policyPath = findPolicyPath(projectRoot)
    if (!policyPath) {
      failFast('Policy file not found under .attest-it/', ExitCode.CONFIG_ERROR, json)
    }

    const policyFingerprint = computePolicyFingerprintSync(projectRoot, policyPath)

    if (options.dryRun) {
      if (json) {
        outputJson({
          schemaVersion: API_SCHEMA_VERSION,
          ok: true,
          dryRun: true,
          root: { fingerprint: policyFingerprint, sealedBy: identitySlug },
        })
      } else {
        log(`Would seal root gate over ${policyPath}`)
        log(`  Fingerprint: ${policyFingerprint}`)
        log(`  Sealed by: ${identitySlug}`)
      }
      process.exit(ExitCode.SUCCESS)
    }

    const seal = await createRootSealForIdentity(identity, policyFingerprint, identitySlug)

    const sealsFile = readSealsSync(projectRoot, config.settings.sealsPath)
    // eslint-disable-next-line security/detect-object-injection -- ROOT_GATE_ID is a fixed reserved constant
    sealsFile.seals[ROOT_GATE_ID] = seal
    writeSealsSync(projectRoot, sealsFile, config.settings.sealsPath)

    if (json) {
      outputJson({
        schemaVersion: API_SCHEMA_VERSION,
        ok: true,
        dryRun: false,
        root: {
          fingerprint: seal.fingerprint,
          sealedBy: seal.sealedBy,
          sealedAt: seal.timestamp,
        },
      })
    } else {
      success('Root gate sealed over .attest-it/policy.yaml')
      log(`  Sealed by: ${identitySlug} (${identity.name})`)
      log(`  Fingerprint: ${seal.fingerprint}`)
      log(`  Timestamp: ${seal.timestamp}`)
    }
    process.exit(ExitCode.SUCCESS)
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
  const keyRef = getKeyRefFromIdentity(identity)

  // Sign the seal via the identity's backend. Delegated-signing backends sign
  // without ever exposing the raw key; the fallback retrieves the PEM and, when
  // it is passphrase-encrypted (e.g. `identity create --passphrase-stdin`),
  // resolves the passphrase from the environment, a prompt, or fails fast
  // (shared with `run`'s seal-creation path -- see issue #94).
  const seal = await createSealWithProvider({
    gateId,
    fingerprint: fingerprintResult.fingerprint,
    sealedBy: identitySlug,
    keyProvider,
    keyRef,
    resolvePassphrase: resolveKeyPassphrase,
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
 * Seal a **pattern gate** (`kind: pattern`): fingerprint every matched file
 * independently and produce **one seal per file**, each written as a standalone
 * `.seal` at `<gate>/<artifact>/<signer>.seal` via the low-level
 * {@link writeSealFileSync}. This is the per-file path the CLI previously never
 * used — without it a `kind: pattern` gate silently degraded to single-gate
 * behavior (issue #130).
 *
 * Per-file seals are written directly (never through the aggregate `writeSeals`,
 * which is one-file-per-gate and would prune the siblings). A file that already
 * has a valid per-file seal is skipped unless `--force`; a file whose seal is
 * missing/invalid, or a brand-new matching file, is (re)sealed. Authorization is
 * checked once for the gate (all its files share `authorizedSigners`).
 *
 * Results are recorded into the shared {@link SealSummary} keyed by gate +
 * `artifactPath`.
 */
async function processPatternGate(
  gateId: string,
  gate: GateConfig,
  config: AttestItConfig,
  identity: Identity,
  identitySlug: string,
  options: SealOptions,
  summary: SealSummary,
): Promise<void> {
  if (!options.json) {
    verbose(`Processing pattern gate: ${gateId}`)
  }

  // Authorization is per gate: refuse the whole gate up front (nothing signed or
  // written yet) exactly like the single-gate path. See #136.
  if (!isAuthorizedSigner(config, gateId, identity.publicKey)) {
    summary.skipped.push({
      gate: gateId,
      reason: `Not authorized to seal this gate (authorized signers: ${gate.authorizedSigners.join(', ')})`,
      failureClass: 'unauthorized-signer',
    })
    return
  }

  const projectRoot = process.cwd()
  const perFile = computePatternFingerprintsSync(gate, projectRoot)

  if (perFile.length === 0) {
    summary.skipped.push({
      gate: gateId,
      reason: 'Pattern gate matched no files',
    })
    return
  }

  const existingSeals = readPatternSealsByArtifactSync(
    projectRoot,
    config.settings.sealsPath,
    gateId,
  )
  const sealsRoot = resolveSealsRoot(projectRoot, config.settings.sealsPath)

  // Lazily create the signing provider only if at least one file needs sealing.
  let keyProvider: ReturnType<typeof createKeyProviderFromIdentity> | undefined
  let keyRef: string | undefined

  for (const { path: filePath, fingerprint } of perFile) {
    // Skip a file that already has a valid per-file seal, unless --force.
    const existing = existingSeals.get(filePath)
    if (existing && !options.force) {
      const verification = verifyPatternArtifactSeal(
        config,
        gateId,
        filePath,
        existing,
        fingerprint,
        gate.maxAge,
      )
      if (verification.state === 'VALID') {
        summary.skipped.push({
          gate: gateId,
          artifactPath: filePath,
          reason: 'File already has a valid seal (use --force to override)',
        })
        continue
      }
    }

    if (options.dryRun) {
      if (!options.json) {
        log(`  Would seal ${gateId} file: ${filePath}`)
      }
      summary.sealed.push({
        gate: gateId,
        artifactPath: filePath,
        fingerprint: '',
        sealedBy: identitySlug,
        sealedAt: '',
      })
      continue
    }

    if (!keyProvider) {
      keyProvider = createKeyProviderFromIdentity(identity)
      keyRef = getKeyRefFromIdentity(identity)
    }

    const seal = await createSealWithProvider({
      gateId,
      fingerprint,
      sealedBy: identitySlug,
      keyProvider,
      keyRef: keyRef ?? '',
      resolvePassphrase: resolveKeyPassphrase,
    })

    // artifactPath is a storage/linkage field; the signed fingerprint already
    // binds the file's path. Write it as a standalone per-file seal.
    const perFileSeal: Seal = { ...seal, artifactPath: filePath }
    writeSealFileSync(sealsRoot, perFileSeal)

    if (!options.json) {
      log(`  Sealed ${gateId} file: ${filePath}`)
      verbose(`    Sealed by: ${identitySlug} (${identity.name})`)
      verbose(`    Timestamp: ${seal.timestamp}`)
    }

    summary.sealed.push({
      gate: gateId,
      artifactPath: filePath,
      fingerprint: perFileSeal.fingerprint,
      sealedBy: perFileSeal.sealedBy,
      sealedAt: perFileSeal.timestamp,
    })
  }
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
    // A pattern gate contributes one entry per matched file; label a per-file
    // entry as `<gate> › <artifact>` and dedupe repeated gate ids so the banner
    // reads cleanly whether the seals were single-gate or per-file.
    const labels = summary.sealed.map((s) =>
      s.artifactPath !== undefined ? `${s.gate} › ${s.artifactPath}` : s.gate,
    )
    success(`${prefix} ${String(summary.sealed.length)} seal(s): ${labels.join(', ')}`)
  }

  // An unauthorized-signer skip is a hard failure (nothing was sealed for
  // that gate) and is rendered distinctly from benign skips (e.g. "already
  // has a valid seal") so the banner is unambiguous -- no reader should be
  // able to mistake "unauthorized" for an informational skip. See #136.
  const unauthorizedSkips = summary.skipped.filter(
    (skip) => skip.failureClass === 'unauthorized-signer',
  )
  const benignSkips = summary.skipped.filter((skip) => skip.failureClass !== 'unauthorized-signer')

  if (benignSkips.length > 0) {
    log('')
    warn(`Skipped ${String(benignSkips.length)}:`)
    for (const skip of benignSkips) {
      log(`  ${summaryLabel(skip)}: ${skip.reason}`)
    }
  }

  if (unauthorizedSkips.length > 0) {
    log('')
    error(`Refused to seal ${String(unauthorizedSkips.length)} gate(s) (unauthorized signer):`)
    for (const skip of unauthorizedSkips) {
      log(`  ${summaryLabel(skip)}: ${skip.reason}`)
    }
  }

  if (summary.failed.length > 0) {
    log('')
    error(`Failed to seal ${String(summary.failed.length)}:`)
    for (const fail of summary.failed) {
      log(`  ${summaryLabel(fail)}: ${fail.error}`)
    }
  }

  if (summary.sealed.length === 0 && summary.skipped.length === 0 && summary.failed.length === 0) {
    log('No gates to seal')
  }
}

/** Label a summary entry as the gate id, or `<gate> › <artifact>` for a per-file entry. */
function summaryLabel(entry: { gate: string; artifactPath?: string }): string {
  return entry.artifactPath !== undefined ? `${entry.gate} › ${entry.artifactPath}` : entry.gate
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
