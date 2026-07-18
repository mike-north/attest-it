import { Command } from 'commander'
import { initCommand } from './commands/init.js'
import { statusCommand } from './commands/status.js'
import { runCommand } from './commands/run.js'
import { pruneCommand } from './commands/prune.js'
import { verifyCommand } from './commands/verify.js'
import { sealCommand } from './commands/seal.js'
import { identityCommand } from './commands/identity/index.js'
import { whoamiCommand } from './commands/whoami.js'
import { teamCommand } from './commands/team/index.js'
import { completionCommand, createCompletionServerCommand } from './commands/completion.js'
import { setOutputOptions, initTheme, log } from './utils/output.js'
import { setAttestItHomeDir } from '@attest-it/core'
import { getPackageVersion } from './utils/version.js'
import { ExitCode } from './utils/exit-codes.js'

const program = new Command()

program
  .name('attest-it')
  .description('Human-gated test attestation system')
  .option('-c, --config <path>', 'Path to policy config file (overrides auto-detection)')
  .option('-v, --verbose', 'Verbose output')
  .option('-q, --quiet', 'Minimal output')

// Handle --version manually to avoid loading package.json on every invocation
program.option('-V, --version', 'output the version number')

// Register commands
program.addCommand(initCommand)
program.addCommand(statusCommand)
program.addCommand(runCommand)
program.addCommand(pruneCommand)
program.addCommand(verifyCommand)
program.addCommand(sealCommand)
program.addCommand(identityCommand)
program.addCommand(teamCommand)
program.addCommand(whoamiCommand)
program.addCommand(completionCommand)
program.addCommand(createCompletionServerCommand(), { hidden: true })

/**
 * Process the hidden --home-dir option before any other processing.
 * This must be done early so config loading uses the correct path.
 */
function processHomeDirOption(): void {
  const homeDirIndex = process.argv.indexOf('--home-dir')
  if (homeDirIndex !== -1 && homeDirIndex + 1 < process.argv.length) {
    const homeDir = process.argv[homeDirIndex + 1]
    if (homeDir && !homeDir.startsWith('-')) {
      setAttestItHomeDir(homeDir)
      // Remove the option from argv so Commander doesn't complain
      process.argv.splice(homeDirIndex, 2)
    }
  }
}

/**
 * Register a process-wide `SIGINT` (Ctrl-C) handler that exits
 * {@link ExitCode.CANCELLED} with a clean message.
 *
 * @remarks
 * Without an explicit `process.on('SIGINT', ...)` listener, Node's default
 * action on a real SIGINT is to terminate the process immediately -- which a
 * parent shell typically reports as exit code 130 (128 + signal 2), not a
 * clean `process.exit()`. `@inquirer/core`'s prompts install their own
 * `SIGINT` handling on the readline interface and convert it to
 * `ExitPromptError` (already mapped to `CANCELLED` by `handlePromptableError`
 * in `utils/prompts.ts`), but that only fires when the terminal is in the
 * raw/keypress mode a prompt puts it in; a real SIGINT delivered by the
 * kernel outside of that window (or before a prompt has attached its own
 * listener) bypasses it entirely and falls through to Node's default,
 * uncatchable-by-`try/catch` termination.
 *
 * Installing this listener for the whole CLI lifetime closes that gap: any
 * Ctrl-C the process receives -- during a prompt or not -- is treated as the
 * user cancelling the operation and reported the same way every other
 * cancellation is: {@link ExitCode.CANCELLED} (4), documented in
 * `AI_ASSISTANT_GUIDE.md` and `docs/configuration.md`. See issue #100.
 *
 * @public
 */
export function registerSigintHandler(): void {
  process.on('SIGINT', () => {
    log('\nCancelled')
    process.exit(ExitCode.CANCELLED)
  })
}

export async function run(): Promise<void> {
  // Catch Ctrl-C for the whole process lifetime before doing anything else
  // that could be interrupted (including a prompt). See issue #100.
  registerSigintHandler()

  // Process --home-dir before anything else (hidden option for testing)
  processHomeDirOption()

  // Check for --version flag before initializing theme or doing other work
  if (process.argv.includes('--version') || process.argv.includes('-V')) {
    console.log(getPackageVersion())
    process.exit(0)
  }

  // Skip theme initialization for completion-server (outputs escape sequences that corrupt completions)
  const isCompletionServer = process.argv.includes('completion-server')
  if (!isCompletionServer) {
    // Initialize theme before any output
    await initTheme()
  }

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
