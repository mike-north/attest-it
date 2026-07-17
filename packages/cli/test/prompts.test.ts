/**
 * Tests for the non-interactive setup helpers (issue #80): every CLI prompt
 * must be gated behind "flag not supplied AND stdin is an interactive TTY",
 * failing fast with a legible error instead of hanging when it is not.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  isInteractiveTTY,
  resolveOrPrompt,
  resolveOptionalOrPrompt,
  readStdin,
} from '../src/utils/prompts.js'
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
