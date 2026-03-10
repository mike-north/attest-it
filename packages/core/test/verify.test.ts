/**
 * Unit tests for the verification module.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { verifyAttestations } from '../src/verify.js'
import type { AttestItConfig, Attestation } from '../src/types.js'
import { writeAttestations, createAttestation } from '../src/attestation.js'
import { computeFingerprint } from '../src/fingerprint.js'

// Fixtures
const FIXTURES_DIR = path.join(__dirname, 'fixtures')
const FINGERPRINT_PROJECT = path.join(FIXTURES_DIR, 'fingerprint-test-project')

// Temporary test directory
const TEST_DIR = path.join(os.tmpdir(), 'attest-it-verify-test', Date.now().toString())

/**
 * Helper to create test configuration.
 */
function createTestConfig(overrides?: Partial<AttestItConfig>): AttestItConfig {
  return {
    version: 1,
    settings: {
      maxAgeDays: 30,
      publicKeyPath: path.join(TEST_DIR, 'public.pem'),
      attestationsPath: path.join(TEST_DIR, 'attestations.json'),
      sealsPath: path.join(TEST_DIR, 'seals.json'),
    },
    gates: {
      'default-gate': {
        name: 'Default Gate',
        description: 'Default test gate',
        authorizedSigners: ['testuser'],
        fingerprint: {
          paths: ['packages/pkg1'],
        },
        maxAge: '30d',
      },
    },
    suites: {
      unit: {
        gate: 'default-gate',
        command: 'npm test',
      },
    },
    ...overrides,
  }
}

/**
 * Helper to setup test environment with attestations file.
 */
async function setupTestEnvironment(options: {
  config: AttestItConfig
  attestations: Attestation[]
}): Promise<void> {
  const { config, attestations } = options

  // Create test directory
  await fs.promises.mkdir(TEST_DIR, { recursive: true })

  // Write attestations (signature verification removed — seals provide integrity)
  await writeAttestations(config.settings.attestationsPath, attestations, 'unsigned')
}

/**
 * Helper to clean up test environment.
 */
async function cleanupTestEnvironment(): Promise<void> {
  try {
    await fs.promises.rm(TEST_DIR, { recursive: true, force: true })
  } catch {
    // Ignore cleanup errors - empty catch is intentional for cleanup
  }
}

describe('verifyAttestations', () => {
  beforeEach(async () => {
    await cleanupTestEnvironment()
  })

  afterEach(async () => {
    await cleanupTestEnvironment()
  })

  describe('positive tests', () => {
    it('should return success when all attestations are valid', async () => {
      const config = createTestConfig({
        gates: {
          'test-gate': {
            name: 'Test Gate',
            description: 'Test gate',
            authorizedSigners: ['testuser'],
            fingerprint: {
              paths: [FINGERPRINT_PROJECT],
            },
            maxAge: '30d',
          },
        },
        suites: {
          unit: {
            gate: 'test-gate',
          },
        },
      })

      // Compute fingerprint for the test project
      const fingerprint = await computeFingerprint({
        paths: [FINGERPRINT_PROJECT],
        baseDir: TEST_DIR,
      })

      // Create attestation with the computed fingerprint
      const attestation = createAttestation({
        suite: 'unit',
        fingerprint: fingerprint.fingerprint,
        command: 'npm test',
      })

      await setupTestEnvironment({ config, attestations: [attestation] })

      const result = await verifyAttestations({
        config,
        repoRoot: TEST_DIR,
      })

      expect(result.success).toBe(true)
      expect(result.signatureValid).toBe(true)
      expect(result.errors).toHaveLength(0)
      expect(result.suites).toHaveLength(1)
      expect(result.suites[0]?.status).toBe('VALID')
    })

    it('should handle empty attestations file correctly', async () => {
      const config = createTestConfig({
        gates: {
          'test-gate': {
            name: 'Test Gate',
            description: 'Test gate',
            authorizedSigners: ['testuser'],
            fingerprint: {
              paths: [FINGERPRINT_PROJECT],
            },
            maxAge: '30d',
          },
        },
        suites: {
          unit: {
            gate: 'test-gate',
          },
        },
      })

      await setupTestEnvironment({ config, attestations: [] })

      const result = await verifyAttestations({
        config,
        repoRoot: TEST_DIR,
      })

      expect(result.success).toBe(false)
      expect(result.signatureValid).toBe(true)
      expect(result.suites).toHaveLength(1)
      expect(result.suites[0]?.status).toBe('NEEDS_ATTESTATION')
    })

    it('should calculate age correctly', async () => {
      const config = createTestConfig({
        settings: {
          maxAgeDays: 30,
          publicKeyPath: path.join(TEST_DIR, 'public.pem'),
          attestationsPath: path.join(TEST_DIR, 'attestations.json'),
          sealsPath: path.join(TEST_DIR, 'seals.json'),
        },
        gates: {
          'test-gate': {
            name: 'Test Gate',
            description: 'Test gate',
            authorizedSigners: ['testuser'],
            fingerprint: {
              paths: [FINGERPRINT_PROJECT],
            },
            maxAge: '30d',
          },
        },
        suites: {
          unit: {
            gate: 'test-gate',
          },
        },
      })

      const fingerprint = await computeFingerprint({
        paths: [FINGERPRINT_PROJECT],
        baseDir: TEST_DIR,
      })

      // Create attestation from 5 days ago
      const fiveDaysAgo = new Date()
      fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5)

      const attestation: Attestation = {
        suite: 'unit',
        fingerprint: fingerprint.fingerprint,
        attestedAt: fiveDaysAgo.toISOString(),
        attestedBy: 'testuser',
        command: 'npm test',
        exitCode: 0,
      }

      await setupTestEnvironment({ config, attestations: [attestation] })

      const result = await verifyAttestations({
        config,
        repoRoot: TEST_DIR,
      })

      expect(result.success).toBe(true)
      expect(result.suites[0]?.status).toBe('VALID')
      expect(result.suites[0]?.age).toBeGreaterThanOrEqual(4)
      expect(result.suites[0]?.age).toBeLessThanOrEqual(6)
    })

    it('should handle multiple suites all valid', async () => {
      const config = createTestConfig({
        gates: {
          'test-gate': {
            name: 'Test Gate',
            description: 'Test gate',
            authorizedSigners: ['testuser'],
            fingerprint: {
              paths: [FINGERPRINT_PROJECT],
            },
            maxAge: '30d',
          },
        },
        suites: {
          unit: {
            gate: 'test-gate',
          },
          integration: {
            gate: 'test-gate',
          },
        },
      })

      const fingerprint = await computeFingerprint({
        paths: [FINGERPRINT_PROJECT],
        baseDir: TEST_DIR,
      })

      const attestations = [
        createAttestation({
          suite: 'unit',
          fingerprint: fingerprint.fingerprint,
          command: 'npm test',
        }),
        createAttestation({
          suite: 'integration',
          fingerprint: fingerprint.fingerprint,
          command: 'npm run test:integration',
        }),
      ]

      await setupTestEnvironment({ config, attestations })

      const result = await verifyAttestations({
        config,
        repoRoot: TEST_DIR,
      })

      expect(result.success).toBe(true)
      expect(result.suites).toHaveLength(2)
      expect(result.suites[0]?.status).toBe('VALID')
      expect(result.suites[1]?.status).toBe('VALID')
    })
  })

  describe('status tests', () => {
    it('should return NEEDS_ATTESTATION when no attestation exists', async () => {
      const config = createTestConfig({
        gates: {
          'test-gate': {
            name: 'Test Gate',
            description: 'Test gate',
            authorizedSigners: ['testuser'],
            fingerprint: {
              paths: [FINGERPRINT_PROJECT],
            },
            maxAge: '30d',
          },
        },
        suites: {
          unit: {
            gate: 'test-gate',
          },
        },
      })

      await setupTestEnvironment({ config, attestations: [] })

      const result = await verifyAttestations({
        config,
        repoRoot: TEST_DIR,
      })

      expect(result.success).toBe(false)
      expect(result.suites[0]?.status).toBe('NEEDS_ATTESTATION')
      expect(result.suites[0]?.message).toContain('No attestation found')
    })

    it('should return FINGERPRINT_CHANGED when code changed', async () => {
      const config = createTestConfig({
        gates: {
          'test-gate': {
            name: 'Test Gate',
            description: 'Test gate',
            authorizedSigners: ['testuser'],
            fingerprint: {
              paths: [FINGERPRINT_PROJECT],
            },
            maxAge: '30d',
          },
        },
        suites: {
          unit: {
            gate: 'test-gate',
          },
        },
      })

      // Create attestation with a different fingerprint
      const attestation = createAttestation({
        suite: 'unit',
        fingerprint: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
        command: 'npm test',
      })

      await setupTestEnvironment({ config, attestations: [attestation] })

      const result = await verifyAttestations({
        config,
        repoRoot: TEST_DIR,
      })

      expect(result.success).toBe(false)
      expect(result.suites[0]?.status).toBe('FINGERPRINT_CHANGED')
      expect(result.suites[0]?.message).toContain('Fingerprint changed')
    })

    it('should return EXPIRED when attestation too old', async () => {
      const config = createTestConfig({
        settings: {
          maxAgeDays: 7,
          publicKeyPath: path.join(TEST_DIR, 'public.pem'),
          attestationsPath: path.join(TEST_DIR, 'attestations.json'),
          sealsPath: path.join(TEST_DIR, 'seals.json'),
        },
        gates: {
          'test-gate': {
            name: 'Test Gate',
            description: 'Test gate',
            authorizedSigners: ['testuser'],
            fingerprint: {
              paths: [FINGERPRINT_PROJECT],
            },
            maxAge: '30d',
          },
        },
        suites: {
          unit: {
            gate: 'test-gate',
          },
        },
      })

      const fingerprint = await computeFingerprint({
        paths: [FINGERPRINT_PROJECT],
        baseDir: TEST_DIR,
      })

      // Create attestation from 10 days ago
      const tenDaysAgo = new Date()
      tenDaysAgo.setDate(tenDaysAgo.getDate() - 10)

      const attestation: Attestation = {
        suite: 'unit',
        fingerprint: fingerprint.fingerprint,
        attestedAt: tenDaysAgo.toISOString(),
        attestedBy: 'testuser',
        command: 'npm test',
        exitCode: 0,
      }

      await setupTestEnvironment({ config, attestations: [attestation] })

      const result = await verifyAttestations({
        config,
        repoRoot: TEST_DIR,
      })

      expect(result.success).toBe(false)
      expect(result.suites[0]?.status).toBe('EXPIRED')
      expect(result.suites[0]?.message).toContain('expired')
      expect(result.suites[0]?.age).toBeGreaterThanOrEqual(9)
    })

    it('should return INVALIDATED_BY_PARENT for invalidation chains', async () => {
      const config = createTestConfig({
        gates: {
          'test-gate': {
            name: 'Test Gate',
            description: 'Test gate',
            authorizedSigners: ['testuser'],
            fingerprint: {
              paths: [FINGERPRINT_PROJECT],
            },
            maxAge: '30d',
          },
        },
        suites: {
          unit: {
            gate: 'test-gate',
            invalidates: ['integration'],
          },
          integration: {
            gate: 'test-gate',
          },
        },
      })

      const fingerprint = await computeFingerprint({
        paths: [FINGERPRINT_PROJECT],
        baseDir: TEST_DIR,
      })

      // Integration attested 1 hour ago
      const oneHourAgo = new Date()
      oneHourAgo.setHours(oneHourAgo.getHours() - 1)

      // Unit attested now (more recent)
      const now = new Date()

      const attestations: Attestation[] = [
        {
          suite: 'integration',
          fingerprint: fingerprint.fingerprint,
          attestedAt: oneHourAgo.toISOString(),
          attestedBy: 'testuser',
          command: 'npm run test:integration',
          exitCode: 0,
        },
        {
          suite: 'unit',
          fingerprint: fingerprint.fingerprint,
          attestedAt: now.toISOString(),
          attestedBy: 'testuser',
          command: 'npm test',
          exitCode: 0,
        },
      ]

      await setupTestEnvironment({ config, attestations })

      const result = await verifyAttestations({
        config,
        repoRoot: TEST_DIR,
      })

      expect(result.success).toBe(false)
      const integrationResult = result.suites.find((s) => s.suite === 'integration')
      expect(integrationResult?.status).toBe('INVALIDATED_BY_PARENT')
      expect(integrationResult?.message).toContain('Invalidated by unit')
    })
  })

  describe('edge cases', () => {
    it('should handle missing attestations file (fresh repo)', async () => {
      const config = createTestConfig({
        gates: {
          'test-gate': {
            name: 'Test Gate',
            description: 'Test gate',
            authorizedSigners: ['testuser'],
            fingerprint: {
              paths: [FINGERPRINT_PROJECT],
            },
            maxAge: '30d',
          },
        },
        suites: {
          unit: {
            gate: 'test-gate',
          },
        },
      })

      await fs.promises.mkdir(TEST_DIR, { recursive: true })

      const result = await verifyAttestations({
        config,
        repoRoot: TEST_DIR,
      })

      expect(result.success).toBe(false)
      expect(result.signatureValid).toBe(true) // No signature to validate
      expect(result.suites).toHaveLength(1)
      expect(result.suites[0]?.status).toBe('NEEDS_ATTESTATION')
    })

    it('should handle empty suites config', async () => {
      const config = createTestConfig({
        suites: {},
      })

      await fs.promises.mkdir(TEST_DIR, { recursive: true })

      const result = await verifyAttestations({
        config,
        repoRoot: TEST_DIR,
      })

      expect(result.success).toBe(true)
      expect(result.suites).toHaveLength(0)
    })

    it('should handle circular invalidation chains without infinite loop', async () => {
      const config = createTestConfig({
        gates: {
          'test-gate': {
            name: 'Test Gate',
            description: 'Test gate',
            authorizedSigners: ['testuser'],
            fingerprint: {
              paths: [FINGERPRINT_PROJECT],
            },
            maxAge: '30d',
          },
        },
        suites: {
          unit: {
            gate: 'test-gate',
            invalidates: ['integration'],
          },
          integration: {
            gate: 'test-gate',
            invalidates: ['unit'],
          },
        },
      })

      const fingerprint = await computeFingerprint({
        paths: [FINGERPRINT_PROJECT],
        baseDir: TEST_DIR,
      })

      const attestations = [
        createAttestation({
          suite: 'unit',
          fingerprint: fingerprint.fingerprint,
          command: 'npm test',
        }),
        createAttestation({
          suite: 'integration',
          fingerprint: fingerprint.fingerprint,
          command: 'npm run test:integration',
        }),
      ]

      await setupTestEnvironment({ config, attestations })

      // This should complete without hanging
      const result = await verifyAttestations({
        config,
        repoRoot: TEST_DIR,
      })

      expect(result).toBeDefined()
      expect(result.suites).toHaveLength(2)
    })
  })

  describe('integration tests', () => {
    it('should complete full workflow with real signing and verification', async () => {
      const config = createTestConfig({
        gates: {
          'test-gate': {
            name: 'Test Gate',
            description: 'Test gate',
            authorizedSigners: ['testuser'],
            fingerprint: {
              paths: [FINGERPRINT_PROJECT],
            },
            maxAge: '30d',
          },
        },
        suites: {
          unit: {
            gate: 'test-gate',
          },
          integration: {
            gate: 'test-gate',
          },
        },
      })

      // Step 1: Compute fingerprints
      const fingerprint = await computeFingerprint({
        paths: [FINGERPRINT_PROJECT],
        baseDir: TEST_DIR,
      })

      // Step 2: Create attestations
      const attestations = [
        createAttestation({
          suite: 'unit',
          fingerprint: fingerprint.fingerprint,
          command: 'npm test',
        }),
        createAttestation({
          suite: 'integration',
          fingerprint: fingerprint.fingerprint,
          command: 'npm run test:integration',
        }),
      ]

      // Step 3: Sign and write attestations
      await setupTestEnvironment({ config, attestations })

      // Step 4: Verify attestations
      const result = await verifyAttestations({
        config,
        repoRoot: TEST_DIR,
      })

      // All should be valid
      expect(result.success).toBe(true)
      expect(result.signatureValid).toBe(true)
      expect(result.errors).toHaveLength(0)
      expect(result.suites).toHaveLength(2)
      expect(result.suites.every((s) => s.status === 'VALID')).toBe(true)
    })

    it('should detect changes after attestation', async () => {
      const tempProject = path.join(TEST_DIR, 'temp-project')
      await fs.promises.mkdir(tempProject, { recursive: true })

      // Create initial file
      const testFile = path.join(tempProject, 'test.txt')
      await fs.promises.writeFile(testFile, 'initial content')

      const config = createTestConfig({
        gates: {
          'temp-gate': {
            name: 'Temp Gate',
            description: 'Temp gate for testing',
            authorizedSigners: ['testuser'],
            fingerprint: {
              paths: [tempProject],
            },
            maxAge: '30d',
          },
        },
        suites: {
          unit: {
            gate: 'temp-gate',
          },
        },
      })

      // Compute initial fingerprint and create attestation
      const initialFingerprint = await computeFingerprint({
        paths: [tempProject],
        baseDir: TEST_DIR,
      })

      const attestation = createAttestation({
        suite: 'unit',
        fingerprint: initialFingerprint.fingerprint,
        command: 'npm test',
      })

      await setupTestEnvironment({ config, attestations: [attestation] })

      // Verify - should be valid
      let result = await verifyAttestations({
        config,
        repoRoot: TEST_DIR,
      })
      expect(result.success).toBe(true)
      expect(result.suites[0]?.status).toBe('VALID')

      // Change the file
      await fs.promises.writeFile(testFile, 'modified content')

      // Verify again - should detect change
      result = await verifyAttestations({
        config,
        repoRoot: TEST_DIR,
      })
      expect(result.success).toBe(false)
      expect(result.suites[0]?.status).toBe('FINGERPRINT_CHANGED')
    })
  })
})
