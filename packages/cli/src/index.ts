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

// Read version from package.json at runtime
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Try to find package.json - it could be at different relative paths
// depending on whether we're running from dist/index.js or dist/bin/attest-it.js
function findPackageJson(): { content: string; path: string } {
  const possiblePaths = [
    join(__dirname, '../package.json'), // from dist/index.js
    join(__dirname, '../../package.json'), // from dist/bin/attest-it.js
  ]

  for (const path of possiblePaths) {
    try {
      const content = readFileSync(path, 'utf-8')
      return { content, path }
    } catch {
      // Try next path
    }
  }

  throw new Error('Could not find package.json')
}

const packageJsonResult = findPackageJson()
const packageJsonData: unknown = JSON.parse(packageJsonResult.content)

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

if (!hasVersion(packageJsonData)) {
  throw new Error(
    `Invalid package.json at ${packageJsonResult.path}: missing version field`,
  )
}

const packageVersion = packageJsonData.version

const program = new Command()

program
  .name('attest-it')
  .description('Human-gated test attestation system')
  .version(packageVersion)
  .option('-c, --config <path>', 'Path to config file')
  .option('-v, --verbose', 'Verbose output')
  .option('-q, --quiet', 'Minimal output')

// Register commands
program.addCommand(initCommand)
program.addCommand(statusCommand)
program.addCommand(runCommand)
program.addCommand(keygenCommand)
program.addCommand(pruneCommand)
program.addCommand(verifyCommand)

export async function run(): Promise<void> {
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
