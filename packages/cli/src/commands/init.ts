import { Command } from 'commander'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { log, success, error } from '../utils/output.js'
import { confirmAction } from '../utils/prompts.js'
import { ExitCode } from '../utils/exit-codes.js'
import { offerCompletionInstall } from '../utils/completion-offer.js'
import { getPackageVersion } from '../utils/version.js'

export const initCommand = new Command('init')
  .description('Initialize attest-it configuration')
  .option('-p, --path <path>', 'Config file path', '.attest-it/config.yaml')
  .option('-f, --force', 'Overwrite existing config')
  .action(async (options: InitOptions) => {
    await runInit(options)
  })

interface InitOptions {
  path: string
  force?: boolean
}

/**
 * Load the configuration template from the templates directory.
 *
 * This function reads the config.yaml template at build time from the templates directory.
 * It handles different bundle output locations created by tsup.
 */
function loadConfigTemplate(): string {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = dirname(__filename)

  // Try multiple paths since tsup creates separate bundles:
  // - dist/commands/init.js needs ../../templates/config.yaml
  // - dist/bin/attest-it.js (when bundled) needs ../templates/config.yaml
  const possiblePaths = [
    join(__dirname, '../../templates/config.yaml'),
    join(__dirname, '../templates/config.yaml'),
  ]

  for (const templatePath of possiblePaths) {
    try {
      return fs.readFileSync(templatePath, 'utf-8')
    } catch (error) {
      // Only suppress "file not found" errors; rethrow anything else
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        // Try next path
        continue
      }
      throw error
    }
  }

  throw new Error('Could not find config.yaml template')
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

  // Add devDependency (skip if already present in dependencies or devDependencies)
  const deps = packageJson.dependencies
  const devDeps = packageJson.devDependencies ?? {}
  if (!deps?.['attest-it'] && !devDeps['attest-it']) {
    devDeps['attest-it'] = '^' + getPackageVersion()
    packageJson.devDependencies = devDeps
  }

  await fs.promises.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n')

  return { packageManager, created }
}

/**
 * Run the init command to create a new attest-it configuration.
 *
 * Creates a configuration file with sensible defaults and commented
 * examples showing how to define test suites. Also ensures attest-it
 * is added as a devDependency to package.json.
 *
 * @param options - Command options
 * @param options.path - Config file path (default: .attest-it/config.yaml)
 * @param options.force - Overwrite existing config without prompting
 * @public
 */
async function runInit(options: InitOptions): Promise<void> {
  try {
    const configPath = path.resolve(options.path)
    const configDir = path.dirname(configPath)

    if (fs.existsSync(configPath) && !options.force) {
      const overwrite = await confirmAction({
        message: `Config already exists at ${configPath}. Overwrite?`,
        default: false,
      })
      if (!overwrite) {
        error('Init cancelled')
        process.exit(ExitCode.CANCELLED)
      }
    }

    // Ensure attest-it is in devDependencies
    const { packageManager, created } = await ensureDevDependency()
    if (created) {
      success('Created package.json')
    } else {
      success('Updated package.json with attest-it devDependency')
    }

    // Create directory and write config
    await fs.promises.mkdir(configDir, { recursive: true })
    const configTemplate = loadConfigTemplate()
    await fs.promises.writeFile(configPath, configTemplate, 'utf-8')

    success(`Configuration created at ${configPath}`)
    log('')
    log('Next steps:')
    log(`  1. Run: ${packageManager} install`)
    log("  2. Run: attest-it identity create  (if you haven't already)")
    log('  3. Run: attest-it team join')
    log(`  4. Edit ${options.path} to customize gates, suites, and test commands`)

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
