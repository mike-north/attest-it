/**
 * Shared passphrase resolution for signing with a passphrase-encrypted
 * file-backed private key (created via `identity create --storage file
 * --passphrase-stdin`).
 *
 * Extracted from `run.ts` (issue #87) so `seal.ts` can share the exact same
 * non-interactive-safe resolution instead of re-implementing it -- `seal` had
 * no passphrase handling at all, so an encrypted key simply failed signing
 * with no path to supply the passphrase. See issue #94.
 */
import { password } from '@inquirer/prompts'
import { isInteractiveTTY } from './prompts.js'

/** Env var read for the passphrase of an encrypted file-backed identity key. */
const KEY_PASSPHRASE_ENV = 'ATTEST_IT_KEY_PASSPHRASE'

/**
 * Resolve the passphrase needed to sign with an encrypted file-backed
 * private key.
 *
 * Order: the `ATTEST_IT_KEY_PASSPHRASE` env var, then (interactively) a
 * masked prompt, then fail fast naming the env var -- this never hangs on a
 * prompt that can never resolve. See issue #80.
 *
 * @returns The resolved passphrase
 * @throws Error if non-interactive and the env var is not set
 * @public
 */
export async function resolveKeyPassphrase(): Promise<string> {
  const fromEnv = process.env[KEY_PASSPHRASE_ENV]
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return fromEnv
  }
  if (isInteractiveTTY()) {
    return password({
      message: 'Passphrase for encrypted private key:',
      validate: (value) => (value.length > 0 ? true : 'Passphrase cannot be empty'),
    })
  }
  throw new Error(
    `This identity's private key is passphrase-encrypted. Set ${KEY_PASSPHRASE_ENV} ` +
      '(no interactive terminal available to prompt for it).',
  )
}
