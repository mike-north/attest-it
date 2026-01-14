import { Command } from 'commander'
import tabtab from '@pnpm/tabtab'
import { loadLocalConfig, loadConfig } from '@attest-it/core'
import { success, error, log, info } from '../utils/output.js'
import { ExitCode } from '../utils/exit-codes.js'

const PROGRAM_NAME = 'attest-it'

type SupportedShell = 'bash' | 'zsh' | 'fish'

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
    { name: 'keygen', description: 'Generate a new keypair' },
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
    { name: '--config', description: 'Path to config file' },
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
  const commandIndex = words.findIndex(
    (w: string) => !w.startsWith('-') && w !== PROGRAM_NAME && w !== 'npx',
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
  if (!currentCommand) {
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
    const config = await loadConfig()
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
    const config = await loadConfig()
    return Object.keys(config.suites)
  } catch {
    // Ignore errors - completions should fail silently
  }
  return []
}

export const completionCommand = new Command('completion').description('Shell completion commands')

// Install subcommand
completionCommand
  .command('install [shell]')
  .description('Install shell completion (bash, zsh, or fish)')
  .action(async (shellArg?: string) => {
    try {
      // Validate and narrow shell type
      let shell: 'bash' | 'zsh' | 'fish' | 'pwsh' | undefined
      if (shellArg !== undefined) {
        if (tabtab.isShellSupported(shellArg)) {
          shell = shellArg
        } else {
          error(`Shell "${shellArg}" is not supported. Use bash, zsh, or fish.`)
          process.exit(ExitCode.CONFIG_ERROR)
        }
      }

      await tabtab.install({
        name: PROGRAM_NAME,
        completer: PROGRAM_NAME,
        shell,
      })

      log('')
      success('Shell completion installed!')
      log('')
      info('Restart your shell or run:')
      if (shell === 'bash' || !shell) {
        log('  source ~/.bashrc')
      }
      if (shell === 'zsh' || !shell) {
        log('  source ~/.zshrc')
      }
      if (shell === 'fish' || !shell) {
        log('  source ~/.config/fish/config.fish')
      }
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
      await tabtab.uninstall({
        name: PROGRAM_NAME,
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
  return new Command('completion-server').action(async () => {
    const env = tabtab.parseEnv(process.env)
    if (env.complete) {
      await getCompletions(env)
    }
  })
}
