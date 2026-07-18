import { Command } from 'commander'
import { confirm } from '@inquirer/prompts'
import { randomUUID } from 'node:crypto'
import { readFile, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import * as path from 'node:path'
import {
  loadLocalConfig,
  saveLocalConfig,
  storePrivateKey,
  deletePrivateKey,
  KeyProviderRegistry,
  signEd25519,
  verifyEd25519,
  isEncryptedPrivateKeyPem,
  type Identity,
  type LocalConfig,
  type PrivateKeyRef,
  type PrivateKeyBackendType,
} from '@attest-it/core'
import { log, success, error, info, warn, getTheme } from '../../utils/output.js'
import { ExitCode } from '../../utils/exit-codes.js'
import { resolveConfirmation, handlePromptableError } from '../../utils/prompts.js'
import { resolveKeyPassphrase } from '../../utils/passphrase.js'

/**
 * Storage backend values accepted by `--storage`, mirroring `identity
 * create`'s `--storage` (see `create.ts`).
 */
const STORAGE_TYPES = ['file', 'keychain', '1password', 'yubikey'] as const
type StorageType = (typeof STORAGE_TYPES)[number]

/** Maps a `--storage` value to the `KeyProviderRegistry` type it corresponds to. */
const STORAGE_TYPE_TO_REGISTRY: Record<StorageType, string> = {
  file: 'filesystem',
  keychain: 'macos-keychain',
  '1password': '1password',
  yubikey: 'yubikey',
}

function isStorageType(value: string): value is StorageType {
  return STORAGE_TYPES.some((storageType) => storageType === value)
}

/** Build the v2 `PrivateKeyRef` for a newly-imported key under `secretId`. */
function buildPrivateKeyRef(storageType: StorageType, secretId: string): PrivateKeyRef {
  switch (storageType) {
    case 'file':
      return { type: 'file', id: secretId }
    case 'keychain':
      return { type: 'keychain', id: secretId }
    case '1password':
      return { type: '1password', id: secretId }
    case 'yubikey':
      return { type: 'yubikey', id: secretId }
  }
}

interface MigrateOptions {
  yes?: boolean
  storage?: string
  keepFiles?: boolean
}

export const migrateCommand = new Command('migrate')
  .description('Import legacy filesystem-backed identities into VaultKeeper')
  .argument('[slug]', 'Migrate only this identity (defaults to every legacy identity)')
  .option('-y, --yes', 'Skip the confirmation prompt and migrate non-interactively')
  .option(
    '--storage <backend>',
    `Target VaultKeeper backend for the imported key: ${STORAGE_TYPES.join('|')}`,
    'file',
  )
  .option(
    '--keep-files',
    'Do not delete the original legacy key file(s) after a verified migration',
  )
  .action(async (slug: string | undefined, options: MigrateOptions) => {
    await runMigrate(slug, options)
  })

/** An identity slug paired with its (known-legacy) config entry. */
interface LegacyIdentityEntry {
  slug: string
  identity: Identity
  legacyPath: string
}

/**
 * Find every identity in `config` whose private key is still the legacy
 * `filesystem` shape (see `LegacyPrivateKeyRef`/`PrivateKeyRef` in
 * `@attest-it/core`'s identity types), optionally narrowed to a single slug.
 *
 * @throws Error if `onlySlug` is given but does not name a legacy identity
 * (either the slug does not exist, or it already migrated).
 */
function findLegacyIdentities(config: LocalConfig, onlySlug?: string): LegacyIdentityEntry[] {
  const entries = Object.entries(config.identities)
    .filter(([, identity]) => identity.privateKey.type === 'filesystem')
    .map(([entrySlug, identity]) => ({
      slug: entrySlug,
      identity,
      // Type narrowed by the filter above; TS can't see through Object.entries.
      legacyPath: identity.privateKey.type === 'filesystem' ? identity.privateKey.path : '',
    }))

  if (onlySlug === undefined) {
    return entries
  }

  const match = entries.find((entry) => entry.slug === onlySlug)
  if (match) {
    return [match]
  }

  // eslint-disable-next-line security/detect-object-injection -- onlySlug is the operator's own CLI argument, not attacker-controlled
  if (config.identities[onlySlug]) {
    // Exists, but isn't legacy -- not an error, just nothing to do for it.
    return []
  }

  throw new Error(`Identity "${onlySlug}" not found`)
}

/**
 * Result of successfully migrating a single legacy identity.
 */
interface MigratedIdentity {
  slug: string
  privateKeyRef: PrivateKeyRef
  storageDescription: string
  legacyPath: string
}

/**
 * Import one legacy identity's private key into the target VaultKeeper
 * backend, verify a real sign/verify round-trip against the identity's
 * already-recorded public key, and return the new `PrivateKeyRef` to write
 * into config.
 *
 * @remarks
 * Fail-closed: if the round-trip verification throws for any reason, the
 * just-stored VaultKeeper secret is deleted (best-effort) and the error is
 * re-thrown -- the caller must not update config or delete the legacy file
 * when this rejects. See issue #107.
 *
 * The private key is imported via the target backend's plain secret store
 * (`storePrivateKey`), preserving the exact original PEM (and, if
 * passphrase-encrypted, its exact encrypted form) so the identity's public
 * key never changes. See the comment on VaultKeeper's `SigningBackend`
 * contract in this PR's description for why a signing-namespace enrollment
 * (`generateSigningKey`) is not used here.
 */
async function migrateOne(
  entry: LegacyIdentityEntry,
  storageType: StorageType,
): Promise<MigratedIdentity> {
  const { slug, identity, legacyPath } = entry

  const legacyProvider = KeyProviderRegistry.create({ type: 'filesystem-legacy', options: {} })
  const legacyResult = await legacyProvider.getPrivateKey(legacyPath)
  let pem: string
  try {
    pem = await readFile(legacyResult.keyPath, 'utf8')
  } finally {
    await legacyResult.cleanup()
  }

  const passphrase = isEncryptedPrivateKeyPem(pem) ? await resolveKeyPassphrase() : undefined

  const backendType: PrivateKeyBackendType = storageType
  const { secretId, storageDescription } = await storePrivateKey(backendType, pem, identity.name)

  try {
    // eslint-disable-next-line security/detect-object-injection -- storageType is validated against STORAGE_TYPES above
    const targetRegistryType = STORAGE_TYPE_TO_REGISTRY[storageType]
    const targetProvider = KeyProviderRegistry.create({ type: targetRegistryType, options: {} })
    const verifyResult = await targetProvider.getPrivateKey(secretId)
    let storedPem: string
    try {
      storedPem = await readFile(verifyResult.keyPath, 'utf8')
    } finally {
      await verifyResult.cleanup()
    }

    const testMessage = `attest-it identity migrate verification for "${slug}" (${randomUUID()})`
    const signature = signEd25519(testMessage, storedPem, passphrase)
    const valid = verifyEd25519(testMessage, signature, identity.publicKey)
    if (!valid) {
      throw new Error(
        'Signature produced by the imported key did not verify against the ' +
          "identity's recorded public key",
      )
    }
  } catch (verifyError) {
    await deletePrivateKey(backendType, secretId).catch(() => {
      // Best-effort cleanup -- the verification error below is the one that matters.
    })
    const message = verifyError instanceof Error ? verifyError.message : String(verifyError)
    throw new Error(
      `Failed to verify signing round-trip for identity "${slug}" after import: ${message}. ` +
        'The legacy key file was left untouched and no config changes were made.',
    )
  }

  return {
    slug,
    privateKeyRef: buildPrivateKeyRef(storageType, secretId),
    storageDescription,
    legacyPath,
  }
}

/**
 * Run the migrate command: import every (or one named) legacy
 * `filesystem`-type identity's private key into VaultKeeper, verify it
 * signs correctly, update the identity's config record to the v2 form, and
 * (unless `--keep-files`) delete the original key file.
 *
 * @remarks
 * Idempotent: with no legacy identities left to migrate (either none ever
 * existed, or a prior run already migrated them), this exits 0 and says so
 * rather than erroring. Non-interactive capable end-to-end via `--yes`; a
 * closed/piped stdin without `--yes` fails fast rather than hanging on a
 * prompt that can never resolve (matching `identity remove`'s convention).
 * See issue #107.
 *
 * @public
 */
export async function runMigrate(slug: string | undefined, options: MigrateOptions): Promise<void> {
  try {
    const theme = getTheme()

    const config = await loadLocalConfig()
    if (!config) {
      error('No identities configured')
      log('')
      log('Run: attest-it identity create')
      process.exit(ExitCode.CONFIG_ERROR)
    }

    let storageType: StorageType = 'file'
    if (options.storage !== undefined) {
      if (!isStorageType(options.storage)) {
        throw new Error(
          `Unknown --storage value "${options.storage}". Supported values: ${STORAGE_TYPES.join(', ')}`,
        )
      }
      storageType = options.storage
    }

    const legacyEntries = findLegacyIdentities(config, slug)

    if (legacyEntries.length === 0) {
      success(
        slug !== undefined
          ? `Identity "${slug}" is already on VaultKeeper -- nothing to migrate`
          : 'No legacy identities to migrate -- nothing to do',
      )
      return
    }

    log('')
    log(theme.blue.bold()('Identities to migrate:'))
    log('')
    for (const entry of legacyEntries) {
      log(`  ${theme.blue(entry.slug)} (${entry.identity.name}) -- ${entry.legacyPath}`)
    }
    log('')
    log(`Target VaultKeeper backend: ${storageType}`)
    log('')

    const proceed = await resolveConfirmation(options.yes, '--yes', () =>
      confirm({
        message: `Migrate ${legacyEntries.length.toString()} identit${legacyEntries.length === 1 ? 'y' : 'ies'} to VaultKeeper?`,
        default: true,
      }),
    )
    if (!proceed) {
      log('Cancelled')
      process.exit(ExitCode.CANCELLED)
    }

    const migrated: MigratedIdentity[] = []
    const failures: { slug: string; message: string }[] = []

    for (const entry of legacyEntries) {
      try {
        const result = await migrateOne(entry, storageType)
        migrated.push(result)
        info(`  Migrated "${result.slug}": ${result.storageDescription}`)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        failures.push({ slug: entry.slug, message })
        error(`  Failed to migrate "${entry.slug}": ${message}`)
      }
    }

    if (migrated.length > 0) {
      const updatedIdentities: Record<string, Identity> = { ...config.identities }
      for (const result of migrated) {
        const current = updatedIdentities[result.slug]
        if (!current) {
          continue
        }
        updatedIdentities[result.slug] = { ...current, privateKey: result.privateKeyRef }
      }

      const newConfig: LocalConfig = {
        version: 2,
        activeIdentity: config.activeIdentity,
        identities: updatedIdentities,
      }
      await saveLocalConfig(newConfig)

      if (!options.keepFiles) {
        for (const result of migrated) {
          await deleteLegacyFile(result.legacyPath)
        }
      } else {
        log('')
        log('Keeping original legacy key file(s) (--keep-files)')
      }
    }

    log('')
    if (migrated.length > 0) {
      success(
        `Migrated ${migrated.length.toString()} identit${migrated.length === 1 ? 'y' : 'ies'} to VaultKeeper`,
      )
    }
    if (failures.length > 0) {
      log('')
      warn(
        `${failures.length.toString()} identit${failures.length === 1 ? 'y' : 'ies'} failed to migrate:`,
      )
      for (const failure of failures) {
        log(`  ${failure.slug}: ${failure.message}`)
      }
      process.exit(ExitCode.CONFIG_ERROR)
    }
  } catch (err) {
    handlePromptableError(err, ExitCode.CONFIG_ERROR)
  }
}

/**
 * Delete a migrated identity's legacy key file. Mirrors
 * `identity/remove.ts`'s legacy-path deletion: `~` expansion is already
 * resolved by `LegacyFilesystemKeyProvider.getPrivateKey` (the `legacyPath`
 * recorded on `MigratedIdentity` is the raw, unresolved config path, so we
 * re-resolve it here the same way `identity remove` does -- not shared via
 * export because that module's internals are intentionally not part of the
 * package's public API).
 */
async function deleteLegacyFile(rawPath: string): Promise<void> {
  const resolvedPath =
    rawPath === '~' || rawPath.startsWith('~/') ? path.join(homedir(), rawPath.slice(1)) : rawPath

  try {
    await unlink(resolvedPath)
    log(`  Deleted legacy private key file: ${rawPath}`)
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code !== 'ENOENT') {
      throw err
    }
  }
}

// Exported for testing
export { findLegacyIdentities }
