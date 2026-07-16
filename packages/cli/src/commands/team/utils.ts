import { readFileSync } from 'node:fs'
import { checkbox } from '@inquirer/prompts'
import { findPolicyPath, parsePolicyContent, type PolicyConfig } from '@attest-it/core'

/**
 * Load the policy configuration for editing.
 *
 * Team members and gates are trust-critical and live in `.attest-it/policy.yaml`.
 * Team commands read, mutate, and write this file directly.
 *
 * @returns The parsed policy config and the path it was loaded from.
 * @throws If no policy file is found.
 * @public
 */
export function loadPolicyForEdit(): { policy: PolicyConfig; path: string } {
  const path = findPolicyPath()
  if (!path) {
    throw new Error(
      'Policy file not found. Expected .attest-it/policy.yaml. Run "attest-it init" to create one.',
    )
  }
  const content = readFileSync(path, 'utf8')
  const format = path.endsWith('.json') ? 'json' : 'yaml'
  const policy = parsePolicyContent(content, format)
  return { policy, path }
}

/**
 * Prompt the user to select which gates they want to authorize for a team member.
 *
 * @param gates - The gates configuration from the policy file
 * @returns Array of gate IDs that were selected
 * @public
 */
export async function promptForGateAuthorization(
  gates: PolicyConfig['gates'] | undefined,
): Promise<string[]> {
  // If no gates exist, return empty array
  if (!gates || Object.keys(gates).length === 0) {
    return []
  }

  const gateChoices = Object.entries(gates).map(([gateId, gate]) => ({
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
 * Add a team member to the policy and update gate authorizations.
 *
 * @param policy - The existing policy config
 * @param memberSlug - The slug/identifier for the team member
 * @param memberData - The team member data to add
 * @param authorizedGates - Array of gate IDs to authorize the member for
 * @returns Updated policy with the team member added and gates updated
 * @public
 */
export function addTeamMemberToPolicy(
  policy: PolicyConfig,
  memberSlug: string,
  memberData: {
    name: string
    email?: string
    github?: string
    publicKey: string
    publicKeyAlgorithm?: 'ed25519'
  },
  authorizedGates: string[],
): PolicyConfig {
  const existingTeam = policy.team ?? {}

  // Build the updated policy with the new team member
  const updatedPolicy: PolicyConfig = {
    ...policy,
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
  if (authorizedGates.length > 0 && updatedPolicy.gates) {
    for (const gateId of authorizedGates) {
      // eslint-disable-next-line security/detect-object-injection
      const gate = updatedPolicy.gates[gateId]
      if (gate) {
        // Add to authorizedSigners if not already present
        if (!gate.authorizedSigners.includes(memberSlug)) {
          gate.authorizedSigners.push(memberSlug)
        }
      }
    }
  }

  return updatedPolicy
}
