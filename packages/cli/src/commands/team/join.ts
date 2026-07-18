import { Command } from 'commander'
import { input } from '@inquirer/prompts'
import { loadLocalConfig, getActiveIdentity } from '@attest-it/core'
import { log, success, error, info } from '../../utils/output.js'
import { ExitCode } from '../../utils/exit-codes.js'
import { getTheme } from '../../components/theme.js'
import { resolveOrPrompt, handlePromptableError } from '../../utils/prompts.js'
import {
  resolveGateAuthorization,
  addTeamMemberToPolicy,
  loadPolicyForEdit,
  writePolicyEdit,
} from './utils.js'

interface JoinOptions {
  slug?: string
  gates?: string
}

export const joinCommand = new Command('join')
  .description('Add yourself to the project team using your active identity')
  .option('--slug <slug>', 'Slug to use if your identity slug is already taken by another member')
  .option('--gates <ids>', 'Comma-separated gate IDs to authorize (default: none)')
  .action(async (options: JoinOptions) => {
    await runJoin(options)
  })

/**
 * Run the join command to add the user's active identity to the project team.
 *
 * Interactive by default when stdin is a TTY and flags are omitted. Every
 * prompt is gated behind "flag not supplied AND stdin is an interactive TTY";
 * when stdin is not a TTY and a required value is missing, this fails fast
 * with an error naming the missing flag rather than hanging on a prompt that
 * can never resolve. See issue #80.
 *
 * @public
 */
export async function runJoin(options: JoinOptions = {}): Promise<void> {
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

    // Load project policy (team + gates live in policy.yaml)
    const editablePolicy = loadPolicyForEdit()
    const { policy } = editablePolicy
    const existingTeam = policy.team ?? {}

    // Check if public key already exists
    const existingMemberWithKey = Object.entries(existingTeam).find(
      ([, member]) => member.publicKey === activeIdentity.publicKey,
    )
    if (existingMemberWithKey) {
      error(`You're already a team member as "${existingMemberWithKey[0]}"`)
      process.exit(ExitCode.CONFIG_ERROR)
    }

    // Determine slug - use identity slug if available, resolve if taken
    let slug = activeSlug
    // eslint-disable-next-line security/detect-object-injection -- slug comes from validated config
    if (existingTeam[slug]) {
      log(`Slug "${slug}" is already taken by another team member.`)
      const validateAlternateSlug = (value: string): true | string => {
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
      }
      slug = await resolveOrPrompt(options.slug, '--slug', () =>
        input({ message: 'Choose a different slug:', validate: validateAlternateSlug }),
      )
      const slugValidation = validateAlternateSlug(slug)
      if (slugValidation !== true) {
        throw new Error(slugValidation)
      }
    }

    // Resolve gate authorizations
    log('')
    const authorizedGates = await resolveGateAuthorization(policy.gates, options.gates)

    // Update config with new team member
    const memberData: Parameters<typeof addTeamMemberToPolicy>[2] = {
      name: activeIdentity.name,
      publicKey: activeIdentity.publicKey,
      publicKeyAlgorithm: 'ed25519',
    }
    if (activeIdentity.email) {
      memberData.email = activeIdentity.email
    }
    if (activeIdentity.github) {
      memberData.github = activeIdentity.github
    }
    const updatedPolicy = addTeamMemberToPolicy(policy, slug, memberData, authorizedGates)

    // Write policy back to file, preserving existing comments (issue #102)
    await writePolicyEdit(editablePolicy, updatedPolicy)

    log('')
    success(`Team member "${slug}" added successfully`)

    if (authorizedGates.length > 0) {
      log(`Authorized for gates: ${authorizedGates.join(', ')}`)
    }

    log('')
  } catch (err) {
    handlePromptableError(err, ExitCode.CONFIG_ERROR)
  }
}
