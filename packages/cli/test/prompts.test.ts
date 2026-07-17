/**
 * Tests for the non-interactive setup helpers (issue #80): every CLI prompt
 * must be gated behind "flag not supplied AND stdin is an interactive TTY",
 * failing fast with a legible error instead of hanging when it is not.
 *
 * Also covers issues #94/#95: `resolveConfirmation` (the shared guard behind
 * every yes/no confirmation) and `handlePromptableError`/
 * `isPromptCancellation` (mapping a cancelled/force-closed prompt to the
 * `CANCELLED` exit code with a clean message instead of `@inquirer/core`'s
 * raw error under whatever fallback code a command uses).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  isInteractiveTTY,
  resolveOrPrompt,
  resolveOptionalOrPrompt,
  resolveConfirmation,
  isPromptCancellation,
  handlePromptableError,
  readStdin,
} from '../src/utils/prompts.js'
import { ExitCode } from '../src/utils/exit-codes.js'
import { Readable } from 'node:stream'

describe('isInteractiveTTY', () => {
  const originalIsTTY = process.stdin.isTTY

  afterEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true })
  })

  it('should return true when stdin.isTTY is true', () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })
    expect(isInteractiveTTY()).toBe(true)
  })

  it('should return false when stdin.isTTY is undefined (e.g. piped or /dev/null)', () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: undefined, configurable: true })
    expect(isInteractiveTTY()).toBe(false)
  })

  it('should return false when stdin.isTTY is false', () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true })
    expect(isInteractiveTTY()).toBe(false)
  })
})

describe('resolveOrPrompt', () => {
  const originalIsTTY = process.stdin.isTTY

  afterEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true })
  })

  it('should return the supplied value without invoking the prompt', async () => {
    const prompt = vi.fn().mockResolvedValue('should not be used')

    const result = await resolveOrPrompt('flag-value', '--name', prompt)

    expect(result).toBe('flag-value')
    expect(prompt).not.toHaveBeenCalled()
  })

  it('should invoke the prompt when value is missing and stdin is an interactive TTY', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })
    const prompt = vi.fn().mockResolvedValue('prompted-value')

    const result = await resolveOrPrompt<string>(undefined, '--name', prompt)

    expect(result).toBe('prompted-value')
    expect(prompt).toHaveBeenCalledTimes(1)
  })

  it('should throw naming the flag when value is missing and stdin is not a TTY (never hangs)', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: undefined, configurable: true })
    const prompt = vi.fn().mockResolvedValue('should not be used')

    await expect(resolveOrPrompt<string>(undefined, '--name', prompt)).rejects.toThrow('--name')
    expect(prompt).not.toHaveBeenCalled()
  })
})

describe('resolveOptionalOrPrompt', () => {
  const originalIsTTY = process.stdin.isTTY

  afterEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true })
  })

  it('should return the trimmed supplied value without invoking the prompt', async () => {
    const prompt = vi.fn().mockResolvedValue('should not be used')

    const result = await resolveOptionalOrPrompt(
      '  flag-value  ',
      '--name',
      'default-value',
      prompt,
    )

    expect(result).toBe('flag-value')
    expect(prompt).not.toHaveBeenCalled()
  })

  it('should invoke the prompt when value is missing and stdin is an interactive TTY', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })
    const prompt = vi.fn().mockResolvedValue('prompted-value')

    const result = await resolveOptionalOrPrompt(undefined, '--name', 'default-value', prompt)

    expect(result).toBe('prompted-value')
    expect(prompt).toHaveBeenCalledTimes(1)
  })

  it('should fall back to the default (not throw) when value is missing and stdin is not a TTY', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: undefined, configurable: true })
    const prompt = vi.fn().mockResolvedValue('should not be used')

    const result = await resolveOptionalOrPrompt(undefined, '--name', 'default-value', prompt)

    expect(result).toBe('default-value')
    expect(prompt).not.toHaveBeenCalled()
  })

  it('should reject a supplied value that is empty (or all whitespace) instead of silently accepting it', async () => {
    // Regression test: a flag-supplied empty string previously bypassed the
    // "cannot be empty" validation every interactive `prompt` enforces.
    const prompt = vi.fn().mockResolvedValue('should not be used')

    await expect(resolveOptionalOrPrompt('   ', '--name', 'default-value', prompt)).rejects.toThrow(
      '--name cannot be empty',
    )
    expect(prompt).not.toHaveBeenCalled()
  })
})

describe('readStdin', () => {
  /** Replace process.stdin with a fake readable stream for the duration of one test. */
  function withFakeStdin<T>(content: string | null, fn: () => Promise<T>): Promise<T> {
    const fake = content === null ? Readable.from([]) : Readable.from([content])
    const original = process.stdin
    Object.defineProperty(process, 'stdin', { value: fake, configurable: true })
    return fn().finally(() => {
      Object.defineProperty(process, 'stdin', { value: original, configurable: true })
    })
  }

  it('should read piped content and trim a single trailing newline', async () => {
    const result = await withFakeStdin('super-secret\n', () => readStdin())
    expect(result).toBe('super-secret')
  })

  it('should read piped content with no trailing newline unchanged', async () => {
    const result = await withFakeStdin('super-secret', () => readStdin())
    expect(result).toBe('super-secret')
  })

  it('should return an empty string when stdin is empty (e.g. /dev/null)', async () => {
    const result = await withFakeStdin('', () => readStdin())
    expect(result).toBe('')
  })

  it('should only trim one trailing newline, preserving internal newlines', async () => {
    const result = await withFakeStdin('line1\nline2\n', () => readStdin())
    expect(result).toBe('line1\nline2')
  })
})

describe('resolveConfirmation (issue #94)', () => {
  const originalIsTTY = process.stdin.isTTY

  afterEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true })
  })

  it('resolves to true without invoking the prompt when autoConfirm is true', async () => {
    const prompt = vi.fn().mockResolvedValue(false)

    const result = await resolveConfirmation(true, '--yes', prompt)

    expect(result).toBe(true)
    expect(prompt).not.toHaveBeenCalled()
  })

  it('invokes the prompt when autoConfirm is falsy and stdin is an interactive TTY', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })
    const prompt = vi.fn().mockResolvedValue(true)

    const result = await resolveConfirmation(undefined, '--yes', prompt)

    expect(result).toBe(true)
    expect(prompt).toHaveBeenCalledTimes(1)
  })

  it('throws naming the flag when autoConfirm is falsy and stdin is not a TTY (never hangs)', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: undefined, configurable: true })
    const prompt = vi.fn().mockResolvedValue(true)

    await expect(resolveConfirmation(undefined, '--yes', prompt)).rejects.toThrow('--yes')
    expect(prompt).not.toHaveBeenCalled()
  })

  it('treats an explicit false autoConfirm the same as undefined (still gated by TTY)', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: undefined, configurable: true })
    const prompt = vi.fn().mockResolvedValue(true)

    await expect(resolveConfirmation(false, '--force', prompt)).rejects.toThrow('--force')
    expect(prompt).not.toHaveBeenCalled()
  })
})

describe('isPromptCancellation (issue #95)', () => {
  it('returns true for an error named ExitPromptError', () => {
    const err = new Error('User force closed the prompt with 0 null')
    err.name = 'ExitPromptError'
    expect(isPromptCancellation(err)).toBe(true)
  })

  it('returns false for a plain Error', () => {
    expect(isPromptCancellation(new Error('some other failure'))).toBe(false)
  })

  it('returns false for a non-Error thrown value', () => {
    expect(isPromptCancellation('a string error')).toBe(false)
    expect(isPromptCancellation(undefined)).toBe(false)
    expect(isPromptCancellation(null)).toBe(false)
  })
})

describe('handlePromptableError (issue #95)', () => {
  const mockProcessExit = vi
    .spyOn(process, 'exit')
    // @ts-expect-error - Mocking process.exit which has a complex signature
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    .mockImplementation(() => {})
  const mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined)
  const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('maps a cancelled/force-closed prompt to a clean "Cancelled" message and CANCELLED, ignoring the fallback code', () => {
    const rawMessage = 'User force closed the prompt with 0 null'
    const err = new Error(rawMessage)
    err.name = 'ExitPromptError'

    handlePromptableError(err, ExitCode.CONFIG_ERROR)

    expect(mockConsoleLog).toHaveBeenCalledWith('Cancelled')
    expect(mockConsoleError).not.toHaveBeenCalled()
    expect(mockProcessExit).toHaveBeenCalledTimes(1)
    expect(mockProcessExit).toHaveBeenCalledWith(ExitCode.CANCELLED)
  })

  it('reports a plain Error message under the given fallback exit code', () => {
    handlePromptableError(new Error('boom'), ExitCode.CONFIG_ERROR)

    expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('boom'))
    expect(mockConsoleLog).not.toHaveBeenCalledWith('Cancelled')
    expect(mockProcessExit).toHaveBeenCalledTimes(1)
    expect(mockProcessExit).toHaveBeenCalledWith(ExitCode.CONFIG_ERROR)
  })

  it('reports a generic message for a non-Error thrown value under the fallback exit code', () => {
    handlePromptableError('a string throw', ExitCode.FAILURE)

    expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('Unknown error'))
    expect(mockProcessExit).toHaveBeenCalledWith(ExitCode.FAILURE)
  })
})
