import { Command } from 'commander'
import { input, confirm, checkbox } from '@inquirer/prompts'
import { loadConfig, toAttestItConfig, findConfigPath } from '@attest-it/core'
import type { Config, TeamMember } from '@attest-it/core'
import { log, success, error } from '../../utils/output.js'
import { ExitCode } from '../../utils/exit-codes.js'
import { getTheme } from '../../components/theme.js'
import { writeFile } from 'node:fs/promises'
import { stringify as stringifyYaml } from 'yaml'

export const editCommand = new Command('edit')
  .description('Edit a team member')
  .argument('<slug>', 'Team member slug to edit')
  .action(async (slug: string) => {
    await runEdit(slug)
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
 * Run the edit command to modify an existing team member.
 */
async function runEdit(slug: string): Promise<void> {
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
    log(theme.blue.bold()(`Edit Team Member: ${slug}`))
    log('')
    log(theme.muted('Leave blank to keep current value'))
    log('')

    // Prompt for updated details
    const name = await input({
      message: 'Display name:',
      default: existingMember.name,
      validate: (value) => {
        if (!value || value.trim().length === 0) {
          return 'Name cannot be empty'
        }
        return true
      },
    })

    const email = await input({
      message: 'Email (optional):',
      default: existingMember.email ?? '',
    })

    const github = await input({
      message: 'GitHub username (optional):',
      default: existingMember.github ?? '',
    })

    // Ask if they want to update the public key
    const updateKey = await confirm({
      message: 'Update public key?',
      default: false,
    })

    let publicKey = existingMember.publicKey
    if (updateKey) {
      log('')
      log('Paste the new public key:')
      publicKey = await input({
        message: 'Public key:',
        default: existingMember.publicKey,
        validate: validatePublicKey,
      })
    }

    // Get current gate authorizations
    const currentGates: string[] = []
    if (attestItConfig.gates) {
      for (const [gateId, gate] of Object.entries(attestItConfig.gates)) {
        if (gate.authorizedSigners.includes(slug)) {
          currentGates.push(gateId)
        }
      }
    }

    // Prompt for gate authorizations
    let selectedGates: string[] = currentGates
    if (attestItConfig.gates && Object.keys(attestItConfig.gates).length > 0) {
      log('')
      const gateChoices = Object.entries(attestItConfig.gates).map(([gateId, gate]) => ({
        name: `${gateId} - ${gate.name}`,
        value: gateId,
        checked: currentGates.includes(gateId),
      }))

      selectedGates = await checkbox({
        message: 'Select gates to authorize (use space to select):',
        choices: gateChoices,
      })
    }

    // Build updated team member object
    const updatedMember: TeamMember = {
      name: name.trim(),
      publicKey: publicKey.trim(),
    }

    if (email && email.trim().length > 0) {
      updatedMember.email = email.trim()
    }

    if (github && github.trim().length > 0) {
      updatedMember.github = github.trim()
    }

    // Update config
    const updatedConfig: Config = {
      ...config,
      team: {
        ...attestItConfig.team,
        [slug]: updatedMember,
      },
    }

    // Update gate authorizations
    if (updatedConfig.gates) {
      for (const [gateId, gate] of Object.entries(updatedConfig.gates)) {
        // Remove from gates that are no longer selected
        if (currentGates.includes(gateId) && !selectedGates.includes(gateId)) {
          gate.authorizedSigners = gate.authorizedSigners.filter((s) => s !== slug)
        }

        // Add to gates that are newly selected
        if (!currentGates.includes(gateId) && selectedGates.includes(gateId)) {
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
    success(`Team member "${slug}" updated successfully`)

    if (selectedGates.length > 0) {
      log(`Authorized for gates: ${selectedGates.join(', ')}`)
    } else {
      log('Not authorized for any gates')
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
