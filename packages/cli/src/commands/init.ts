import { Command } from 'commander'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import {
  migrateUnifiedContent,
  loadLocalConfigSync,
  getActiveIdentity,
  computePolicyFingerprintSync,
  findPolicyPath,
  readSealsSync,
  writeSealsSync,
  ROOT_GATE_ID,
  type Identity,
} from '@attest-it/core'
import { log, success, error, warn } from '../utils/output.js'
import { confirmAction, isInteractiveTTY, handlePromptableError } from '../utils/prompts.js'
import { ExitCode } from '../utils/exit-codes.js'
import { offerCompletionInstall } from '../utils/completion-offer.js'
import { getPackageVersion } from '../utils/version.js'
import { createRootSealForIdentity } from '../utils/identity-key.js'

export const initCommand = new Command('init')
  .description('Initialize attest-it split configuration (policy.yaml + config.yaml)')
  .option('-d, --dir <dir>', 'Config directory', '.attest-it')
  .option('-f, --force', 'Overwrite existing config')
  .option('--migrate', 'Migrate an existing unified config.yaml into split policy + config')
  .option(
    '--root-signer <slug>',
    'Bootstrap the trust anchor: establish this identity as the root signer and seal ' +
      '.attest-it/policy.yaml. Must be your active local identity.',
  )
  .action(async (options: InitOptions) => {
    await runInit(options)
  })

interface InitOptions {
  dir: string
  force?: boolean
  migrate?: boolean
  rootSigner?: string
}

/**
 * Load a configuration template from the templates directory.
 *
 * Templates are read at runtime from the bundled templates directory. tsup
 * emits bundles at different depths, so several candidate paths are tried.
 *
 * @param name - Template file name (e.g. "policy.yaml").
 */
function loadTemplate(name: string): string {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = dirname(__filename)

  const possiblePaths = [
    join(__dirname, `../../templates/${name}`),
    join(__dirname, `../templates/${name}`),
  ]

  for (const templatePath of possiblePaths) {
    try {
      return fs.readFileSync(templatePath, 'utf-8')
    } catch (err) {
      // Only suppress "file not found" errors; rethrow anything else
      if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
        continue
      }
      throw err
    }
  }

  throw new Error(`Could not find template ${name}`)
}

/**
 * Represents a package.json structure with the fields we need to interact with.
 */
interface PackageJson {
  name: string
  version: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  [key: string]: unknown
}

/**
 * Reject anything that isn't a plain JSON object (arrays, `null`, primitives).
 * `name`/`version` are validated and auto-populated separately -- see
 * {@link ensureDevDependency} -- rather than required here, since a bare
 * `package.json` with neither field is exactly what a fresh `npm install
 * <pkg>` produces in a directory with no prior package.json (issue #84).
 */
function isPlainRecord(data: unknown): data is Record<string, unknown> {
  return (
    typeof data === 'object' &&
    data !== null &&
    !Array.isArray(data) &&
    Object.getPrototypeOf(data) === Object.prototype
  )
}

/**
 * Resolve a `package.json` field that must be a non-empty string, falling
 * back to a default (and flagging that a fallback was used) when the field
 * is missing, empty, or the wrong type.
 */
function resolveStringField(value: unknown, fallback: string): { value: string; patched: boolean } {
  if (typeof value === 'string' && value.trim().length > 0) {
    return { value, patched: false }
  }
  return { value: fallback, patched: true }
}

/**
 * Detect the package manager being used in the project.
 */
function detectPackageManager(): 'pnpm' | 'yarn' | 'bun' | 'npm' {
  if (fs.existsSync('pnpm-lock.yaml')) return 'pnpm'
  if (fs.existsSync('yarn.lock')) return 'yarn'
  if (fs.existsSync('bun.lockb')) return 'bun'
  return 'npm'
}

/**
 * Ensure attest-it is added as a devDependency.
 * Creates or updates package.json in the current directory.
 *
 * @remarks
 * A `package.json` that exists but is missing `name` and/or `version` is not
 * treated as an error -- it's auto-populated instead. This is the exact shape
 * `npm install <pkg>` leaves behind when run in a directory with no prior
 * `package.json` (the README's own Quick Start step 1), so rejecting it would
 * fail every fresh-project onboarding (issue #84).
 *
 * @returns Information about the package manager, whether package.json was
 * created from scratch, and which fields (if any) were auto-populated on an
 * existing file.
 */
async function ensureDevDependency(): Promise<{
  packageManager: string
  created: boolean
  patchedFields: string[]
}> {
  const packageJsonPath = 'package.json'
  const packageManager = detectPackageManager()
  let created = false
  const patchedFields: string[] = []

  let packageJson: PackageJson
  if (fs.existsSync(packageJsonPath)) {
    const content = await fs.promises.readFile(packageJsonPath, 'utf8')
    const parsed: unknown = JSON.parse(content)

    if (!isPlainRecord(parsed)) {
      throw new Error(
        'Invalid package.json: expected a JSON object at the top level. Fix the file and re-run "attest-it init".',
      )
    }

    const name = resolveStringField(parsed.name, path.basename(process.cwd()))
    const version = resolveStringField(parsed.version, '0.0.0')
    if (name.patched) patchedFields.push('name')
    if (version.patched) patchedFields.push('version')

    packageJson = { ...parsed, name: name.value, version: version.value }
  } else {
    packageJson = { name: path.basename(process.cwd()), version: '1.0.0' }
    created = true
  }

  // Add devDependency (skip if already present in dependencies or devDependencies)
  const deps = packageJson.dependencies
  const devDeps = packageJson.devDependencies ?? {}
  if (!deps?.['attest-it'] && !devDeps['attest-it']) {
    devDeps['attest-it'] = '^' + getPackageVersion()
    packageJson.devDependencies = devDeps
  }

  await fs.promises.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n')

  return { packageManager, created, patchedFields }
}

/**
 * Confirm overwrite of an existing file unless --force is set.
 *
 * @returns True if it is safe to write, false if the user declined.
 * @throws Error if the file exists, --force was not passed, and stdin is not
 * an interactive TTY -- prompting would hang forever, so this fails fast
 * instead, naming --force as the flag needed to proceed non-interactively.
 */
async function confirmOverwrite(filePath: string, force: boolean | undefined): Promise<boolean> {
  if (!fs.existsSync(filePath) || force) {
    return true
  }
  if (!isInteractiveTTY()) {
    throw new Error(
      `Config already exists at ${filePath}. Pass --force to overwrite non-interactively.`,
    )
  }
  return confirmAction({
    message: `Config already exists at ${filePath}. Overwrite?`,
    default: false,
  })
}

/**
 * Migrate an existing unified config.yaml into split policy + operational files.
 */
async function runMigrate(options: InitOptions, configDir: string): Promise<void> {
  const unifiedPath = path.join(configDir, 'config.yaml')
  if (!fs.existsSync(unifiedPath)) {
    error(`No unified config found at ${unifiedPath} to migrate.`)
    process.exit(ExitCode.CONFIG_ERROR)
    return
  }

  const policyPath = path.join(configDir, 'policy.yaml')
  const operationalPath = unifiedPath // operational config keeps the config.yaml name

  const content = await fs.promises.readFile(unifiedPath, 'utf8')
  const { policy, operational } = migrateUnifiedContent(content, 'yaml')

  if (!(await confirmOverwrite(policyPath, options.force))) {
    error('Migration cancelled')
    process.exit(ExitCode.CANCELLED)
    return
  }

  const policyHeader =
    '# yaml-language-server: $schema=https://raw.githubusercontent.com/mike-north/attest-it/main/schemas/v1/policy.schema.json\n' +
    '# attest-it policy configuration (trust-critical) — migrated from unified config\n\n'
  const operationalHeader =
    '# yaml-language-server: $schema=https://raw.githubusercontent.com/mike-north/attest-it/main/schemas/v1/config.schema.json\n' +
    '# attest-it operational configuration — migrated from unified config\n\n'

  await fs.promises.writeFile(policyPath, policyHeader + stringifyYaml(policy), 'utf8')
  await fs.promises.writeFile(
    operationalPath,
    operationalHeader + stringifyYaml(operational),
    'utf8',
  )

  success('Migrated unified config into split configuration:')
  log(`  - ${policyPath} (team, gates, security settings)`)
  log(`  - ${operationalPath} (suites, command settings)`)
  log('')
  log('Next steps:')
  log(`  1. Review and commit ${policyPath} on your default branch`)
  log('  2. Run: attest-it verify')
}

/**
 * Run the init command to create a new attest-it split configuration.
 *
 * By default this scaffolds `.attest-it/policy.yaml` (trust-critical) and
 * `.attest-it/config.yaml` (operational) with commented examples, and ensures
 * attest-it is a devDependency. With `--migrate`, it instead converts an
 * existing unified `config.yaml` into the split pair.
 *
 * @param options - Command options
 * @param options.dir - Config directory (default: .attest-it)
 * @param options.force - Overwrite existing config without prompting
 * @param options.migrate - Migrate an existing unified config.yaml
 * @public
 */
async function runInit(options: InitOptions): Promise<void> {
  try {
    const configDir = path.resolve(options.dir)

    if (options.migrate) {
      await runMigrate(options, configDir)
      return
    }

    const policyPath = path.join(configDir, 'policy.yaml')
    const operationalPath = path.join(configDir, 'config.yaml')

    // Additive trust-anchor bootstrap. Establishing a root signer on a repo
    // that has already been initialized must NEVER re-scaffold from the empty
    // template — doing so wipes existing `gates:`/`suites:` and orphans any
    // seal, silently, while still printing "Trust anchor established" (issue
    // #127). When --root-signer targets an existing policy.yaml, take a
    // dedicated path that merges in only the rootGate + signer and leaves
    // everything else untouched. This path needs no --force.
    if (options.rootSigner !== undefined && fs.existsSync(policyPath)) {
      await establishRootSignerOnExistingConfig(options.rootSigner, policyPath)
      return
    }

    // Full (re-)scaffold path — fresh init, or an explicit --force overwrite.
    // Guard first: the full re-scaffold writes empty templates, so it must
    // refuse to silently discard a populated config. If existing gates/suites
    // would be lost, print exactly what is at stake and require an explicit
    // confirmation (never a silent wipe, even with --force). See issue #127.
    await guardAgainstDestructiveRescaffold(options, policyPath, operationalPath)

    if (!(await confirmOverwrite(policyPath, options.force))) {
      error('Init cancelled')
      process.exit(ExitCode.CANCELLED)
      return
    }
    if (!(await confirmOverwrite(operationalPath, options.force))) {
      error('Init cancelled')
      process.exit(ExitCode.CANCELLED)
      return
    }

    // Ensure attest-it is in devDependencies
    const { packageManager, created, patchedFields } = await ensureDevDependency()
    if (created) {
      success('Created package.json')
    } else if (patchedFields.length > 0) {
      success(
        `Updated package.json with attest-it devDependency (auto-populated missing ${patchedFields.join(' and ')})`,
      )
    } else {
      success('Updated package.json with attest-it devDependency')
    }

    // Create directory and write both split config files
    await fs.promises.mkdir(configDir, { recursive: true })
    await fs.promises.writeFile(policyPath, loadTemplate('policy.yaml'), 'utf-8')
    await fs.promises.writeFile(operationalPath, loadTemplate('config.yaml'), 'utf-8')

    success(`Configuration created:`)
    log(`  - ${policyPath} (team, gates, security settings)`)
    log(`  - ${operationalPath} (suites, command settings)`)

    // Bootstrap ceremony: establish the root gate's authorized signer over
    // policy.yaml. This is the explicit, human-run trust anchor — never silently
    // defaulted. It runs when --root-signer is passed, or interactively when a
    // TTY and an active identity are available.
    const bootstrapped = await maybeBootstrapRootGate(options, policyPath)

    log('')
    log('Next steps:')
    log(`  1. Run: ${packageManager} install`)
    if (bootstrapped) {
      log(`  2. Edit ${policyPath} to define your gates, and ${operationalPath} to define suites`)
      log('  3. After editing trust-critical policy, re-seal the root gate: attest-it seal --root')
    } else {
      log("  2. Run: attest-it identity create  (if you haven't already)")
      log('  3. Run: attest-it team join')
      log(`  4. Edit ${policyPath} to define your gates, and ${operationalPath} to define suites`)
      log('  5. Bootstrap the trust anchor: attest-it init --root-signer <your-identity-slug>')
      log(
        '     (safe to run at any time — it merges in the root gate and leaves your ' +
          'existing gates, suites, and seals untouched)',
      )
    }

    // Offer to install shell completions
    await offerCompletionInstall()
  } catch (err) {
    handlePromptableError(err, ExitCode.CONFIG_ERROR)
  }
}

/**
 * Read the keys of a top-level map section (e.g. `gates`, `suites`) from a
 * YAML config file, returning `[]` when the file is absent, unparseable, or the
 * section is missing/empty. Used to detect whether a re-scaffold would discard
 * real user data. See issue #127.
 *
 * @param filePath - Absolute path to the YAML config file.
 * @param section - Top-level map key to inspect (a fixed literal, never user input).
 */
function readSectionKeys(filePath: string, section: 'gates' | 'suites'): string[] {
  if (!fs.existsSync(filePath)) {
    return []
  }
  let parsed: unknown
  try {
    parsed = parseYaml(fs.readFileSync(filePath, 'utf8'))
  } catch {
    // A malformed existing file has no recoverable sections to protect.
    return []
  }
  if (!isPlainRecord(parsed)) {
    return []
  }
  // `section` is one of two hard-coded literals, not attacker-controlled.
  // eslint-disable-next-line security/detect-object-injection
  const value = parsed[section]
  return isPlainRecord(value) ? Object.keys(value) : []
}

/**
 * Refuse to let the full re-scaffold silently empty a populated config.
 *
 * The default `init` path (and `init --force`) overwrites `policy.yaml` and
 * `config.yaml` with empty templates. If either file already defines
 * `gates:`/`suites:`, that overwrite is destructive: it wipes trust/operational
 * data and orphans any seal. This guard detects that case, prints exactly what
 * would be lost, and requires an explicit confirmation — a `--force` flag alone
 * is never enough to discard real data non-interactively. See issue #127.
 *
 * @throws Error when a populated config would be discarded and no interactive
 * terminal is available to confirm the destructive overwrite.
 */
async function guardAgainstDestructiveRescaffold(
  options: InitOptions,
  policyPath: string,
  operationalPath: string,
): Promise<void> {
  const gateKeys = readSectionKeys(policyPath, 'gates')
  const suiteKeys = readSectionKeys(operationalPath, 'suites')
  if (gateKeys.length === 0 && suiteKeys.length === 0) {
    return
  }

  warn('Re-scaffolding from the empty template would DISCARD existing configuration:')
  if (gateKeys.length > 0) {
    log(`  policy.yaml gates:  ${gateKeys.join(', ')}`)
  }
  if (suiteKeys.length > 0) {
    log(`  config.yaml suites: ${suiteKeys.join(', ')}`)
  }
  log('')
  log('To establish a root signer without touching this config, run the non-destructive path:')
  log('  attest-it init --root-signer <your-identity-slug>')
  log('')

  if (!isInteractiveTTY()) {
    throw new Error(
      'Refusing to re-scaffold over a populated config: this would discard the gates/suites ' +
        'listed above and orphan any seal. Re-run in an interactive terminal to confirm the ' +
        'overwrite, or use "attest-it init --root-signer <slug>" to establish a root signer ' +
        'non-destructively.',
    )
  }

  const confirmed = await confirmAction({
    message: 'Overwrite and permanently discard the gates/suites listed above',
    default: false,
  })
  if (!confirmed) {
    error('Init cancelled')
    process.exit(ExitCode.CANCELLED)
  }
}

/**
 * Resolve and validate the active local identity that will act as root signer.
 *
 * The bootstrapping signer must be the operator's active local identity, since
 * only that identity's private key can create the anchoring seal. Throws with an
 * actionable message when no active identity exists or when `rootSigner` names a
 * different identity.
 */
function resolveBootstrapIdentity(rootSigner: string): {
  identity: Identity
  identitySlug: string
} {
  const localConfig = loadLocalConfigSync()
  const identity = localConfig ? getActiveIdentity(localConfig) : undefined
  const identitySlug = localConfig?.activeIdentity
  if (!identity || !identitySlug) {
    throw new Error(
      'Cannot bootstrap the root gate: no active local identity found. ' +
        'Run "attest-it identity create" first.',
    )
  }
  if (rootSigner !== identitySlug) {
    throw new Error(
      `--root-signer '${rootSigner}' does not match your active identity ` +
        `'${identitySlug}'. The bootstrapping signer must be an identity you hold the ` +
        'private key for, so that it can create the anchoring seal.',
    )
  }
  return { identity, identitySlug }
}

/**
 * Establish a root signer on an already-initialized repository, additively.
 *
 * This is the non-destructive counterpart to the full scaffold: it merges only
 * the `rootGate` (and the signer's `team` entry) into the existing
 * `policy.yaml` and creates the anchoring seal, leaving existing `gates:`,
 * `suites:`, `team:`, and any prior seals untouched. It requires no `--force`.
 * See issue #127.
 */
async function establishRootSignerOnExistingConfig(
  rootSigner: string,
  policyPath: string,
): Promise<void> {
  const { identity, identitySlug } = resolveBootstrapIdentity(rootSigner)
  await bootstrapRootGate(identity, identitySlug, policyPath)

  log('')
  log('Next steps:')
  log(`  1. Review the updated ${policyPath} and commit it on your default branch`)
  log('  2. Run: attest-it verify')
}

/**
 * Run the bootstrap ceremony that establishes the root gate over policy.yaml.
 *
 * Decides whether to bootstrap based on explicit signals only (never a silent
 * default): the `--root-signer` flag, or an interactive confirmation when a TTY
 * and an active identity are present. On confirmation it establishes the active
 * identity as the sole root signer, records it in `rootGate`, and creates the
 * anchoring seal over the policy file — all in this single command invocation.
 *
 * @returns True if the repository was bootstrapped to a trust-anchored state.
 */
async function maybeBootstrapRootGate(options: InitOptions, policyPath: string): Promise<boolean> {
  const localConfig = loadLocalConfigSync()
  const identity = localConfig ? getActiveIdentity(localConfig) : undefined
  const identitySlug = localConfig?.activeIdentity

  // Explicit flag path.
  if (options.rootSigner !== undefined) {
    const resolved = resolveBootstrapIdentity(options.rootSigner)
    await bootstrapRootGate(resolved.identity, resolved.identitySlug, policyPath)
    return true
  }

  // Interactive path: only prompt when we actually can bootstrap.
  if (identity && identitySlug && isInteractiveTTY()) {
    const confirmed = await confirmAction({
      message:
        `Establish '${identitySlug}' as this repository's root signer (the trust anchor ` +
        'over policy.yaml)? This can only be changed later by an existing root signer.',
      default: false,
    })
    if (confirmed) {
      await bootstrapRootGate(identity, identitySlug, policyPath)
      return true
    }
    return false
  }

  return false
}

/**
 * Establish the root gate and create its anchoring seal over the policy file.
 *
 * Adds the identity to `team`, sets `rootGate.authorizedSigners`, then seals the
 * resulting policy content with the identity's private key. After this returns,
 * `attest-it verify` treats the policy as trust-anchored.
 */
async function bootstrapRootGate(
  identity: Identity,
  identitySlug: string,
  policyPath: string,
): Promise<void> {
  // Read and mutate the scaffolded policy to add the root signer + rootGate.
  const rawPolicy = await fs.promises.readFile(policyPath, 'utf8')
  const parsed: unknown = parseYaml(rawPolicy)
  const policy: Record<string, unknown> = isPlainRecord(parsed) ? { ...parsed } : {}

  policy.version ??= 1

  const team: Record<string, unknown> = isPlainRecord(policy.team) ? { ...policy.team } : {}
  // eslint-disable-next-line security/detect-object-injection -- identitySlug is the operator's own local identity slug, not attacker-controlled
  team[identitySlug] = {
    name: identity.name,
    publicKey: identity.publicKey,
    publicKeyAlgorithm: 'ed25519',
  }
  policy.team = team

  policy.rootGate = {
    authorizedSigners: [identitySlug],
    description: 'Trust anchor over .attest-it/policy.yaml',
  }

  // Resolve the seals path the verifier will read from, so the anchoring seal
  // lands where `attest-it verify` looks (config.settings.sealsPath). Defaults
  // to the policy schema default when unspecified.
  const settings = isPlainRecord(policy.settings) ? policy.settings : {}
  const sealsPath =
    typeof settings.sealsPath === 'string' ? settings.sealsPath : '.attest-it/seals/'

  const policyHeader =
    '# yaml-language-server: $schema=https://raw.githubusercontent.com/mike-north/attest-it/main/schemas/v1/policy.schema.json\n' +
    '# attest-it policy configuration (trust-critical) — bootstrapped root gate\n\n'
  await fs.promises.writeFile(policyPath, policyHeader + stringifyYaml(policy), 'utf8')

  // Seal the policy file as the root gate, using the same primitives as any
  // other gate seal.
  const projectRoot = process.cwd()
  const resolvedPolicyPath = findPolicyPath(projectRoot) ?? policyPath
  const policyFingerprint = computePolicyFingerprintSync(projectRoot, resolvedPolicyPath)

  const seal = await createRootSealForIdentity(identity, policyFingerprint, identitySlug)

  const sealsFile = readSealsSync(projectRoot, sealsPath)
  // eslint-disable-next-line security/detect-object-injection -- ROOT_GATE_ID is a fixed reserved constant
  sealsFile.seals[ROOT_GATE_ID] = seal
  writeSealsSync(projectRoot, sealsFile, sealsPath)

  log('')
  success(`Trust anchor established: '${identitySlug}' is the root signer`)
  log(`  Root gate sealed over ${resolvedPolicyPath}`)
  log(`  Fingerprint: ${seal.fingerprint}`)
  warn(
    '  Changing the root signers later requires a seal from an existing root signer — ' +
      'a branch cannot bootstrap a new root of trust for itself.',
  )
}

export { runInit }
