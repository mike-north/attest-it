import { Command } from 'commander'
import { loadSplitConfig } from '@attest-it/core'
import { log, error } from '../../utils/output.js'
import { ExitCode } from '../../utils/exit-codes.js'
import { getTheme } from '../../components/theme.js'

export const listCommand = new Command('list')
  .description('List team members and their authorizations')
  .action(async () => {
    await runList()
  })

/**
 * Run the list command to display all team members.
 */
async function runList(): Promise<void> {
  try {
    const config = await loadSplitConfig()

    if (!config.team || Object.keys(config.team).length === 0) {
      error('No team members configured')
      log('')
      log('Run: attest-it team add')
      process.exit(ExitCode.CONFIG_ERROR)
    }

    const theme = getTheme()
    const teamMembers = Object.entries(config.team)

    log('')
    log(theme.blue.bold()('Team Members:'))
    log('')

    for (const [slug, member] of teamMembers) {
      // Truncate public key for display
      const keyPreview = member.publicKey.slice(0, 12) + '...'

      log(theme.blue(slug))
      log(`  Name:       ${member.name}`)
      if (member.email) {
        log(`  Email:      ${member.email}`)
      }
      if (member.github) {
        log(`  GitHub:     ${member.github}`)
      }
      log(`  Public Key: ${keyPreview}`)

      // Show gate authorizations
      const authorizedGates: string[] = []
      if (config.gates) {
        for (const [gateId, gate] of Object.entries(config.gates)) {
          if (gate.authorizedSigners.includes(slug)) {
            authorizedGates.push(gateId)
          }
        }
      }

      if (authorizedGates.length > 0) {
        log(`  Gates:      ${authorizedGates.join(', ')}`)
      } else {
        log(`  Gates:      ${theme.muted('(none)')}`)
      }

      log('')
    }

    if (teamMembers.length === 1) {
      log(`1 team member configured`)
    } else {
      log(`${teamMembers.length.toString()} team members configured`)
    }
    log('')
  } catch (err) {
    if (err instanceof Error) {
      error(err.message)
    } else {
      error('Unknown error occurred')
    }
    process.exit(ExitCode.CONFIG_ERROR)
  }
}
