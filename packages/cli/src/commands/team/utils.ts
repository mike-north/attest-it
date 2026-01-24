import { checkbox } from '@inquirer/prompts'
import type { Config, GateConfig } from '@attest-it/core'

/**
 * Prompt the user to select which gates they want to authorize for a team member.
 *
 * @param gates - The gates configuration from the config file
 * @returns Array of gate IDs that were selected
 * @public
 */
export async function promptForGateAuthorization(
  gates: Record<string, GateConfig> | undefined,
): Promise<string[]> {
  // If no gates exist, return empty array
  if (!gates || Object.keys(gates).length === 0) {
    return []
  }

  const gateChoices = Object.entries(gates).map(([gateId, gate]: [string, GateConfig]) => ({
    name: `${gateId} - ${gate.name}`,
    value: gateId,
  }))

  const authorizedGates = await checkbox({
    message: 'Select gates to authorize (use space to select):',
    choices: gateChoices,
  })

  return authorizedGates
}

/**
 * Add a team member to the config and update gate authorizations.
 *
 * @param config - The existing config
 * @param memberSlug - The slug/identifier for the team member
 * @param memberData - The team member data to add
 * @param authorizedGates - Array of gate IDs to authorize the member for
 * @returns Updated config with the team member added and gates updated
 * @public
 */
export function addTeamMemberToConfig(
  config: Config,
  memberSlug: string,
  memberData: {
    name: string
    email?: string
    github?: string
    publicKey: string
    publicKeyAlgorithm?: 'ed25519'
  },
  authorizedGates: string[],
): Config {
  const existingTeam = config.team ?? {}

  // Build the updated config with the new team member
  const updatedConfig: Config = {
    ...config,
    team: {
      ...existingTeam,
      [memberSlug]: {
        name: memberData.name,
        publicKey: memberData.publicKey,
        publicKeyAlgorithm: memberData.publicKeyAlgorithm ?? 'ed25519',
        ...(memberData.email ? { email: memberData.email } : {}),
        ...(memberData.github ? { github: memberData.github } : {}),
      },
    },
  }

  // Update gate authorizations
  if (authorizedGates.length > 0 && updatedConfig.gates) {
    for (const gateId of authorizedGates) {
      // eslint-disable-next-line security/detect-object-injection
      const gate = updatedConfig.gates[gateId]
      if (gate) {
        // Add to authorizedSigners if not already present
        if (!gate.authorizedSigners.includes(memberSlug)) {
          gate.authorizedSigners.push(memberSlug)
        }
      }
    }
  }

  return updatedConfig
}
