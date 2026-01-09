import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createMockVerifyResult, createMockSuiteStatus, createMockConfig } from './test-helpers.js'

// Mock @actions/core
vi.mock('@actions/core', () => ({
  getInput: vi.fn(),
  setOutput: vi.fn(),
  setFailed: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  startGroup: vi.fn(),
  endGroup: vi.fn(),
}))

// Mock @attest-it/core
vi.mock('@attest-it/core', () => ({
  loadConfig: vi.fn(),
  verifyAttestations: vi.fn(),
  toAttestItConfig: vi.fn(),
}))

// Import after mocks are set up
const { run } = await import('../src/index.js')
const mockCoreModule = await import('@actions/core')
const mockAttestItCoreModule = await import('@attest-it/core')

// Use vi.mocked to get properly typed mocks
const mockCore = {
  getInput: vi.mocked(mockCoreModule.getInput),
  setOutput: vi.mocked(mockCoreModule.setOutput),
  setFailed: vi.mocked(mockCoreModule.setFailed),
  info: vi.mocked(mockCoreModule.info),
  error: vi.mocked(mockCoreModule.error),
  warning: vi.mocked(mockCoreModule.warning),
  startGroup: vi.mocked(mockCoreModule.startGroup),
  endGroup: vi.mocked(mockCoreModule.endGroup),
}

const mockLoadConfig = vi.mocked(mockAttestItCoreModule.loadConfig)
const mockVerifyAttestations = vi.mocked(mockAttestItCoreModule.verifyAttestations)
const mockToAttestItConfig = vi.mocked(mockAttestItCoreModule.toAttestItConfig)

describe('GitHub Action', () => {
  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks()

    // Default input values
    mockCore.getInput.mockImplementation((name: string) => {
      const defaults: Record<string, string> = {
        'config-path': '.attest-it/config.yaml',
        suite: '',
        'fail-on-missing': 'true',
        strict: 'false',
      }
      // eslint-disable-next-line security/detect-object-injection
      return defaults[name] ?? ''
    })

    // Default toAttestItConfig implementation - mimics the real function's behavior
    mockToAttestItConfig.mockImplementation((config) => ({
      version: config.version,
      settings: {
        maxAgeDays: config.settings.maxAgeDays,
        publicKeyPath: config.settings.publicKeyPath,
        attestationsPath: config.settings.attestationsPath,
        algorithm: config.settings.algorithm,
        ...(config.settings.defaultCommand !== undefined && {
          defaultCommand: config.settings.defaultCommand,
        }),
      },
      suites: Object.fromEntries(
        Object.entries(config.suites).map(([name, suite]) => [
          name,
          {
            packages: suite.packages,
            ...(suite.description !== undefined && { description: suite.description }),
            ...(suite.files !== undefined && { files: suite.files }),
            ...(suite.ignore !== undefined && { ignore: suite.ignore }),
            ...(suite.command !== undefined && { command: suite.command }),
            ...(suite.invalidates !== undefined && { invalidates: suite.invalidates }),
          },
        ]),
      ),
    }))
  })

  describe('Successful verification', () => {
    it('should succeed when all attestations are valid', async () => {
      const mockConfig = createMockConfig()
      const mockResult = createMockVerifyResult({
        suites: [
          createMockSuiteStatus({ suite: 'suite1', status: 'VALID', age: 5 }),
          createMockSuiteStatus({ suite: 'suite2', status: 'VALID', age: 10 }),
        ],
      })

      mockLoadConfig.mockResolvedValue(mockConfig)
      mockVerifyAttestations.mockResolvedValue(mockResult)

      // Run the action
      await run()

      expect(mockCore.setOutput).toHaveBeenCalledWith('valid', 'true')
      expect(mockCore.setOutput).toHaveBeenCalledWith('suites', JSON.stringify(mockResult.suites))
      expect(mockCore.info).toHaveBeenCalledWith('✓ All attestations valid')
      expect(mockCore.setFailed).not.toHaveBeenCalled()
    })

    it('should load config from custom path', async () => {
      mockCore.getInput.mockImplementation((name: string) => {
        if (name === 'config-path') return 'custom/path/config.yaml'
        return ''
      })

      const mockConfig = createMockConfig()
      const mockResult = createMockVerifyResult({
        suites: [createMockSuiteStatus()],
      })

      mockLoadConfig.mockResolvedValue(mockConfig)
      mockVerifyAttestations.mockResolvedValue(mockResult)

      await run()

      expect(mockLoadConfig).toHaveBeenCalledWith('custom/path/config.yaml')
    })

    it('should use default config path when not specified', async () => {
      mockCore.getInput.mockImplementation((name: string) => {
        if (name === 'config-path') return ''
        return ''
      })

      const mockConfig = createMockConfig()
      const mockResult = createMockVerifyResult({
        suites: [createMockSuiteStatus()],
      })

      mockLoadConfig.mockResolvedValue(mockConfig)
      mockVerifyAttestations.mockResolvedValue(mockResult)

      await run()

      expect(mockLoadConfig).toHaveBeenCalledWith(undefined)
    })
  })

  describe('Suite filtering', () => {
    it('should filter to specific suite when requested', async () => {
      mockCore.getInput.mockImplementation((name: string) => {
        if (name === 'suite') return 'suite1'
        if (name === 'config-path') return ''
        return ''
      })

      const mockConfig = createMockConfig({
        suites: {
          suite1: { description: 'Suite 1', packages: ['packages/suite1'] },
          suite2: { description: 'Suite 2', packages: ['packages/suite2'] },
        },
      })

      const mockResult = createMockVerifyResult({
        suites: [createMockSuiteStatus({ suite: 'suite1' })],
      })

      mockLoadConfig.mockResolvedValue(mockConfig)
      mockVerifyAttestations.mockResolvedValue(mockResult)

      await run()

      // Config should be modified to only include suite1
      const calls = mockVerifyAttestations.mock.calls
      expect(calls.length).toBe(1)
      const callConfig = calls[0]?.[0]?.config
      expect(callConfig).toBeDefined()
      if (!callConfig) {
        throw new Error('callConfig is undefined')
      }
      expect(Object.keys(callConfig.suites)).toEqual(['suite1'])
    })

    it('should fail when requested suite does not exist', async () => {
      mockCore.getInput.mockImplementation((name: string) => {
        if (name === 'suite') return 'nonexistent'
        if (name === 'config-path') return ''
        return ''
      })

      const mockConfig = createMockConfig({
        suites: { suite1: { description: 'Suite 1', packages: ['packages/suite1'] } },
      })

      mockLoadConfig.mockResolvedValue(mockConfig)

      await run()

      expect(mockCore.setFailed).toHaveBeenCalledWith('Suite "nonexistent" not found in config')
      expect(mockVerifyAttestations).not.toHaveBeenCalled()
    })
  })

  describe('Failure cases', () => {
    it('should fail when signature is invalid', async () => {
      const mockConfig = createMockConfig()
      const mockResult = createMockVerifyResult({
        success: false,
        signatureValid: false,
        suites: [createMockSuiteStatus()],
      })

      mockLoadConfig.mockResolvedValue(mockConfig)
      mockVerifyAttestations.mockResolvedValue(mockResult)

      await run()

      expect(mockCore.setFailed).toHaveBeenCalledWith('Attestation signature verification failed')
    })

    it('should fail when attestations are invalid and fail-on-missing is true', async () => {
      const mockConfig = createMockConfig()
      const mockResult = createMockVerifyResult({
        success: false,
        suites: [
          createMockSuiteStatus({ suite: 'suite1', status: 'EXPIRED' }),
          createMockSuiteStatus({ suite: 'suite2', status: 'NEEDS_ATTESTATION' }),
        ],
      })

      mockLoadConfig.mockResolvedValue(mockConfig)
      mockVerifyAttestations.mockResolvedValue(mockResult)

      await run()

      expect(mockCore.setFailed).toHaveBeenCalledWith('2 suite(s) have invalid attestations')
      expect(mockCore.startGroup).toHaveBeenCalledWith('Remediation steps')
      expect(mockCore.info).toHaveBeenCalledWith('Run: attest-it run --suite suite1')
      expect(mockCore.info).toHaveBeenCalledWith('Run: attest-it run --suite suite2')
    })

    it('should not fail when attestations are invalid but fail-on-missing is false', async () => {
      mockCore.getInput.mockImplementation((name: string) => {
        if (name === 'fail-on-missing') return 'false'
        if (name === 'config-path') return ''
        return ''
      })

      const mockConfig = createMockConfig()
      const mockResult = createMockVerifyResult({
        success: false,
        suites: [createMockSuiteStatus({ status: 'NEEDS_ATTESTATION' })],
      })

      mockLoadConfig.mockResolvedValue(mockConfig)
      mockVerifyAttestations.mockResolvedValue(mockResult)

      await run()

      expect(mockCore.setFailed).not.toHaveBeenCalled()
      expect(mockCore.info).toHaveBeenCalledWith('✓ All attestations valid')
    })

    it('should report errors from verification', async () => {
      const mockConfig = createMockConfig()
      const mockResult = createMockVerifyResult({
        errors: ['Error 1', 'Error 2'],
        suites: [createMockSuiteStatus()],
      })

      mockLoadConfig.mockResolvedValue(mockConfig)
      mockVerifyAttestations.mockResolvedValue(mockResult)

      await run()

      expect(mockCore.error).toHaveBeenCalledWith('Error 1')
      expect(mockCore.error).toHaveBeenCalledWith('Error 2')
    })

    it('should include suite messages in remediation steps', async () => {
      const mockConfig = createMockConfig()
      const mockResult = createMockVerifyResult({
        success: false,
        suites: [
          createMockSuiteStatus({
            suite: 'suite1',
            status: 'EXPIRED',
            message: 'Expired 5 days ago',
          }),
        ],
      })

      mockLoadConfig.mockResolvedValue(mockConfig)
      mockVerifyAttestations.mockResolvedValue(mockResult)

      await run()

      expect(mockCore.info).toHaveBeenCalledWith('  Reason: Expired 5 days ago')
    })
  })

  describe('Strict mode', () => {
    it('should fail on attestations approaching expiry in strict mode', async () => {
      mockCore.getInput.mockImplementation((name: string) => {
        if (name === 'strict') return 'true'
        if (name === 'config-path') return ''
        return ''
      })

      const mockConfig = createMockConfig()
      const mockResult = createMockVerifyResult({
        suites: [
          createMockSuiteStatus({ suite: 'suite1', status: 'VALID', age: 24 }),
          createMockSuiteStatus({ suite: 'suite2', status: 'VALID', age: 25 }),
        ],
      })

      mockLoadConfig.mockResolvedValue(mockConfig)
      mockVerifyAttestations.mockResolvedValue(mockResult)

      await run()

      expect(mockCore.setFailed).toHaveBeenCalledWith(
        'Attestations approaching expiry (strict mode)',
      )
      expect(mockCore.warning).toHaveBeenCalledWith('suite1 is 24 days old')
      expect(mockCore.warning).toHaveBeenCalledWith('suite2 is 25 days old')
    })

    it('should not fail on young attestations in strict mode', async () => {
      mockCore.getInput.mockImplementation((name: string) => {
        if (name === 'strict') return 'true'
        if (name === 'config-path') return ''
        return ''
      })

      const mockConfig = createMockConfig()
      const mockResult = createMockVerifyResult({
        suites: [
          createMockSuiteStatus({ status: 'VALID', age: 5 }),
          createMockSuiteStatus({ status: 'VALID', age: 15 }),
        ],
      })

      mockLoadConfig.mockResolvedValue(mockConfig)
      mockVerifyAttestations.mockResolvedValue(mockResult)

      await run()

      expect(mockCore.setFailed).not.toHaveBeenCalled()
      expect(mockCore.info).toHaveBeenCalledWith('✓ All attestations valid')
    })

    it('should not fail on old attestations when strict mode is off', async () => {
      mockCore.getInput.mockImplementation((name: string) => {
        if (name === 'strict') return 'false'
        if (name === 'config-path') return ''
        return ''
      })

      const mockConfig = createMockConfig()
      const mockResult = createMockVerifyResult({
        suites: [createMockSuiteStatus({ status: 'VALID', age: 25 })],
      })

      mockLoadConfig.mockResolvedValue(mockConfig)
      mockVerifyAttestations.mockResolvedValue(mockResult)

      await run()

      expect(mockCore.setFailed).not.toHaveBeenCalled()
      expect(mockCore.info).toHaveBeenCalledWith('✓ All attestations valid')
    })
  })

  describe('Error handling', () => {
    it('should handle loadConfig errors', async () => {
      mockLoadConfig.mockRejectedValue(new Error('Config not found'))

      await run()

      expect(mockCore.setFailed).toHaveBeenCalledWith('Config not found')
      expect(mockVerifyAttestations).not.toHaveBeenCalled()
    })

    it('should handle verifyAttestations errors', async () => {
      const mockConfig = createMockConfig()
      mockLoadConfig.mockResolvedValue(mockConfig)
      mockVerifyAttestations.mockRejectedValue(new Error('Verification failed'))

      await run()

      expect(mockCore.setFailed).toHaveBeenCalledWith('Verification failed')
    })

    it('should handle non-Error exceptions', async () => {
      mockLoadConfig.mockRejectedValue('String error')

      await run()

      expect(mockCore.setFailed).toHaveBeenCalledWith('Unknown error occurred')
    })
  })

  describe('Output logging', () => {
    it('should log suite status with age', async () => {
      const mockConfig = createMockConfig()
      const mockResult = createMockVerifyResult({
        suites: [
          createMockSuiteStatus({ suite: 'suite1', status: 'VALID', age: 5 }),
          createMockSuiteStatus({
            suite: 'suite2',
            status: 'EXPIRED',
            age: 31,
          }),
        ],
      })

      mockLoadConfig.mockResolvedValue(mockConfig)
      mockVerifyAttestations.mockResolvedValue(mockResult)

      await run()

      expect(mockCore.startGroup).toHaveBeenCalledWith('Attestation status')
      expect(mockCore.info).toHaveBeenCalledWith('✓ suite1: VALID (5 days)')
      expect(mockCore.info).toHaveBeenCalledWith('✗ suite2: EXPIRED (31 days)')
      expect(mockCore.endGroup).toHaveBeenCalled()
    })

    it('should log suite status without age when age is undefined', async () => {
      const mockConfig = createMockConfig()
      const mockResult = createMockVerifyResult({
        suites: [
          (() => {
            const status = createMockSuiteStatus({
              suite: 'suite1',
              status: 'NEEDS_ATTESTATION',
            })
            delete status.age
            return status
          })(),
        ],
      })

      mockLoadConfig.mockResolvedValue(mockConfig)
      mockVerifyAttestations.mockResolvedValue(mockResult)

      await run()

      expect(mockCore.info).toHaveBeenCalledWith('✗ suite1: NEEDS_ATTESTATION')
    })
  })

  describe('Edge cases', () => {
    it('should handle empty suite list', async () => {
      const mockConfig = createMockConfig({ suites: {} })
      const mockResult = createMockVerifyResult({ suites: [] })

      mockLoadConfig.mockResolvedValue(mockConfig)
      mockVerifyAttestations.mockResolvedValue(mockResult)

      await run()

      expect(mockCore.setFailed).not.toHaveBeenCalled()
      expect(mockCore.info).toHaveBeenCalledWith('✓ All attestations valid')
    })

    it('should handle age exactly at threshold (23 days)', async () => {
      mockCore.getInput.mockImplementation((name: string) => {
        if (name === 'strict') return 'true'
        if (name === 'config-path') return ''
        return ''
      })

      const mockConfig = createMockConfig()
      const mockResult = createMockVerifyResult({
        suites: [createMockSuiteStatus({ status: 'VALID', age: 23 })],
      })

      mockLoadConfig.mockResolvedValue(mockConfig)
      mockVerifyAttestations.mockResolvedValue(mockResult)

      await run()

      // Should NOT fail (threshold is > 23, not >= 23)
      expect(mockCore.setFailed).not.toHaveBeenCalled()
    })

    it('should handle age just over threshold (24 days)', async () => {
      mockCore.getInput.mockImplementation((name: string) => {
        if (name === 'strict') return 'true'
        if (name === 'config-path') return ''
        return ''
      })

      const mockConfig = createMockConfig()
      const mockResult = createMockVerifyResult({
        suites: [createMockSuiteStatus({ status: 'VALID', age: 24 })],
      })

      mockLoadConfig.mockResolvedValue(mockConfig)
      mockVerifyAttestations.mockResolvedValue(mockResult)

      await run()

      // Should fail (age > 23)
      expect(mockCore.setFailed).toHaveBeenCalledWith(
        'Attestations approaching expiry (strict mode)',
      )
    })
  })
})
