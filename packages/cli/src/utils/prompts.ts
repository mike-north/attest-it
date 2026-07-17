import { confirm } from '@inquirer/prompts'
import { getTheme, BOX_CHARS } from '../components/theme.js'
import { error, log } from './output.js'
import { ExitCode } from './exit-codes.js'

export interface ConfirmOptions {
  message: string
  default?: boolean
}

/**
 * Whether stdin is attached to an interactive terminal.
 *
 * @remarks
 * Every prompt in the CLI must be gated behind this check. When stdin is a
 * pipe or `/dev/null` (CI, an embedder, or an agent), `isTTY` is `undefined`,
 * and any attempt to read interactive input hangs indefinitely rather than
 * failing — so callers must check this first and fail fast instead of
 * prompting. See issue #80.
 *
 * @public
 */
export function isInteractiveTTY(): boolean {
  // @types/node declares `isTTY` as a non-optional `boolean`, but at runtime
  // it is `undefined` whenever stdin is not a TTY (piped input, /dev/null) --
  // exactly the case this function exists to detect. The explicit coercion
  // is intentional, not redundant, despite the ambient type declaration.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-conversion
  return Boolean(process.stdin.isTTY)
}

/**
 * Resolve a value that would normally be collected via an interactive prompt.
 *
 * @remarks
 * - If `value` is already supplied (e.g. from a CLI flag), it is returned
 *   immediately and `prompt` is never invoked.
 * - Otherwise, if stdin is an interactive TTY, `prompt()` runs to collect the
 *   value interactively (unchanged default behavior for humans).
 * - Otherwise (non-TTY and missing), throws an error naming `flagName` so the
 *   caller's existing catch block can fail fast with a legible message
 *   instead of hanging on a prompt that will never resolve.
 *
 * @param value - The already-supplied value (e.g. a parsed CLI flag), if any
 * @param flagName - The flag name to report in the fail-fast error (e.g. `--name`)
 * @param prompt - Callback that interactively collects the value
 * @returns The resolved value
 * @throws Error if `value` is undefined and stdin is not an interactive TTY
 * @public
 */
export async function resolveOrPrompt<T>(
  value: T | undefined,
  flagName: string,
  prompt: () => Promise<T>,
): Promise<T> {
  if (value !== undefined) {
    return value
  }
  if (!isInteractiveTTY()) {
    throw new Error(
      `Missing required ${flagName} (no interactive terminal available to prompt for it). ` +
        `Pass ${flagName} explicitly to run non-interactively.`,
    )
  }
  return prompt()
}

/**
 * Resolve a value that would normally be collected via an interactive prompt,
 * but which has a sensible default rather than being strictly required.
 *
 * @remarks
 * Unlike {@link resolveOrPrompt}, a missing value in a non-interactive
 * context is not an error here: it simply falls back to `defaultValue`.
 * Interactively, `prompt` is invoked (typically pre-filled with the same
 * default) so a human can still override it.
 *
 * A *supplied* value that is empty (or all whitespace) after trimming is
 * rejected rather than silently accepted: every caller's interactive
 * `prompt` already enforces "cannot be empty" via its `validate` callback,
 * so a flag-supplied empty string must fail the same way instead of
 * bypassing that check.
 *
 * @param value - The already-supplied value (e.g. a parsed CLI flag), if any
 * @param flagName - The flag name to report if a supplied `value` is empty (e.g. `--name`)
 * @param defaultValue - Value to use when non-interactive and `value` is missing
 * @param prompt - Callback that interactively collects the value
 * @returns The resolved value
 * @throws Error if `value` is supplied but empty (or all whitespace)
 * @public
 */
export async function resolveOptionalOrPrompt(
  value: string | undefined,
  flagName: string,
  defaultValue: string,
  prompt: () => Promise<string>,
): Promise<string> {
  if (value !== undefined) {
    const trimmed = value.trim()
    if (trimmed.length === 0) {
      throw new Error(`${flagName} cannot be empty`)
    }
    return trimmed
  }
  if (isInteractiveTTY()) {
    return (await prompt()).trim()
  }
  return defaultValue
}

/**
 * Resolve a yes/no confirmation that may already be supplied via a CLI flag.
 *
 * @remarks
 * Mirrors {@link resolveOrPrompt}'s "flag, or interactive prompt, or fail
 * fast" resolution order, specialized for confirmations: if `autoConfirm` is
 * true, resolves to `true` without ever invoking `prompt`. Otherwise, if
 * stdin is not an interactive TTY, throws naming `flagName` instead of
 * invoking `prompt` -- every confirmation in the CLI must go through this (or
 * an equivalent) gate, since handing a closed/piped stdin directly to
 * `@inquirer/prompts` either hangs (a stream that never closes) or, once
 * stdin closes, throws its raw `ExitPromptError` ("User force closed the
 * prompt with 0 null"). See issue #94.
 *
 * @param autoConfirm - Already-resolved flag value (e.g. `--yes`); when true,
 * `prompt` is never invoked
 * @param flagName - The flag name to report in the fail-fast error (e.g. `--yes`)
 * @param prompt - Callback that interactively collects the confirmation
 * @returns Whether the action was confirmed
 * @throws Error if not auto-confirmed and stdin is not an interactive TTY
 * @public
 */
export async function resolveConfirmation(
  autoConfirm: boolean | undefined,
  flagName: string,
  prompt: () => Promise<boolean>,
): Promise<boolean> {
  if (autoConfirm) {
    return true
  }
  if (!isInteractiveTTY()) {
    throw new Error(
      `Refusing to proceed without ${flagName} (no interactive terminal available to confirm). ` +
        `Pass ${flagName} to run non-interactively.`,
    )
  }
  return prompt()
}

/**
 * True when `err` is `@inquirer/core`'s signal for an interrupted or
 * force-closed prompt -- Ctrl-C during an interactive prompt, or (the case
 * that matters for automation) the process's stdin ending while a prompt is
 * still awaiting input on it.
 *
 * @remarks
 * Checked by `name` rather than `instanceof`: `@inquirer/core`'s
 * `ExitPromptError` class is a transitive dependency (only `@inquirer/prompts`
 * is declared directly), so it is not an importable type here.
 *
 * @param err - The caught error
 * @returns Whether `err` represents a cancelled/force-closed prompt
 * @public
 */
export function isPromptCancellation(err: unknown): boolean {
  return err instanceof Error && err.name === 'ExitPromptError'
}

/**
 * Standard top-level `catch` handler for a command whose action may run an
 * interactive prompt.
 *
 * @remarks
 * Before this fix, a force-closed/interrupted prompt fell through to each
 * command's generic error handling, surfacing `@inquirer/core`'s raw message
 * ("User force closed the prompt with 0 null") under whatever fallback exit
 * code that command used -- even though the `CANCELLED` exit code exists
 * specifically for this case. This normalizes that path to the same clean
 * "Cancelled" message and `CANCELLED` exit code a declined confirmation
 * already uses, everywhere a command can prompt. See issues #94/#95.
 *
 * @param err - The caught error
 * @param fallbackExitCode - Exit code for a non-cancellation error (commands
 * differ here, so this is not hardcoded)
 * @public
 */
export function handlePromptableError(err: unknown, fallbackExitCode: ExitCode): never {
  if (isPromptCancellation(err)) {
    log('Cancelled')
    process.exit(ExitCode.CANCELLED)
  } else {
    if (err instanceof Error) {
      error(err.message)
    } else {
      error('Unknown error occurred')
    }
    process.exit(fallbackExitCode)
  }
}

/** Coerce a stdin chunk (Buffer or string, per Node's stream typing) into a Buffer. */
function toBuffer(chunk: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) {
    return chunk
  }
  if (typeof chunk === 'string') {
    return Buffer.from(chunk, 'utf8')
  }
  throw new Error('Unexpected stdin chunk type')
}

/**
 * Read all of stdin to completion and return it as a UTF-8 string with a
 * single trailing newline (if any) trimmed.
 *
 * @remarks
 * Used by flags like `--passphrase-stdin` that read a secret piped into the
 * process (e.g. `echo "$PASSPHRASE" | attest-it identity create ...`),
 * mirroring conventions like `docker login --password-stdin`. This reads the
 * CLI's own stdin directly — it does not shell out to another process, so
 * there is no fd contention with OpenSSL's dedicated fd:3 passphrase pipe
 * (see the `runOpenSSL` mechanism in `@attest-it/core`, added for issue #75).
 *
 * @returns The trimmed stdin content
 * @public
 */
export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(toBuffer(chunk))
  }
  return Buffer.concat(chunks)
    .toString('utf8')
    .replace(/\r?\n$/, '')
}

/**
 * Display a visually distinctive confirmation prompt.
 *
 * Creates a styled box with yellow border to make the attestation prompt
 * stand out from test output.
 */
export async function confirmAction(options: ConfirmOptions): Promise<boolean> {
  const theme = getTheme()

  // Build the styled prompt box
  const defaultIndicator = options.default ? '(Y/n)' : '(y/N)'
  const message = `${options.message}? ${defaultIndicator}`
  const boxWidth = Math.max(message.length + 2, 40)
  const contentPadding = ' '.repeat(boxWidth - message.length - 1)

  // Box drawing with yellow border
  const topBorder = theme.yellow(
    `${BOX_CHARS.topLeft}${BOX_CHARS.horizontal.repeat(boxWidth)}${BOX_CHARS.topRight}`,
  )
  const bottomBorder = theme.yellow(
    `${BOX_CHARS.bottomLeft}${BOX_CHARS.horizontal.repeat(boxWidth)}${BOX_CHARS.bottomRight}`,
  )

  // Content line with yellow border and normal text
  const contentLine =
    theme.yellow(BOX_CHARS.vertical) +
    ` ${message}${contentPadding}` +
    theme.yellow(BOX_CHARS.vertical)

  // Display the styled box
  console.log('')
  console.log(topBorder)
  console.log(contentLine)
  console.log(bottomBorder)
  console.log('')

  // Get the actual confirmation
  return confirm({
    message: '', // Empty message since we displayed it above
    default: options.default ?? false,
    theme: {
      prefix: '', // Remove default prefix
    },
  })
}
