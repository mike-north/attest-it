import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { checkbox } from '@inquirer/prompts'
import {
  findPolicyPath,
  loadEditablePolicy,
  serializeEditablePolicy,
  type EditablePolicy,
  type PolicyConfig,
} from '@attest-it/core'
import { isInteractiveTTY } from '../../utils/prompts.js'

/**
 * Load the policy configuration for editing.
 *
 * Team members and gates are trust-critical and live in `.attest-it/policy.yaml`.
 * Team commands read, mutate, and write this file directly.
 *
 * The returned {@link EditablePolicy} retains enough state (a parsed YAML
 * document, for `.yaml`/`.yml` files) to write updates back via
 * {@link writePolicyEdit} without losing comments -- including the
 * `# yaml-language-server:` schema directive and any human-authored
 * annotations. See issue #102.
 *
 * @returns The editable policy: parsed policy config, the path it was
 * loaded from, and document state needed for a comment-preserving write.
 * @throws If no policy file is found.
 * @public
 */
export function loadPolicyForEdit(): EditablePolicy {
  const path = findPolicyPath()
  if (!path) {
    throw new Error(
      'Policy file not found. Expected .attest-it/policy.yaml. Run "attest-it init" to create one.',
    )
  }
  const content = readFileSync(path, 'utf8')
  return loadEditablePolicy(path, content)
}

/**
 * Write an updated policy back to disk, preserving existing comments (and the
 * `# yaml-language-server:` schema directive) wherever possible.
 *
 * @param editable - The policy as loaded by {@link loadPolicyForEdit}.
 * @param updatedPolicy - The new policy value to persist.
 * @public
 */
export async function writePolicyEdit(
  editable: EditablePolicy,
  updatedPolicy: PolicyConfig,
): Promise<void> {
  const content = serializeEditablePolicy(editable, updatedPolicy)
  await writeFile(editable.path, content, 'utf8')
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
    const unknown = requested.filter((id) => !Object.hasOwn(gates, id))
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
 * @remarks
 * Builds an entirely new `gates` object rather than mutating
 * `policy.gates`/`gate.authorizedSigners` in place. The input `policy` is
 * also the "before" snapshot {@link writePolicyEdit} diffs against to decide
 * which sections of the on-disk YAML document need to change; mutating
 * shared gate objects in place would corrupt that snapshot (since
 * `{ ...policy, team: {...} }` keeps the same `gates` object reference) and
 * make every gate look unchanged even when an `authorizedSigners` array was
 * just pushed into. See issue #102.
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

  const updatedGates = policy.gates
    ? Object.fromEntries(
        Object.entries(policy.gates).map(([gateId, gate]) => {
          if (authorizedGates.includes(gateId) && !gate.authorizedSigners.includes(memberSlug)) {
            return [gateId, { ...gate, authorizedSigners: [...gate.authorizedSigners, memberSlug] }]
          }
          return [gateId, gate]
        }),
      )
    : policy.gates

  return {
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
    gates: updatedGates,
  }
}
