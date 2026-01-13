import { Command } from 'commander'
import { initCommand } from './commands/init.js'
import { statusCommand } from './commands/status.js'
import { runCommand } from './commands/run.js'
import { keygenCommand } from './commands/keygen.js'
import { pruneCommand } from './commands/prune.js'
import { verifyCommand } from './commands/verify.js'
import { setOutputOptions, initTheme } from './utils/output.js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

// Type guard for package.json structure
function hasVersion(data: unknown): data is { version: string } {
  return (
    typeof data === 'object' &&
    data !== null &&
    'version' in data &&
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    typeof (data as { version: unknown }).version === 'string'
  )
}

// Lazy-load version from package.json to avoid startup latency
let cachedVersion: string | undefined

function getPackageVersion(): string {
  if (cachedVersion !== undefined) {
    return cachedVersion
  }

  // Read version from package.json at runtime
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = dirname(__filename)

  // Try multiple paths since tsup creates separate bundles for each entry point:
  // - dist/index.js (library entry) needs ../package.json
  // - dist/bin/attest-it.js (CLI entry) needs ../../package.json
  const possiblePaths = [join(__dirname, '../package.json'), join(__dirname, '../../package.json')]

  for (const packageJsonPath of possiblePaths) {
    try {
      const content = readFileSync(packageJsonPath, 'utf-8')
      const packageJsonData: unknown = JSON.parse(content)

      if (!hasVersion(packageJsonData)) {
        throw new Error(`Invalid package.json at ${packageJsonPath}: missing version field`)
      }

      cachedVersion = packageJsonData.version
      return cachedVersion
    } catch (error) {
      // Only suppress "file not found" errors; rethrow anything else
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        // Try next path
        continue
      }
      throw error
    }
  }

  throw new Error('Could not find package.json')
}

const program = new Command()

program
  .name('attest-it')
  .description('Human-gated test attestation system')
  .option('-c, --config <path>', 'Path to config file')
  .option('-v, --verbose', 'Verbose output')
  .option('-q, --quiet', 'Minimal output')

// Handle --version manually to avoid loading package.json on every invocation
program.option('-V, --version', 'output the version number')

// Register commands
program.addCommand(initCommand)
program.addCommand(statusCommand)
program.addCommand(runCommand)
program.addCommand(keygenCommand)
program.addCommand(pruneCommand)
program.addCommand(verifyCommand)

export async function run(): Promise<void> {
  // Check for --version flag before initializing theme or doing other work
  if (process.argv.includes('--version') || process.argv.includes('-V')) {
    console.log(getPackageVersion())
    process.exit(0)
  }

  // Initialize theme before any output
  await initTheme()

  // Parse options and set global output options
  program.parse()
  const options = program.opts<{ verbose?: boolean; quiet?: boolean }>()

  const outputOptions: { verbose?: boolean; quiet?: boolean } = {}
  if (options.verbose !== undefined) {
    outputOptions.verbose = options.verbose
  }
  if (options.quiet !== undefined) {
    outputOptions.quiet = options.quiet
  }

  setOutputOptions(outputOptions)
}

export { program }
