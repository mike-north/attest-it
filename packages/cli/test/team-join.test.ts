import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runJoin, joinCommand } from '../src/commands/team/join.js'
import * as core from '@attest-it/core'
import type { PolicyConfig } from '@attest-it/core'

type PolicyGateConfig = NonNullable<PolicyConfig['gates']>[string]
import * as fs from 'node:fs/promises'
import * as fsSync from 'node:fs'
import * as prompts from '@inquirer/prompts'
import YAML from 'yaml'

// Mock the core module
vi.mock('@attest-it/core', async () => {
  const actual = await vi.importActual<typeof import('@attest-it/core')>('@attest-it/core')
  return {
    ...actual,
    loadLocalConfig: vi.fn(),
    getActiveIdentity: vi.fn(),
    findPolicyPath: vi.fn(),
    parsePolicyContent: vi.fn(),
  }
})

// Mock fs promises (used to write the updated policy)
vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn(),
}))

// Mock fs sync (used to read the existing policy content)
vi.mock('node:fs', () => ({
  readFileSync: vi.fn(() => ''),
}))

// Mock prompts
vi.mock('@inquirer/prompts', () => ({
  input: vi.fn(),
  checkbox: vi.fn(),
}))

// Mock console methods - suppress output during tests
const mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined)
const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
const mockProcessExit = vi
  .spyOn(process, 'exit')
  .mockImplementation((code?: string | number | null | undefined) => {
    throw new Error(`process.exit called with code ${code}`)
  }) as unknown as vi.SpyInstance

/**
 * Build a fully-populated gate config for test fixtures. Callers only need to
 * specify the fields relevant to the behavior under test.
 */
function makeGate(
  overrides: Partial<PolicyGateConfig> & Pick<PolicyGateConfig, 'name'>,
): PolicyGateConfig {
  return {
    description: `Description for ${overrides.name}`,
    authorizedSigners: [],
    fingerprint: { paths: ['.'] },
    maxAge: '30d',
    ...overrides,
  }
}

/**
 * Configure the mocks so that `loadPolicyForEdit()` resolves to the given
 * policy, as if it had been read from `/test/policy.yaml`.
 */
function mockPolicy(policy: PolicyConfig, path = '/test/policy.yaml'): void {
  vi.mocked(core.findPolicyPath).mockReturnValue(path)
  vi.mocked(core.parsePolicyContent).mockReturnValue(policy)
}

const PUBLIC_KEY = 'dGVzdHB1YmxpY2tleXRlc3RwdWJsaWNrZXl0ZXN0cHVibGlja2V5'

describe('team join command', () => {
  const originalIsTTY = process.stdin.isTTY

  beforeEach(() => {
    // Clear mock call history but keep the implementations
    mockConsoleLog.mockClear()
    mockConsoleError.mockClear()
    mockProcessExit.mockClear()

    // Also clear mocks from vi.mock
    vi.clearAllMocks()

    // Most of these tests exercise interactive prompts (slug collision,
    // gate authorization), only reachable with an interactive TTY (see issue
    // #80's fail-fast guard). The dedicated 'non-interactive' describe block
    // below overrides this per-test to exercise the guard itself.
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })
  })

  afterEach(() => {
    // Don't restore mocks -- we want to keep our mocks in place
    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true })
  })

  it('should be defined', () => {
    expect(joinCommand).toBeDefined()
    expect(joinCommand.name()).toBe('join')
  })

  it('should have correct description', () => {
    expect(joinCommand.description()).toBe(
      'Add yourself to the project team using your active identity',
    )
  })

  describe('error cases', () => {
    it('should error when no local config exists', async () => {
      // Mock loadLocalConfig to return null (no config)
      vi.mocked(core.loadLocalConfig).mockResolvedValue(null)

      // Expect process.exit to be called (vitest intercepts and throws)
      await expect(runJoin()).rejects.toThrow('process.exit')
      // Error messages are prefixed with ✗
      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringMatching(/✗.*No identity found/))
    })

    it('should error when no active identity exists', async () => {
      // Mock loadLocalConfig to return config without active identity
      vi.mocked(core.loadLocalConfig).mockResolvedValue({
        activeIdentity: 'test-identity',
        identities: {},
      })
      vi.mocked(core.getActiveIdentity).mockReturnValue(undefined)

      // Expect process.exit to be called (vitest intercepts and throws)
      await expect(runJoin()).rejects.toThrow('process.exit')
      // Error messages are prefixed with ✗
      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringMatching(/✗.*No active identity/))
    })

    it('should error when user is already a team member', async () => {
      // Mock loadLocalConfig with an active identity
      vi.mocked(core.loadLocalConfig).mockResolvedValue({
        activeIdentity: 'test-user',
        identities: {
          'test-user': {
            name: 'Test User',
            publicKey: PUBLIC_KEY,
            privateKey: { type: 'file', id: 'attest-it-test-key' },
          },
        },
      })

      vi.mocked(core.getActiveIdentity).mockReturnValue({
        name: 'Test User',
        publicKey: PUBLIC_KEY,
        privateKey: { type: 'file', id: 'attest-it-test-key' },
      })

      // Mock the policy with an existing team member using the same public key
      mockPolicy({
        version: 1,
        settings: {
          maxAgeDays: 30,
          publicKeyPath: '.attest-it/pubkey.pem',
          attestationsPath: '.attest-it/attestations.json',
          sealsPath: '.attest-it/seals.json',
        },
        team: {
          'existing-user': {
            name: 'Test User',
            publicKey: PUBLIC_KEY, // Same public key
          },
        },
      })

      // Expect process.exit to be called (vitest intercepts and throws)
      await expect(runJoin()).rejects.toThrow('process.exit')
      // Error messages are prefixed with ✗
      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringMatching(/✗.*You're already a team member/),
      )
    })

    it('should error when policy file not found', async () => {
      vi.mocked(core.loadLocalConfig).mockResolvedValue({
        activeIdentity: 'test-user',
        identities: {
          'test-user': {
            name: 'Test User',
            publicKey: PUBLIC_KEY,
            privateKey: { type: 'file', id: 'attest-it-test-key' },
          },
        },
      })

      vi.mocked(core.getActiveIdentity).mockReturnValue({
        name: 'Test User',
        publicKey: PUBLIC_KEY,
        privateKey: { type: 'file', id: 'attest-it-test-key' },
      })

      vi.mocked(core.findPolicyPath).mockReturnValue(null)
      vi.mocked(prompts.checkbox).mockResolvedValue([])

      await expect(runJoin()).rejects.toThrow('process.exit')
      // Error messages are prefixed with ✗
      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringMatching(/✗.*Policy file not found/),
      )
    })

    it('should handle unknown errors gracefully', async () => {
      vi.mocked(core.loadLocalConfig).mockRejectedValue('string error')

      await expect(runJoin()).rejects.toThrow('process.exit')
      // Error messages are prefixed with ✗
      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringMatching(/✗.*Unknown error/))
    })
  })

  describe('happy path cases', () => {
    it('should successfully add user to team with no gates defined', async () => {
      vi.mocked(core.loadLocalConfig).mockResolvedValue({
        activeIdentity: 'new-user',
        identities: {
          'new-user': {
            name: 'New User',
            publicKey: PUBLIC_KEY,
            privateKey: { type: 'file', id: 'attest-it-test-key' },
          },
        },
      })

      vi.mocked(core.getActiveIdentity).mockReturnValue({
        name: 'New User',
        publicKey: PUBLIC_KEY,
        privateKey: { type: 'file', id: 'attest-it-test-key' },
      })

      mockPolicy({
        version: 1,
        settings: {
          maxAgeDays: 30,
          publicKeyPath: '.attest-it/pubkey.pem',
          attestationsPath: '.attest-it/attestations.json',
          sealsPath: '.attest-it/seals.json',
        },
        team: {},
      })

      await runJoin()

      expect(fsSync.readFileSync).toHaveBeenCalledWith('/test/policy.yaml', 'utf8')
      expect(fs.writeFile).toHaveBeenCalledWith('/test/policy.yaml', expect.any(String), 'utf8')
      // Success messages are prefixed with ✓
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringMatching(/✓.*Team member "new-user" added successfully/),
      )
    })

    it('should successfully add user with gate authorizations selected', async () => {
      vi.mocked(core.loadLocalConfig).mockResolvedValue({
        activeIdentity: 'new-user',
        identities: {
          'new-user': {
            name: 'New User',
            publicKey: PUBLIC_KEY,
            privateKey: { type: 'file', id: 'attest-it-test-key' },
          },
        },
      })

      vi.mocked(core.getActiveIdentity).mockReturnValue({
        name: 'New User',
        publicKey: PUBLIC_KEY,
        privateKey: { type: 'file', id: 'attest-it-test-key' },
      })

      mockPolicy({
        version: 1,
        settings: {
          maxAgeDays: 30,
          publicKeyPath: '.attest-it/pubkey.pem',
          attestationsPath: '.attest-it/attestations.json',
          sealsPath: '.attest-it/seals.json',
        },
        team: {},
        gates: {
          'gate-1': makeGate({ name: 'Gate 1' }),
          'gate-2': makeGate({ name: 'Gate 2' }),
        },
      })
      vi.mocked(prompts.checkbox).mockResolvedValue(['gate-1', 'gate-2'])

      await runJoin()

      const writeCall = vi.mocked(fs.writeFile).mock.calls[0]
      expect(writeCall).toBeDefined()
      const yamlContent = writeCall?.[1] as string
      const parsedConfig = YAML.parse(yamlContent) as PolicyConfig

      expect(parsedConfig.gates?.['gate-1']?.authorizedSigners).toContain('new-user')
      expect(parsedConfig.gates?.['gate-2']?.authorizedSigners).toContain('new-user')
      expect(mockConsoleLog).toHaveBeenCalledWith('Authorized for gates: gate-1, gate-2')
    })

    it('should successfully add user with email and github fields populated', async () => {
      vi.mocked(core.loadLocalConfig).mockResolvedValue({
        activeIdentity: 'new-user',
        identities: {
          'new-user': {
            name: 'New User',
            email: 'new.user@example.com',
            github: 'newuser',
            publicKey: PUBLIC_KEY,
            privateKey: { type: 'file', id: 'attest-it-test-key' },
          },
        },
      })

      vi.mocked(core.getActiveIdentity).mockReturnValue({
        name: 'New User',
        email: 'new.user@example.com',
        github: 'newuser',
        publicKey: PUBLIC_KEY,
        privateKey: { type: 'file', id: 'attest-it-test-key' },
      })

      mockPolicy({
        version: 1,
        settings: {
          maxAgeDays: 30,
          publicKeyPath: '.attest-it/pubkey.pem',
          attestationsPath: '.attest-it/attestations.json',
          sealsPath: '.attest-it/seals.json',
        },
        team: {},
      })

      await runJoin()

      const writeCall = vi.mocked(fs.writeFile).mock.calls[0]
      expect(writeCall).toBeDefined()
      const yamlContent = writeCall?.[1] as string
      const parsedConfig = YAML.parse(yamlContent) as PolicyConfig

      const teamMember = parsedConfig.team?.['new-user']
      expect(teamMember?.name).toBe('New User')
      expect(teamMember?.email).toBe('new.user@example.com')
      expect(teamMember?.github).toBe('newuser')
      expect(teamMember?.publicKey).toBe(PUBLIC_KEY)
      expect(teamMember?.publicKeyAlgorithm).toBe('ed25519')
    })

    it('should verify YAML is written correctly to policy file', async () => {
      vi.mocked(core.loadLocalConfig).mockResolvedValue({
        activeIdentity: 'new-user',
        identities: {
          'new-user': {
            name: 'New User',
            publicKey: PUBLIC_KEY,
            privateKey: { type: 'file', id: 'attest-it-test-key' },
          },
        },
      })

      vi.mocked(core.getActiveIdentity).mockReturnValue({
        name: 'New User',
        publicKey: PUBLIC_KEY,
        privateKey: { type: 'file', id: 'attest-it-test-key' },
      })

      mockPolicy({
        version: 1,
        settings: {
          maxAgeDays: 30,
          publicKeyPath: '.attest-it/pubkey.pem',
          attestationsPath: '.attest-it/attestations.json',
          sealsPath: '.attest-it/seals.json',
        },
        team: { 'existing-user': { name: 'Existing', publicKey: 'different-key' } },
      })

      await runJoin()

      const writeCall = vi.mocked(fs.writeFile).mock.calls[0]
      expect(writeCall).toBeDefined()
      expect(writeCall?.[0]).toBe('/test/policy.yaml')
      expect(writeCall?.[2]).toBe('utf8')

      const yamlContent = writeCall?.[1] as string
      expect(() => YAML.parse(yamlContent)).not.toThrow()

      const parsedConfig = YAML.parse(yamlContent) as PolicyConfig
      expect(parsedConfig.version).toBe(1)
      expect(parsedConfig.team?.['existing-user']).toBeDefined()
      expect(parsedConfig.team?.['new-user']).toBeDefined()
    })

    it('should verify success messages are shown', async () => {
      vi.mocked(core.loadLocalConfig).mockResolvedValue({
        activeIdentity: 'new-user',
        identities: {
          'new-user': {
            name: 'New User',
            publicKey: PUBLIC_KEY,
            privateKey: { type: 'file', id: 'attest-it-test-key' },
          },
        },
      })

      vi.mocked(core.getActiveIdentity).mockReturnValue({
        name: 'New User',
        publicKey: PUBLIC_KEY,
        privateKey: { type: 'file', id: 'attest-it-test-key' },
      })

      mockPolicy({
        version: 1,
        settings: {
          maxAgeDays: 30,
          publicKeyPath: '.attest-it/pubkey.pem',
          attestationsPath: '.attest-it/attestations.json',
          sealsPath: '.attest-it/seals.json',
        },
        team: {},
      })

      await runJoin()

      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringMatching(/Join Project Team/))
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringMatching(/ℹ.*Using identity/))
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringMatching(/✓.*Team member "new-user" added successfully/),
      )
    })
  })

  describe('slug handling', () => {
    it('should prompt for alternative slug when collision occurs', async () => {
      vi.mocked(core.loadLocalConfig).mockResolvedValue({
        activeIdentity: 'taken-slug',
        identities: {
          'taken-slug': {
            name: 'New User',
            publicKey: PUBLIC_KEY,
            privateKey: { type: 'file', id: 'attest-it-test-key' },
          },
        },
      })

      vi.mocked(core.getActiveIdentity).mockReturnValue({
        name: 'New User',
        publicKey: PUBLIC_KEY,
        privateKey: { type: 'file', id: 'attest-it-test-key' },
      })

      mockPolicy({
        version: 1,
        settings: {
          maxAgeDays: 30,
          publicKeyPath: '.attest-it/pubkey.pem',
          attestationsPath: '.attest-it/attestations.json',
          sealsPath: '.attest-it/seals.json',
        },
        team: {
          'taken-slug': {
            name: 'Existing User',
            publicKey: 'different-key',
          },
        },
      })
      vi.mocked(prompts.input).mockResolvedValue('new-slug')

      await runJoin()

      expect(prompts.input).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Choose a different slug:',
        }),
      )
      expect(mockConsoleLog).toHaveBeenCalledWith(
        'Slug "taken-slug" is already taken by another team member.',
      )
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringMatching(/✓.*Team member "new-slug" added successfully/),
      )
    })

    it('should reject invalid slug characters', async () => {
      vi.mocked(core.loadLocalConfig).mockResolvedValue({
        activeIdentity: 'taken-slug',
        identities: {
          'taken-slug': {
            name: 'New User',
            publicKey: PUBLIC_KEY,
            privateKey: { type: 'file', id: 'attest-it-test-key' },
          },
        },
      })

      vi.mocked(core.getActiveIdentity).mockReturnValue({
        name: 'New User',
        publicKey: PUBLIC_KEY,
        privateKey: { type: 'file', id: 'attest-it-test-key' },
      })

      mockPolicy({
        version: 1,
        settings: {
          maxAgeDays: 30,
          publicKeyPath: '.attest-it/pubkey.pem',
          attestationsPath: '.attest-it/attestations.json',
          sealsPath: '.attest-it/seals.json',
        },
        team: {
          'taken-slug': {
            name: 'Existing User',
            publicKey: 'different-key',
          },
        },
      })

      let validateFn: ((value: string) => boolean | string) | undefined

      vi.mocked(prompts.input).mockImplementation(async (config) => {
        validateFn = config.validate
        return 'valid-slug'
      })

      await runJoin()

      expect(validateFn).toBeDefined()
      expect(validateFn?.('Invalid_Slug')).toBe(
        'Slug must contain only lowercase letters, numbers, and hyphens',
      )
      expect(validateFn?.('Invalid Slug')).toBe(
        'Slug must contain only lowercase letters, numbers, and hyphens',
      )
      expect(validateFn?.('UPPERCASE')).toBe(
        'Slug must contain only lowercase letters, numbers, and hyphens',
      )
      expect(validateFn?.('')).toBe('Slug cannot be empty')
      expect(validateFn?.('   ')).toBe('Slug cannot be empty')
      expect(validateFn?.('taken-slug')).toBe('Slug "taken-slug" is already taken')
      expect(validateFn?.('valid-slug')).toBe(true)
      expect(validateFn?.('valid-slug-123')).toBe(true)
    })

    it('should use identity slug when available and not taken', async () => {
      vi.mocked(core.loadLocalConfig).mockResolvedValue({
        activeIdentity: 'my-identity',
        identities: {
          'my-identity': {
            name: 'My User',
            publicKey: PUBLIC_KEY,
            privateKey: { type: 'file', id: 'attest-it-test-key' },
          },
        },
      })

      vi.mocked(core.getActiveIdentity).mockReturnValue({
        name: 'My User',
        publicKey: PUBLIC_KEY,
        privateKey: { type: 'file', id: 'attest-it-test-key' },
      })

      mockPolicy({
        version: 1,
        settings: {
          maxAgeDays: 30,
          publicKeyPath: '.attest-it/pubkey.pem',
          attestationsPath: '.attest-it/attestations.json',
          sealsPath: '.attest-it/seals.json',
        },
        team: {},
      })

      await runJoin()

      expect(prompts.input).not.toHaveBeenCalled()
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringMatching(/✓.*Team member "my-identity" added successfully/),
      )
    })
  })

  describe('gate authorization flow', () => {
    it('should skip authorization prompt when no gates defined', async () => {
      vi.mocked(core.loadLocalConfig).mockResolvedValue({
        activeIdentity: 'new-user',
        identities: {
          'new-user': {
            name: 'New User',
            publicKey: PUBLIC_KEY,
            privateKey: { type: 'file', id: 'attest-it-test-key' },
          },
        },
      })

      vi.mocked(core.getActiveIdentity).mockReturnValue({
        name: 'New User',
        publicKey: PUBLIC_KEY,
        privateKey: { type: 'file', id: 'attest-it-test-key' },
      })

      mockPolicy({
        version: 1,
        settings: {
          maxAgeDays: 30,
          publicKeyPath: '.attest-it/pubkey.pem',
          attestationsPath: '.attest-it/attestations.json',
          sealsPath: '.attest-it/seals.json',
        },
        team: {},
      })

      await runJoin()

      expect(prompts.checkbox).not.toHaveBeenCalled()
    })

    it('should skip authorization prompt when gates object is empty', async () => {
      vi.mocked(core.loadLocalConfig).mockResolvedValue({
        activeIdentity: 'new-user',
        identities: {
          'new-user': {
            name: 'New User',
            publicKey: PUBLIC_KEY,
            privateKey: { type: 'file', id: 'attest-it-test-key' },
          },
        },
      })

      vi.mocked(core.getActiveIdentity).mockReturnValue({
        name: 'New User',
        publicKey: PUBLIC_KEY,
        privateKey: { type: 'file', id: 'attest-it-test-key' },
      })

      mockPolicy({
        version: 1,
        settings: {
          maxAgeDays: 30,
          publicKeyPath: '.attest-it/pubkey.pem',
          attestationsPath: '.attest-it/attestations.json',
          sealsPath: '.attest-it/seals.json',
        },
        team: {},
        gates: {},
      })

      await runJoin()

      expect(prompts.checkbox).not.toHaveBeenCalled()
    })

    it('should display checkbox selection for multiple gates', async () => {
      vi.mocked(core.loadLocalConfig).mockResolvedValue({
        activeIdentity: 'new-user',
        identities: {
          'new-user': {
            name: 'New User',
            publicKey: PUBLIC_KEY,
            privateKey: { type: 'file', id: 'attest-it-test-key' },
          },
        },
      })

      vi.mocked(core.getActiveIdentity).mockReturnValue({
        name: 'New User',
        publicKey: PUBLIC_KEY,
        privateKey: { type: 'file', id: 'attest-it-test-key' },
      })

      mockPolicy({
        version: 1,
        settings: {
          maxAgeDays: 30,
          publicKeyPath: '.attest-it/pubkey.pem',
          attestationsPath: '.attest-it/attestations.json',
          sealsPath: '.attest-it/seals.json',
        },
        team: {},
        gates: {
          'gate-1': makeGate({ name: 'First Gate' }),
          'gate-2': makeGate({ name: 'Second Gate' }),
          'gate-3': makeGate({ name: 'Third Gate' }),
        },
      })
      vi.mocked(prompts.checkbox).mockResolvedValue(['gate-1', 'gate-3'])

      await runJoin()

      expect(prompts.checkbox).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Select gates to authorize (use space to select):',
          choices: [
            { name: 'gate-1 - First Gate', value: 'gate-1' },
            { name: 'gate-2 - Second Gate', value: 'gate-2' },
            { name: 'gate-3 - Third Gate', value: 'gate-3' },
          ],
        }),
      )
    })

    it('should add selected gates to authorizedSigners array', async () => {
      vi.mocked(core.loadLocalConfig).mockResolvedValue({
        activeIdentity: 'new-user',
        identities: {
          'new-user': {
            name: 'New User',
            publicKey: PUBLIC_KEY,
            privateKey: { type: 'file', id: 'attest-it-test-key' },
          },
        },
      })

      vi.mocked(core.getActiveIdentity).mockReturnValue({
        name: 'New User',
        publicKey: PUBLIC_KEY,
        privateKey: { type: 'file', id: 'attest-it-test-key' },
      })

      mockPolicy({
        version: 1,
        settings: {
          maxAgeDays: 30,
          publicKeyPath: '.attest-it/pubkey.pem',
          attestationsPath: '.attest-it/attestations.json',
          sealsPath: '.attest-it/seals.json',
        },
        team: {},
        gates: {
          'gate-1': makeGate({ name: 'First Gate', authorizedSigners: ['existing-user'] }),
          'gate-2': makeGate({ name: 'Second Gate' }),
        },
      })
      vi.mocked(prompts.checkbox).mockResolvedValue(['gate-1', 'gate-2'])

      await runJoin()

      const writeCall = vi.mocked(fs.writeFile).mock.calls[0]
      expect(writeCall).toBeDefined()
      const yamlContent = writeCall?.[1] as string
      const parsedConfig = YAML.parse(yamlContent) as PolicyConfig

      expect(parsedConfig.gates?.['gate-1']?.authorizedSigners).toContain('existing-user')
      expect(parsedConfig.gates?.['gate-1']?.authorizedSigners).toContain('new-user')
      expect(parsedConfig.gates?.['gate-2']?.authorizedSigners).toContain('new-user')
      expect(parsedConfig.gates?.['gate-1']?.authorizedSigners).toHaveLength(2)
      expect(parsedConfig.gates?.['gate-2']?.authorizedSigners).toHaveLength(1)
    })

    it('should not duplicate user in authorizedSigners if already present', async () => {
      vi.mocked(core.loadLocalConfig).mockResolvedValue({
        activeIdentity: 'new-user',
        identities: {
          'new-user': {
            name: 'New User',
            publicKey: PUBLIC_KEY,
            privateKey: { type: 'file', id: 'attest-it-test-key' },
          },
        },
      })

      vi.mocked(core.getActiveIdentity).mockReturnValue({
        name: 'New User',
        publicKey: PUBLIC_KEY,
        privateKey: { type: 'file', id: 'attest-it-test-key' },
      })

      mockPolicy({
        version: 1,
        settings: {
          maxAgeDays: 30,
          publicKeyPath: '.attest-it/pubkey.pem',
          attestationsPath: '.attest-it/attestations.json',
          sealsPath: '.attest-it/seals.json',
        },
        team: {},
        gates: {
          'gate-1': makeGate({ name: 'First Gate', authorizedSigners: ['new-user'] }),
        },
      })
      vi.mocked(prompts.checkbox).mockResolvedValue(['gate-1'])

      await runJoin()

      const writeCall = vi.mocked(fs.writeFile).mock.calls[0]
      expect(writeCall).toBeDefined()
      const yamlContent = writeCall?.[1] as string
      const parsedConfig = YAML.parse(yamlContent) as PolicyConfig

      expect(parsedConfig.gates?.['gate-1']?.authorizedSigners).toEqual(['new-user'])
      expect(parsedConfig.gates?.['gate-1']?.authorizedSigners).toHaveLength(1)
    })
  })

  describe('non-interactive (issue #80)', () => {
    beforeEach(() => {
      Object.defineProperty(process.stdin, 'isTTY', { value: undefined, configurable: true })
    })

    it('should resolve a slug collision via --slug without prompting', async () => {
      vi.mocked(core.loadLocalConfig).mockResolvedValue({
        activeIdentity: 'taken-slug',
        identities: {
          'taken-slug': {
            name: 'New User',
            publicKey: PUBLIC_KEY,
            privateKey: { type: 'file', path: '/test/path' },
          },
        },
      })
      vi.mocked(core.getActiveIdentity).mockReturnValue({
        name: 'New User',
        publicKey: PUBLIC_KEY,
        privateKey: { type: 'file', path: '/test/path' },
      })
      mockPolicy({
        version: 1,
        settings: {
          maxAgeDays: 30,
          publicKeyPath: '.attest-it/pubkey.pem',
          attestationsPath: '.attest-it/attestations.json',
          sealsPath: '.attest-it/seals.json',
        },
        team: {
          'taken-slug': { name: 'Existing User', publicKey: 'different-key' },
        },
      })

      await runJoin({ slug: 'new-slug' })

      expect(prompts.input).not.toHaveBeenCalled()
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringMatching(/✓.*Team member "new-slug" added successfully/),
      )
    })

    it('should fail fast naming --slug when the slug collides and no TTY is available', async () => {
      vi.mocked(core.loadLocalConfig).mockResolvedValue({
        activeIdentity: 'taken-slug',
        identities: {
          'taken-slug': {
            name: 'New User',
            publicKey: PUBLIC_KEY,
            privateKey: { type: 'file', path: '/test/path' },
          },
        },
      })
      vi.mocked(core.getActiveIdentity).mockReturnValue({
        name: 'New User',
        publicKey: PUBLIC_KEY,
        privateKey: { type: 'file', path: '/test/path' },
      })
      mockPolicy({
        version: 1,
        settings: {
          maxAgeDays: 30,
          publicKeyPath: '.attest-it/pubkey.pem',
          attestationsPath: '.attest-it/attestations.json',
          sealsPath: '.attest-it/seals.json',
        },
        team: {
          'taken-slug': { name: 'Existing User', publicKey: 'different-key' },
        },
      })

      await expect(runJoin()).rejects.toThrow('process.exit')

      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringMatching(/✗.*--slug/))
    })

    it('should authorize gates listed in --gates without prompting', async () => {
      vi.mocked(core.loadLocalConfig).mockResolvedValue({
        activeIdentity: 'new-user',
        identities: {
          'new-user': {
            name: 'New User',
            publicKey: PUBLIC_KEY,
            privateKey: { type: 'file', path: '/test/path' },
          },
        },
      })
      vi.mocked(core.getActiveIdentity).mockReturnValue({
        name: 'New User',
        publicKey: PUBLIC_KEY,
        privateKey: { type: 'file', path: '/test/path' },
      })
      mockPolicy({
        version: 1,
        settings: {
          maxAgeDays: 30,
          publicKeyPath: '.attest-it/pubkey.pem',
          attestationsPath: '.attest-it/attestations.json',
          sealsPath: '.attest-it/seals.json',
        },
        team: {},
        gates: {
          'gate-1': makeGate({ name: 'First Gate' }),
          'gate-2': makeGate({ name: 'Second Gate' }),
        },
      })

      await runJoin({ gates: 'gate-1' })

      expect(prompts.checkbox).not.toHaveBeenCalled()
      const writeCall = vi.mocked(fs.writeFile).mock.calls[0]
      expect(writeCall).toBeDefined()
      const yamlContent = writeCall?.[1] as string
      const parsedConfig = YAML.parse(yamlContent) as PolicyConfig
      expect(parsedConfig.gates?.['gate-1']?.authorizedSigners).toContain('new-user')
      expect(parsedConfig.gates?.['gate-2']?.authorizedSigners).not.toContain('new-user')
    })

    it('should default to zero authorized gates when --gates is omitted and no TTY is available', async () => {
      vi.mocked(core.loadLocalConfig).mockResolvedValue({
        activeIdentity: 'new-user',
        identities: {
          'new-user': {
            name: 'New User',
            publicKey: PUBLIC_KEY,
            privateKey: { type: 'file', path: '/test/path' },
          },
        },
      })
      vi.mocked(core.getActiveIdentity).mockReturnValue({
        name: 'New User',
        publicKey: PUBLIC_KEY,
        privateKey: { type: 'file', path: '/test/path' },
      })
      mockPolicy({
        version: 1,
        settings: {
          maxAgeDays: 30,
          publicKeyPath: '.attest-it/pubkey.pem',
          attestationsPath: '.attest-it/attestations.json',
          sealsPath: '.attest-it/seals.json',
        },
        team: {},
        gates: {
          'gate-1': makeGate({ name: 'First Gate' }),
        },
      })

      await runJoin()

      expect(prompts.checkbox).not.toHaveBeenCalled()
      expect(mockProcessExit).not.toHaveBeenCalled()
      const writeCall = vi.mocked(fs.writeFile).mock.calls[0]
      expect(writeCall).toBeDefined()
      const yamlContent = writeCall?.[1] as string
      const parsedConfig = YAML.parse(yamlContent) as PolicyConfig
      expect(parsedConfig.gates?.['gate-1']?.authorizedSigners).not.toContain('new-user')
    })
  })
})
