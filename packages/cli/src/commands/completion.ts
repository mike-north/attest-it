import { Command } from 'commander'
import tabtab from '@pnpm/tabtab'
import { loadLocalConfig, loadSplitConfig } from '@attest-it/core'
import { success, error, log, info } from '../utils/output.js'
import { ExitCode } from '../utils/exit-codes.js'

/** Primary program name */
const PROGRAM_NAME = 'attest-it'
/** Short alias for the program */
const PROGRAM_ALIAS = 'attest'
/** All valid program names for completion context detection */
const PROGRAM_NAMES = [PROGRAM_NAME, PROGRAM_ALIAS]

type SupportedShell = 'bash' | 'zsh' | 'fish'

function isSupportedShell(value: string): value is SupportedShell {
  return value === 'bash' || value === 'zsh' || value === 'fish'
}

/**
 * Get completions based on the current completion context.
 */
async function getCompletions(env: tabtab.ParseEnvResult): Promise<void> {
  let shell: SupportedShell
  try {
    const detectedShell = tabtab.getShellFromEnv(process.env)
    // Only use bash, zsh, fish (not pwsh)
    shell = detectedShell === 'pwsh' ? 'bash' : detectedShell
  } catch {
    // If SHELL isn't set properly, default to bash-compatible output
    shell = 'bash'
  }

  // Top-level commands
  const commands: tabtab.CompletionItem[] = [
    { name: 'init', description: 'Initialize a new config file' },
    { name: 'status', description: 'Show status of all gates' },
    { name: 'run', description: 'Run test suites interactively' },
    { name: 'verify', description: 'Verify all seals are valid' },
    { name: 'seal', description: 'Create a seal for a gate' },
    { name: 'prune', description: 'Remove stale attestations' },
    { name: 'identity', description: 'Manage identities' },
    { name: 'team', description: 'Manage team members' },
    { name: 'whoami', description: 'Show active identity' },
    { name: 'completion', description: 'Shell completion commands' },
  ]

  // Global options
  const globalOptions: tabtab.CompletionItem[] = [
    { name: '--help', description: 'Show help' },
    { name: '--version', description: 'Show version' },
    { name: '--verbose', description: 'Verbose output' },
    { name: '--quiet', description: 'Minimal output' },
    { name: '--config', description: 'Path to policy config file (overrides auto-detection)' },
  ]

  // Identity subcommands
  const identitySubcommands: tabtab.CompletionItem[] = [
    { name: 'create', description: 'Create a new identity' },
    { name: 'list', description: 'List all identities' },
    { name: 'use', description: 'Switch active identity' },
    { name: 'remove', description: 'Remove an identity' },
  ]

  // Team subcommands
  const teamSubcommands: tabtab.CompletionItem[] = [
    { name: 'add', description: 'Add yourself to the team' },
    { name: 'list', description: 'List team members' },
    { name: 'remove', description: 'Remove a team member' },
  ]

  // Completion subcommands
  const completionSubcommands: tabtab.CompletionItem[] = [
    { name: 'install', description: 'Install shell completion' },
    { name: 'uninstall', description: 'Uninstall shell completion' },
  ]

  // Parse the command line to understand context
  const words: string[] = env.line.split(/\s+/).filter(Boolean)
  const lastWord: string = env.last
  const prevWord: string = env.prev

  // If completing an option value
  if (prevWord === '--config' || prevWord === '-c') {
    // Let shell handle file completion
    tabtab.logFiles()
    return
  }

  // If typing an option
  if (lastWord.startsWith('-')) {
    tabtab.log(globalOptions, shell, console.log)
    return
  }

  // Determine which command we're in
  // Skip program names (attest-it, attest) and npx
  const commandIndex = words.findIndex(
    (w: string) => !w.startsWith('-') && !PROGRAM_NAMES.includes(w) && w !== 'npx',
  )
  const currentCommand: string | null = commandIndex >= 0 ? (words[commandIndex] ?? null) : null

  // Handle subcommand completions
  if (currentCommand === 'identity') {
    const subcommandIndex = words.findIndex(
      (w: string, i: number) => i > commandIndex && !w.startsWith('-'),
    )
    const subcommand: string | null = subcommandIndex >= 0 ? (words[subcommandIndex] ?? null) : null

    if (subcommand === 'use' || subcommand === 'remove') {
      // Complete with identity slugs
      const identities = await getIdentitySlugs()
      if (identities.length > 0) {
        tabtab.log(identities, shell, console.log)
        return
      }
    }

    if (!subcommand || subcommandIndex < 0) {
      tabtab.log(identitySubcommands, shell, console.log)
      return
    }
  }

  if (currentCommand === 'team') {
    const subcommandIndex = words.findIndex(
      (w: string, i: number) => i > commandIndex && !w.startsWith('-'),
    )
    const subcommand: string | null = subcommandIndex >= 0 ? (words[subcommandIndex] ?? null) : null

    if (!subcommand || subcommandIndex < 0) {
      tabtab.log(teamSubcommands, shell, console.log)
      return
    }
  }

  if (currentCommand === 'completion') {
    const subcommandIndex = words.findIndex(
      (w: string, i: number) => i > commandIndex && !w.startsWith('-'),
    )
    const subcommand: string | null = subcommandIndex >= 0 ? (words[subcommandIndex] ?? null) : null

    if (subcommand === 'install') {
      // Complete with shell names
      tabtab.log(['bash', 'zsh', 'fish'], shell, console.log)
      return
    }

    if (!subcommand || subcommandIndex < 0) {
      tabtab.log(completionSubcommands, shell, console.log)
      return
    }
  }

  // Commands that take a gate name as argument
  if (currentCommand === 'status' || currentCommand === 'verify' || currentCommand === 'seal') {
    const gates = await getGateNames()
    if (gates.length > 0) {
      tabtab.log(gates, shell, console.log)
      return
    }
  }

  // Commands that take a suite name as argument
  if (currentCommand === 'run') {
    const suites = await getSuiteNames()
    if (suites.length > 0) {
      tabtab.log(suites, shell, console.log)
      return
    }
  }

  // Default: show top-level commands
  // This handles both:
  // 1. No command typed yet (e.g., "attest-it ")
  // 2. Partial/unknown command being typed (e.g., "attest-it ini")
  // The shell will filter by prefix for partial matches
  const knownCommands = [
    'init',
    'status',
    'run',
    'verify',
    'seal',
    'prune',
    'identity',
    'team',
    'whoami',
    'completion',
  ]
  if (!currentCommand || !knownCommands.includes(currentCommand)) {
    tabtab.log([...commands, ...globalOptions], shell, console.log)
  }
}

/**
 * Get identity slugs from local config.
 */
async function getIdentitySlugs(): Promise<string[]> {
  try {
    const config = await loadLocalConfig()
    if (config?.identities) {
      return Object.keys(config.identities)
    }
  } catch {
    // Ignore errors - completions should fail silently
  }
  return []
}

/**
 * Get gate names from project config.
 */
async function getGateNames(): Promise<string[]> {
  try {
    const config = await loadSplitConfig()
    if (config.gates) {
      return Object.keys(config.gates)
    }
  } catch {
    // Ignore errors - completions should fail silently
  }
  return []
}

/**
 * Get suite names from project config.
 */
async function getSuiteNames(): Promise<string[]> {
  try {
    const config = await loadSplitConfig()
    return Object.keys(config.suites)
  } catch {
    // Ignore errors - completions should fail silently
  }
  return []
}

export const completionCommand = new Command('completion').description('Shell completion commands')

/**
 * Detect the user's current shell from the SHELL environment variable.
 */
function detectCurrentShell(): SupportedShell | null {
  const shellPath = process.env.SHELL ?? ''
  if (shellPath.endsWith('/bash') || shellPath.endsWith('/bash.exe')) {
    return 'bash'
  }
  if (shellPath.endsWith('/zsh') || shellPath.endsWith('/zsh.exe')) {
    return 'zsh'
  }
  if (shellPath.endsWith('/fish') || shellPath.endsWith('/fish.exe')) {
    return 'fish'
  }
  return null
}

/**
 * Get the source command for reloading a shell's config.
 */
function getSourceCommand(shell: SupportedShell): string {
  switch (shell) {
    case 'bash':
      return 'source ~/.bashrc'
    case 'zsh':
      return 'source ~/.zshrc'
    case 'fish':
      return 'source ~/.config/fish/config.fish'
  }
}

// Install subcommand
completionCommand
  .command('install [shell]')
  .description('Install shell completion (auto-detects shell, or specify bash/zsh/fish)')
  .action(async (shellArg?: string) => {
    try {
      let shell: SupportedShell

      if (shellArg !== undefined) {
        // User explicitly specified a shell
        if (!isSupportedShell(shellArg)) {
          error(`Shell "${shellArg}" is not supported. Use bash, zsh, or fish.`)
          process.exit(ExitCode.CONFIG_ERROR)
        }
        shell = shellArg
      } else {
        // Auto-detect from SHELL environment variable
        const detected = detectCurrentShell()
        if (!detected) {
          error(
            'Could not detect your shell. Please specify: attest-it completion install <bash|zsh|fish>',
          )
          process.exit(ExitCode.CONFIG_ERROR)
        }
        shell = detected
        info(`Detected shell: ${shell}`)
      }

      // Install completions for both program names (attest-it and attest)
      await tabtab.install({
        name: PROGRAM_NAME,
        completer: PROGRAM_NAME,
        shell,
      })
      await tabtab.install({
        name: PROGRAM_ALIAS,
        completer: PROGRAM_ALIAS,
        shell,
      })

      log('')
      success(`Shell completion installed for ${shell}!`)
      info(`Completions enabled for both "${PROGRAM_NAME}" and "${PROGRAM_ALIAS}" commands.`)
      log('')
      info('Restart your shell or run:')
      log(`  ${getSourceCommand(shell)}`)
      log('')
    } catch (err) {
      error(`Failed to install completion: ${err instanceof Error ? err.message : String(err)}`)
      process.exit(ExitCode.CONFIG_ERROR)
    }
  })

// Uninstall subcommand
completionCommand
  .command('uninstall')
  .description('Uninstall shell completion')
  .action(async () => {
    try {
      // Uninstall completions for both program names
      await tabtab.uninstall({
        name: PROGRAM_NAME,
      })
      await tabtab.uninstall({
        name: PROGRAM_ALIAS,
      })

      log('')
      success('Shell completion uninstalled!')
      log('')
    } catch (err) {
      error(`Failed to uninstall completion: ${err instanceof Error ? err.message : String(err)}`)
      process.exit(ExitCode.CONFIG_ERROR)
    }
  })

// Hidden server subcommand (called by shell for completions)
// Note: This is kept for backwards compatibility, but tabtab actually
// calls `attest-it completion-server` (with hyphen) at the top level.
completionCommand
  .command('server', { hidden: true })
  .description('Completion server (internal)')
  .action(async () => {
    const env = tabtab.parseEnv(process.env)
    if (env.complete) {
      await getCompletions(env)
    }
  })

/**
 * Hidden top-level command called by tabtab for shell completions.
 * tabtab expects `<program> completion-server` (with hyphen) at the root.
 *
 * We create this dynamically as a function so it can be added with { hidden: true }
 * option when registering with the parent command.
 */
export function createCompletionServerCommand(): Command {
  return new Command('completion-server')
    .allowUnknownOption()
    .allowExcessArguments(true)
    .action(async () => {
      const env = tabtab.parseEnv(process.env)
      if (env.complete) {
        await getCompletions(env)
      }
    })
}
