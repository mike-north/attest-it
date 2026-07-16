import { Command } from 'commander'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { stringify as stringifyYaml } from 'yaml'
import { migrateUnifiedContent } from '@attest-it/core'
import { log, success, error } from '../utils/output.js'
import { confirmAction } from '../utils/prompts.js'
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
  devDependencies?: Record<string, string>
  [key: string]: unknown
}

/**
 * Type guard for package.json structure.
 */
function isPackageJson(data: unknown): data is PackageJson {
  return (
    typeof data === 'object' &&
    data !== null &&
    'name' in data &&
    'version' in data &&
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    typeof (data as { name: unknown }).name === 'string' &&
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    typeof (data as { version: unknown }).version === 'string'
  )
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
 * @returns Information about the package manager and whether package.json was created
 */
async function ensureDevDependency(): Promise<{ packageManager: string; created: boolean }> {
  const packageJsonPath = 'package.json'
  const packageManager = detectPackageManager()
  let created = false

  let packageJson: PackageJson
  if (fs.existsSync(packageJsonPath)) {
    const content = await fs.promises.readFile(packageJsonPath, 'utf8')
    const parsed: unknown = JSON.parse(content)

    if (!isPackageJson(parsed)) {
      throw new Error('Invalid package.json: missing required name or version field')
    }

    packageJson = parsed
  } else {
    packageJson = { name: path.basename(process.cwd()), version: '1.0.0' }
    created = true
  }

  // Add devDependency
  const devDeps = packageJson.devDependencies ?? {}
  devDeps['attest-it'] = '^' + getPackageVersion()
  packageJson.devDependencies = devDeps

  await fs.promises.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n')

  return { packageManager, created }
}

/**
 * Confirm overwrite of an existing file unless --force is set.
 *
 * @returns True if it is safe to write, false if the user declined.
 */
async function confirmOverwrite(filePath: string, force: boolean | undefined): Promise<boolean> {
  if (!fs.existsSync(filePath) || force) {
    return true
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
  }

  const policyPath = path.join(configDir, 'policy.yaml')
  const operationalPath = unifiedPath // operational config keeps the config.yaml name

  const content = await fs.promises.readFile(unifiedPath, 'utf8')
  const { policy, operational } = migrateUnifiedContent(content, 'yaml')

  if (!(await confirmOverwrite(policyPath, options.force))) {
    error('Migration cancelled')
    process.exit(ExitCode.CANCELLED)
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
    }
    if (!(await confirmOverwrite(operationalPath, options.force))) {
      error('Init cancelled')
      process.exit(ExitCode.CANCELLED)
    }

    // Ensure attest-it is in devDependencies
    const { packageManager, created } = await ensureDevDependency()
    if (created) {
      success('Created package.json')
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
