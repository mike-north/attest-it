import { readFileSync } from 'node:fs'
import { checkbox } from '@inquirer/prompts'
import { findPolicyPath, parsePolicyContent, type PolicyConfig } from '@attest-it/core'
import { isInteractiveTTY } from '../../utils/prompts.js'

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
 * Resolve which gates to authorize for a team member, from a `--gates` flag,
 * an interactive checkbox prompt, or neither.
 *
 * @remarks
 * Gate authorization is optional (a team member can be added with no gates
 * authorized), so a missing `--gates` flag in a non-interactive context is
 * not an error -- it resolves to an empty array rather than failing fast.
 *
 * @param gates - The gates configuration from the policy file
 * @param gatesFlag - Comma-separated gate IDs from a `--gates` flag, if supplied
 * @returns Array of gate IDs to authorize
 * @throws Error if `gatesFlag` names a gate ID that does not exist
 * @public
 */
export async function resolveGateAuthorization(
  gates: PolicyConfig['gates'] | undefined,
  gatesFlag?: string,
): Promise<string[]> {
  if (!gates || Object.keys(gates).length === 0) {
    return []
  }

  if (gatesFlag !== undefined) {
    const requested = gatesFlag
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0)
    // eslint-disable-next-line security/detect-object-injection -- id is validated below via the resulting `unknown` list before use
    const unknown = requested.filter((id) => !gates[id])
    if (unknown.length > 0) {
      throw new Error(
        `--gates references unknown gate(s): ${unknown.join(', ')}. Known gates: ${Object.keys(gates).join(', ')}`,
      )
    }
    return requested
  }

  if (!isInteractiveTTY()) {
    return []
  }

  return promptForGateAuthorization(gates)
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
