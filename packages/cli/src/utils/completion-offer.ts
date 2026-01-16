/**
 * Utility to offer shell completion installation to users.
 * @packageDocumentation
 */

import { confirm } from '@inquirer/prompts'
import { loadPreferences, savePreferences } from '@attest-it/core'
import { log, info, success, error } from './output.js'
import tabtab from '@pnpm/tabtab'

/** Primary program name */
const PROGRAM_NAME = 'attest-it'
/** Short alias for the program */
const PROGRAM_ALIAS = 'attest'

type SupportedShell = 'bash' | 'zsh' | 'fish'

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

/**
 * Offer to install shell completions if the user hasn't declined before.
 * Should be called at the end of init and identity create commands.
 *
 * @returns true if completions were installed, false otherwise
 */
export async function offerCompletionInstall(): Promise<boolean> {
  try {
    // Check if user has already declined
    const prefs = await loadPreferences()
    if (prefs.cliExperience?.declinedCompletionInstall) {
      return false
    }

    // Detect shell
    const shell = detectCurrentShell()
    if (!shell) {
      // Can't detect shell, skip the offer
      return false
    }

    // Ask user if they want to install completions
    log('')
    const shouldInstall = await confirm({
      message: `Would you like to enable shell completions for ${shell}?`,
      default: true,
    })

    if (!shouldInstall) {
      // Save preference that user declined
      await savePreferences({
        ...prefs,
        cliExperience: {
          ...prefs.cliExperience,
          declinedCompletionInstall: true,
        },
      })

      log('')
      info('No problem! If you change your mind, you can run:')
      log('  attest-it completion install')
      log('')
      return false
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
    success(`Shell completions installed for ${shell}!`)
    info(`Completions enabled for both "${PROGRAM_NAME}" and "${PROGRAM_ALIAS}" commands.`)
    log('')
    info('Restart your shell or run:')
    log(`  ${getSourceCommand(shell)}`)
    log('')

    return true
  } catch (err) {
    // Don't let completion errors fail the main command
    error(`Failed to install completions: ${err instanceof Error ? err.message : String(err)}`)
    log('')
    info('You can try again later with:')
    log('  attest-it completion install')
    log('')
    return false
  }
}
