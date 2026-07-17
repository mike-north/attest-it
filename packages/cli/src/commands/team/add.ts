import { Command } from 'commander'
import { input } from '@inquirer/prompts'
import { log, success } from '../../utils/output.js'
import { ExitCode } from '../../utils/exit-codes.js'
import { getTheme } from '../../components/theme.js'
import { writeFile } from 'node:fs/promises'
import { stringify as stringifyYaml } from 'yaml'
import { resolveOrPrompt, isInteractiveTTY, handlePromptableError } from '../../utils/prompts.js'
import { resolveGateAuthorization, addTeamMemberToPolicy, loadPolicyForEdit } from './utils.js'

interface AddOptions {
  slug?: string
  name?: string
  email?: string
  github?: string
  publicKey?: string
  gates?: string
}

export const addCommand = new Command('add')
  .description('Add a new team member')
  .option('--slug <slug>', 'Unique identifier for the team member')
  .option('--name <name>', 'Display name')
  .option('--email <email>', 'Email address (optional)')
  .option('--github <username>', 'GitHub username (optional)')
  .option(
    '--public-key <key>',
    "Base64-encoded Ed25519 public key (from 'attest-it identity export')",
  )
  .option('--gates <ids>', 'Comma-separated gate IDs to authorize (default: none)')
  .action(async (options: AddOptions) => {
    await runAdd(options)
  })

/**
 * Validate Base64 encoded Ed25519 public key.
 * Ed25519 public keys are 32 bytes, which is 44 characters in Base64.
 */
function validatePublicKey(value: string): true | string {
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
 * Run the add command to add a team member.
 *
 * Interactive by default when stdin is a TTY and flags are omitted. Every
 * prompt is gated behind "flag not supplied AND stdin is an interactive TTY";
 * when stdin is not a TTY and a required value is missing, this fails fast
 * with an error naming the missing flag rather than hanging on a prompt that
 * can never resolve. See issue #80.
 */
async function runAdd(options: AddOptions = {}): Promise<void> {
  try {
    const theme = getTheme()

    log('')
    log(theme.blue.bold()('Add Team Member'))
    log('')

    // Load existing policy (team + gates live in policy.yaml)
    const { policy, path: policyPath } = loadPolicyForEdit()
    const existingTeam = policy.team ?? {}

    const validateSlugInput = (value: string): true | string => {
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
    }

    // Member details
    const slug = await resolveOrPrompt(options.slug, '--slug', () =>
      input({ message: 'Member slug (unique identifier):', validate: validateSlugInput }),
    )
    const slugValidation = validateSlugInput(slug)
    if (slugValidation !== true) {
      throw new Error(slugValidation)
    }

    const name = await resolveOrPrompt(options.name, '--name', () =>
      input({
        message: 'Display name:',
        validate: (value) => {
          if (!value || value.trim().length === 0) {
            return 'Name cannot be empty'
          }
          return true
        },
      }),
    )
    if (name.trim().length === 0) {
      throw new Error('--name cannot be empty')
    }

    const email =
      options.email ??
      (isInteractiveTTY() ? await input({ message: 'Email (optional):', default: '' }) : '')

    const github =
      options.github ??
      (isInteractiveTTY()
        ? await input({ message: 'GitHub username (optional):', default: '' })
        : '')

    let publicKey: string
    if (options.publicKey !== undefined) {
      publicKey = options.publicKey
    } else {
      log('')
      log('Paste the public key (from "attest-it identity export"):')
      publicKey = await resolveOrPrompt(undefined, '--public-key', () =>
        input({ message: 'Public key:', validate: validatePublicKey }),
      )
    }
    const publicKeyValidation = validatePublicKey(publicKey)
    if (publicKeyValidation !== true) {
      throw new Error(publicKeyValidation)
    }

    // Resolve gate authorizations
    log('')
    const authorizedGates = await resolveGateAuthorization(policy.gates, options.gates)

    // Update config with new team member
    const memberData: Parameters<typeof addTeamMemberToPolicy>[2] = {
      name,
      publicKey: publicKey.trim(),
      publicKeyAlgorithm: 'ed25519',
    }
    const trimmedEmail = email.trim()
    const trimmedGithub = github.trim()
    if (trimmedEmail && trimmedEmail.length > 0) {
      memberData.email = trimmedEmail
    }
    if (trimmedGithub && trimmedGithub.length > 0) {
      memberData.github = trimmedGithub
    }
    const updatedPolicy = addTeamMemberToPolicy(policy, slug, memberData, authorizedGates)

    // Write policy back to file
    const yamlContent = stringifyYaml(updatedPolicy)
    await writeFile(policyPath, yamlContent, 'utf8')

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

// Exported for testing
export { runAdd }
