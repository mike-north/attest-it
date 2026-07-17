/**
 * Tests for `team add`'s non-interactive flags (issue #80).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runAdd, addCommand } from '../src/commands/team/add.js'
import * as core from '@attest-it/core'
import type { PolicyConfig } from '@attest-it/core'
import * as fs from 'node:fs/promises'
import * as prompts from '@inquirer/prompts'
import YAML from 'yaml'

/** Parse the policy YAML written by the most recent fs.writeFile call. */
function getWrittenPolicyYaml(): string {
  const writeCall = vi.mocked(fs.writeFile).mock.calls[0]
  if (!writeCall) {
    throw new Error('Expected fs.writeFile to have been called')
  }
  const content: unknown = writeCall[1]
  if (typeof content !== 'string') {
    throw new Error('Expected written policy content to be a string')
  }
  return content
}

function isPolicyConfig(value: unknown): value is PolicyConfig {
  return typeof value === 'object' && value !== null && 'version' in value
}

function parseWrittenPolicy(): PolicyConfig {
  const parsed: unknown = YAML.parse(getWrittenPolicyYaml())
  if (!isPolicyConfig(parsed)) {
    throw new Error('Expected written content to parse as a PolicyConfig')
  }
  return parsed
}

vi.mock('@attest-it/core', async () => {
  const actual = await vi.importActual<typeof import('@attest-it/core')>('@attest-it/core')
  return {
    ...actual,
    findPolicyPath: vi.fn(),
    parsePolicyContent: vi.fn(),
  }
})

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn(),
}))

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(() => ''),
}))

vi.mock('@inquirer/prompts', () => ({
  input: vi.fn(),
  checkbox: vi.fn(),
}))

const mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined)
const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
const mockProcessExit = vi.spyOn(process, 'exit').mockImplementation(() => {
  throw new Error('process.exit called')
})

function mockPolicy(policy: PolicyConfig, path = '/test/policy.yaml'): void {
  vi.mocked(core.findPolicyPath).mockReturnValue(path)
  vi.mocked(core.parsePolicyContent).mockReturnValue(policy)
}

const BASE_POLICY: PolicyConfig = {
  version: 1,
  settings: {
    maxAgeDays: 30,
    publicKeyPath: '.attest-it/pubkey.pem',
    attestationsPath: '.attest-it/attestations.json',
    sealsPath: '.attest-it/seals.json',
  },
  team: {},
}

const VALID_PUBLIC_KEY = 'oB5OUxsnFR7GdTPURp9loSGinbcb6EKDTrFGKl2VTPk='

describe('team add command', () => {
  const originalIsTTY = process.stdin.isTTY

  beforeEach(() => {
    mockConsoleLog.mockClear()
    mockConsoleError.mockClear()
    mockProcessExit.mockClear()
    vi.clearAllMocks()
    mockPolicy(BASE_POLICY)

    // Non-interactive by default (matches a CI/embedder environment); the
    // 'interactive fallback' describe block below overrides this to true to
    // exercise unchanged human-driven behavior.
    Object.defineProperty(process.stdin, 'isTTY', { value: undefined, configurable: true })
  })

  afterEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true })
  })

  it('should be defined', () => {
    expect(addCommand).toBeDefined()
    expect(addCommand.name()).toBe('add')
  })

  describe('non-interactive (flags supplied)', () => {
    it('should add a team member with zero prompts given all required flags', async () => {
      await runAdd({
        slug: 'new-user',
        name: 'New User',
        publicKey: VALID_PUBLIC_KEY,
      })

      expect(prompts.input).not.toHaveBeenCalled()
      expect(prompts.checkbox).not.toHaveBeenCalled()

      const parsedConfig = parseWrittenPolicy()
      expect(parsedConfig.team?.['new-user']).toMatchObject({
        name: 'New User',
        publicKey: VALID_PUBLIC_KEY,
      })
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringMatching(/✓.*Team member "new-user" added successfully/),
      )
    })

    it('should authorize gates listed in --gates without prompting', async () => {
      mockPolicy({
        ...BASE_POLICY,
        gates: {
          'gate-1': {
            name: 'Gate 1',
            description: 'desc',
            authorizedSigners: [],
            fingerprint: { paths: ['.'] },
            maxAge: '30d',
          },
        },
      })

      await runAdd({
        slug: 'new-user',
        name: 'New User',
        publicKey: VALID_PUBLIC_KEY,
        gates: 'gate-1',
      })

      expect(prompts.checkbox).not.toHaveBeenCalled()
      const parsedConfig = parseWrittenPolicy()
      expect(parsedConfig.gates?.['gate-1']?.authorizedSigners).toContain('new-user')
    })

    it('should reject --gates referencing an unknown gate ID', async () => {
      mockPolicy({
        ...BASE_POLICY,
        gates: {
          'gate-1': {
            name: 'Gate 1',
            description: 'desc',
            authorizedSigners: [],
            fingerprint: { paths: ['.'] },
            maxAge: '30d',
          },
        },
      })

      await expect(
        runAdd({
          slug: 'new-user',
          name: 'New User',
          publicKey: VALID_PUBLIC_KEY,
          gates: 'no-such-gate',
        }),
      ).rejects.toThrow('process.exit called')

      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining('unknown gate(s): no-such-gate'),
      )
    })

    it('should reject an invalid public key even when supplied via flag', async () => {
      await expect(
        runAdd({ slug: 'new-user', name: 'New User', publicKey: 'not-valid-base64!!!' }),
      ).rejects.toThrow('process.exit called')

      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('Base64'))
    })
  })

  describe('non-interactive guard (missing required flags, no TTY)', () => {
    it('should fail fast naming --slug when missing', async () => {
      await expect(runAdd({ name: 'New User', publicKey: VALID_PUBLIC_KEY })).rejects.toThrow(
        'process.exit called',
      )

      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('--slug'))
    })

    it('should fail fast naming --name when missing', async () => {
      await expect(runAdd({ slug: 'new-user', publicKey: VALID_PUBLIC_KEY })).rejects.toThrow(
        'process.exit called',
      )

      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('--name'))
    })

    it('should fail fast naming --public-key when missing', async () => {
      await expect(runAdd({ slug: 'new-user', name: 'New User' })).rejects.toThrow(
        'process.exit called',
      )

      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('--public-key'))
    })

    it('should default to zero authorized gates when --gates is omitted', async () => {
      mockPolicy({
        ...BASE_POLICY,
        gates: {
          'gate-1': {
            name: 'Gate 1',
            description: 'desc',
            authorizedSigners: [],
            fingerprint: { paths: ['.'] },
            maxAge: '30d',
          },
        },
      })

      await runAdd({ slug: 'new-user', name: 'New User', publicKey: VALID_PUBLIC_KEY })

      const parsedConfig = parseWrittenPolicy()
      expect(parsedConfig.gates?.['gate-1']?.authorizedSigners).not.toContain('new-user')
    })
  })

  describe('interactive fallback (unchanged for humans)', () => {
    it('should prompt for slug, name, and public key when flags are omitted with a TTY', async () => {
      Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })
      vi.mocked(prompts.input)
        .mockResolvedValueOnce('new-user')
        .mockResolvedValueOnce('New User')
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce(VALID_PUBLIC_KEY)

      await runAdd({})

      expect(prompts.input).toHaveBeenCalledTimes(5)
      const parsedConfig = parseWrittenPolicy()
      expect(parsedConfig.team?.['new-user']).toBeDefined()
    })
  })
})
