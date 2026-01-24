import { Command } from 'commander'
import { input } from '@inquirer/prompts'
import {
  loadConfig,
  toAttestItConfig,
  findConfigPath,
  loadLocalConfig,
  getActiveIdentity,
} from '@attest-it/core'
import { log, success, error, info } from '../../utils/output.js'
import { ExitCode } from '../../utils/exit-codes.js'
import { getTheme } from '../../components/theme.js'
import { writeFile } from 'node:fs/promises'
import { stringify as stringifyYaml } from 'yaml'
import { promptForGateAuthorization, addTeamMemberToConfig } from './utils.js'

export const joinCommand = new Command('join')
  .description('Add yourself to the project team using your active identity')
  .action(async () => {
    await runJoin()
  })

/**
 * Run the join command to add the user's active identity to the project team.
 * @public
 */
export async function runJoin(): Promise<void> {
  try {
    const theme = getTheme()

    log('')
    log(theme.blue.bold()('Join Project Team'))
    log('')

    // Load user's local config and active identity
    const localConfig = await loadLocalConfig()
    if (!localConfig) {
      error('No identity found. Run "attest-it identity create" first.')
      process.exit(ExitCode.CONFIG_ERROR)
    }

    const activeIdentity = getActiveIdentity(localConfig)
    if (!activeIdentity) {
      error('No active identity. Run "attest-it identity use <slug>" to select one.')
      process.exit(ExitCode.CONFIG_ERROR)
    }

    const activeSlug = localConfig.activeIdentity

    info(`Using identity: ${activeSlug}`)
    log(`  Name: ${activeIdentity.name}`)
    log(`  Public Key: ${activeIdentity.publicKey.slice(0, 32)}...`)
    log('')

    // Load project config
    const config = await loadConfig()
    const attestItConfig = toAttestItConfig(config)
    const existingTeam = attestItConfig.team ?? {}

    // Check if public key already exists
    const existingMemberWithKey = Object.entries(existingTeam).find(
      ([, member]) => member.publicKey === activeIdentity.publicKey,
    )
    if (existingMemberWithKey) {
      error(`You're already a team member as "${existingMemberWithKey[0]}"`)
      process.exit(ExitCode.CONFIG_ERROR)
    }

    // Determine slug - use identity slug if available, prompt if taken
    let slug = activeSlug
    // eslint-disable-next-line security/detect-object-injection -- slug comes from validated config
    if (existingTeam[slug]) {
      log(`Slug "${slug}" is already taken by another team member.`)
      slug = await input({
        message: 'Choose a different slug:',
        validate: (value) => {
          if (!value || value.trim().length === 0) {
            return 'Slug cannot be empty'
          }
          if (!/^[a-z0-9-]+$/.test(value)) {
            return 'Slug must contain only lowercase letters, numbers, and hyphens'
          }
          // eslint-disable-next-line security/detect-object-injection -- value is user input being validated
          if (existingTeam[value]) {
            return `Slug "${value}" is already taken`
          }
          return true
        },
      })
    }

    // Prompt for gate authorizations
    log('')
    const authorizedGates = await promptForGateAuthorization(attestItConfig.gates)

    // Update config with new team member
    const updatedConfig = addTeamMemberToConfig(
      config,
      slug,
      {
        name: activeIdentity.name,
        email: activeIdentity.email,
        github: activeIdentity.github,
        publicKey: activeIdentity.publicKey,
        publicKeyAlgorithm: 'ed25519',
      },
      authorizedGates,
    )

    // Write config back to file
    const configPath = findConfigPath()
    if (!configPath) {
      error('Configuration file not found')
      process.exit(ExitCode.CONFIG_ERROR)
    }

    const yamlContent = stringifyYaml(updatedConfig)
    await writeFile(configPath, yamlContent, 'utf8')

    log('')
    success(`Team member "${slug}" added successfully`)

    if (authorizedGates.length > 0) {
      log(`Authorized for gates: ${authorizedGates.join(', ')}`)
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
