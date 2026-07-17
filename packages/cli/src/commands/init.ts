import { Command } from 'commander'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { stringify as stringifyYaml } from 'yaml'
import { migrateUnifiedContent } from '@attest-it/core'
import { log, success, error } from '../utils/output.js'
import { confirmAction, isInteractiveTTY } from '../utils/prompts.js'
import { ExitCode } from '../utils/exit-codes.js'
import { offerCompletionInstall } from '../utils/completion-offer.js'
import { getPackageVersion } from '../utils/version.js'

export const initCommand = new Command('init')
  .description('Initialize attest-it split configuration (policy.yaml + config.yaml)')
  .option('-d, --dir <dir>', 'Config directory', '.attest-it')
  .option('-f, --force', 'Overwrite existing config')
  .option('--migrate', 'Migrate an existing unified config.yaml into split policy + config')
  .action(async (options: InitOptions) => {
    await runInit(options)
  })

interface InitOptions {
  dir: string
  force?: boolean
  migrate?: boolean
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
    log('')
    log('Next steps:')
    log(`  1. Run: ${packageManager} install`)
    log("  2. Run: attest-it identity create  (if you haven't already)")
    log('  3. Run: attest-it team join')
    log(`  4. Edit ${policyPath} to define your gates, and ${operationalPath} to define suites`)

    // Offer to install shell completions
    await offerCompletionInstall()
  } catch (err) {
    if (err instanceof Error) {
      error(err.message)
    } else {
      error('Unknown error occurred')
    }
    process.exit(ExitCode.CONFIG_ERROR)
  }
}

export { runInit }
