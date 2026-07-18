/**
 * Unit tests for `resolveKeyPassphrase` — the non-interactive-safe passphrase
 * resolution shared by `seal` and `run` for encrypted file-backed keys.
 *
 * @see issue #94 (seal passphrase handling), issue #80/#87 (fail-fast policy)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@inquirer/prompts', () => ({ password: vi.fn() }))
vi.mock('../src/utils/prompts.js', () => ({ isInteractiveTTY: vi.fn(() => false) }))

const { password } = await import('@inquirer/prompts')
const { isInteractiveTTY } = await import('../src/utils/prompts.js')
const { resolveKeyPassphrase } = await import('../src/utils/passphrase.js')

const PASSPHRASE_ENV = 'ATTEST_IT_KEY_PASSPHRASE'
const originalEnvValue = process.env[PASSPHRASE_ENV]

describe('resolveKeyPassphrase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env[PASSPHRASE_ENV]
    vi.mocked(isInteractiveTTY).mockReturnValue(false)
  })

  afterEach(() => {
    vi.clearAllMocks()
    if (originalEnvValue === undefined) {
      delete process.env[PASSPHRASE_ENV]
    } else {
      process.env[PASSPHRASE_ENV] = originalEnvValue
    }
  })

  it('returns the env var value without prompting', async () => {
    process.env[PASSPHRASE_ENV] = 'env-secret'
    await expect(resolveKeyPassphrase()).resolves.toBe('env-secret')
    expect(password).not.toHaveBeenCalled()
  })

  it('prompts interactively when the env var is unset and stdin is a TTY', async () => {
    vi.mocked(isInteractiveTTY).mockReturnValue(true)
    vi.mocked(password).mockResolvedValue('prompted-secret')

    await expect(resolveKeyPassphrase()).resolves.toBe('prompted-secret')
    expect(password).toHaveBeenCalledOnce()
  })

  it('fails fast naming the env var when non-interactive and the env var is unset', async () => {
    await expect(resolveKeyPassphrase()).rejects.toThrow(PASSPHRASE_ENV)
    expect(password).not.toHaveBeenCalled()
  })

  it('ignores an empty env var and falls through to the fail-fast path', async () => {
    process.env[PASSPHRASE_ENV] = ''
    await expect(resolveKeyPassphrase()).rejects.toThrow(PASSPHRASE_ENV)
    expect(password).not.toHaveBeenCalled()
  })
})
