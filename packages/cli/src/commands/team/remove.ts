import { Command } from 'commander'
import { confirm } from '@inquirer/prompts'
import { loadConfig, toAttestItConfig, findConfigPath, readSealsSync } from '@attest-it/core'
import type { Config } from '@attest-it/core'
import { log, success, error, warn } from '../../utils/output.js'
import { ExitCode } from '../../utils/exit-codes.js'
import { getTheme } from '../../components/theme.js'
import { writeFile } from 'node:fs/promises'
import { stringify as stringifyYaml } from 'yaml'

export const removeCommand = new Command('remove')
  .description('Remove a team member')
  .argument('<slug>', 'Team member slug to remove')
  .option('-f, --force', 'Skip confirmation prompt')
  .action(async (slug: string, options: { force?: boolean }) => {
    await runRemove(slug, options)
  })

/**
 * Run the remove command to delete a team member.
 */
async function runRemove(slug: string, options: { force?: boolean }): Promise<void> {
  try {
    const theme = getTheme()

    // Load existing config
    const config = await loadConfig()
    const attestItConfig = toAttestItConfig(config)

    // Check if member exists
    // eslint-disable-next-line security/detect-object-injection
    const existingMember = attestItConfig.team?.[slug]
    if (!existingMember) {
      error(`Team member "${slug}" not found`)
      process.exit(ExitCode.CONFIG_ERROR)
    }

    log('')
    log(theme.blue.bold()(`Remove Team Member: ${slug}`))
    log('')
    log(`Name: ${existingMember.name}`)
    if (existingMember.email) {
      log(`Email: ${existingMember.email}`)
    }
    if (existingMember.github) {
      log(`GitHub: ${existingMember.github}`)
    }
    log('')

    // Check for existing seals by this member
    const projectRoot = process.cwd()
    let sealsFile
    try {
      sealsFile = readSealsSync(projectRoot)
    } catch {
      // No seals file exists yet
      sealsFile = { version: 1, seals: {} }
    }

    const sealsCreatedByMember: string[] = []
    for (const [gateId, seal] of Object.entries(sealsFile.seals)) {
      if (seal.sealedBy === slug) {
        sealsCreatedByMember.push(gateId)
      }
    }

    if (sealsCreatedByMember.length > 0) {
      warn('This member has created seals for the following gates:')
      for (const gateId of sealsCreatedByMember) {
        warn(`  - ${gateId}`)
      }
      log('')
      warn('These seals will still be valid but attributed to a removed member.')
      log('')
    }

    // Get gates this member is authorized for
    const authorizedGates: string[] = []
    if (attestItConfig.gates) {
      for (const [gateId, gate] of Object.entries(attestItConfig.gates)) {
        if (gate.authorizedSigners.includes(slug)) {
          authorizedGates.push(gateId)
        }
      }
    }

    if (authorizedGates.length > 0) {
      log('This member is authorized for the following gates:')
      for (const gateId of authorizedGates) {
        log(`  - ${gateId}`)
      }
      log('')
    }

    // Confirm removal
    if (!options.force) {
      const confirmed = await confirm({
        message: `Are you sure you want to remove "${slug}"?`,
        default: false,
      })

      if (!confirmed) {
        error('Removal cancelled')
        process.exit(ExitCode.CANCELLED)
      }
    }

    // Remove from team
    const updatedTeam = { ...attestItConfig.team }
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete, security/detect-object-injection
    delete updatedTeam[slug]

    // Update config
    const updatedConfig: Config = {
      ...config,
      team: updatedTeam,
    }

    // Remove from all gate authorizations
    if (updatedConfig.gates) {
      for (const gate of Object.values(updatedConfig.gates)) {
        gate.authorizedSigners = gate.authorizedSigners.filter((s) => s !== slug)
      }
    }

    // Write config back to file
    const configPath = findConfigPath()
    if (!configPath) {
      error('Configuration file not found')
      process.exit(ExitCode.CONFIG_ERROR)
    }

    const yamlContent = stringifyYaml(updatedConfig)
    await writeFile(configPath, yamlContent, 'utf8')

    log('')
    success(`Team member "${slug}" removed successfully`)
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

export { runRemove }
