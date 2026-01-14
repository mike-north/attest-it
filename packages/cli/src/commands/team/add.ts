import { Command } from 'commander'
import { input, checkbox } from '@inquirer/prompts'
import { loadConfig, toAttestItConfig, findConfigPath } from '@attest-it/core'
import type { Config, TeamMember } from '@attest-it/core'
import { log, success, error } from '../../utils/output.js'
import { ExitCode } from '../../utils/exit-codes.js'
import { getTheme } from '../../components/theme.js'
import { writeFile } from 'node:fs/promises'
import { stringify as stringifyYaml } from 'yaml'

export const addCommand = new Command('add')
  .description('Add a new team member')
  .action(async () => {
    await runAdd()
  })

/**
 * Validate Base64 encoded Ed25519 public key.
 * Ed25519 public keys are 32 bytes, which is 44 characters in Base64.
 */
function validatePublicKey(value: string): boolean | string {
  if (!value || value.trim().length === 0) {
    return 'Public key cannot be empty'
  }

  // Check if it's valid Base64
  const base64Regex = /^[A-Za-z0-9+/]+=*$/
  if (!base64Regex.test(value)) {
    return 'Public key must be valid Base64'
  }

  // Check length - Ed25519 public keys are 32 bytes = 44 chars in base64 (with padding)
  if (value.length !== 44) {
    return 'Public key must be 44 characters (32 bytes in Base64)'
  }

  // Try to decode to verify it's valid Base64
  try {
    const decoded = Buffer.from(value, 'base64')
    if (decoded.length !== 32) {
      return 'Public key must decode to 32 bytes'
    }
  } catch {
    return 'Invalid Base64 encoding'
  }

  return true
}

/**
 * Run the add command to interactively add a team member.
 */
async function runAdd(): Promise<void> {
  try {
    const theme = getTheme()

    log('')
    log(theme.blue.bold()('Add Team Member'))
    log('')

    // Load existing config
    const config = await loadConfig()
    const attestItConfig = toAttestItConfig(config)
    const existingTeam = attestItConfig.team ?? {}

    // Prompt for member details
    const slug = await input({
      message: 'Member slug (unique identifier):',
      validate: (value) => {
        if (!value || value.trim().length === 0) {
          return 'Slug cannot be empty'
        }
        if (!/^[a-z0-9-]+$/.test(value)) {
          return 'Slug must contain only lowercase letters, numbers, and hyphens'
        }
        // eslint-disable-next-line security/detect-object-injection
        if (existingTeam[value]) {
          return `Team member "${value}" already exists`
        }
        return true
      },
    })

    const name = await input({
      message: 'Display name:',
      validate: (value) => {
        if (!value || value.trim().length === 0) {
          return 'Name cannot be empty'
        }
        return true
      },
    })

    const email = await input({
      message: 'Email (optional):',
      default: '',
    })

    const github = await input({
      message: 'GitHub username (optional):',
      default: '',
    })

    log('')
    log('Paste the public key (from "attest-it identity export"):')
    const publicKey = await input({
      message: 'Public key:',
      validate: validatePublicKey,
    })

    // Prompt for gate authorizations
    let authorizedGates: string[] = []
    if (attestItConfig.gates && Object.keys(attestItConfig.gates).length > 0) {
      log('')
      const gateChoices = Object.entries(attestItConfig.gates).map(([gateId, gate]) => ({
        name: `${gateId} - ${gate.name}`,
        value: gateId,
      }))

      authorizedGates = await checkbox({
        message: 'Select gates to authorize (use space to select):',
        choices: gateChoices,
      })
    }

    // Build team member object
    const teamMember: TeamMember = {
      name,
      publicKey: publicKey.trim(),
    }

    if (email && email.trim().length > 0) {
      teamMember.email = email.trim()
    }

    if (github && github.trim().length > 0) {
      teamMember.github = github.trim()
    }

    // Update config
    const updatedConfig: Config = {
      ...config,
      team: {
        ...existingTeam,
        [slug]: teamMember,
      },
    }

    // Update gate authorizations
    if (authorizedGates.length > 0 && updatedConfig.gates) {
      for (const gateId of authorizedGates) {
        // eslint-disable-next-line security/detect-object-injection
        const gate = updatedConfig.gates[gateId]
        if (gate) {
          // Add to authorizedSigners if not already present
          if (!gate.authorizedSigners.includes(slug)) {
            gate.authorizedSigners.push(slug)
          }
        }
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
