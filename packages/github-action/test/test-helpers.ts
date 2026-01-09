import type { VerifyResult, SuiteVerificationResult, AttestItConfig } from '@attest-it/core'

/**
 * Creates a mock VerifyResult with sensible defaults
 */
export function createMockVerifyResult(overrides: Partial<VerifyResult> = {}): VerifyResult {
  return {
    success: true,
    signatureValid: true,
    suites: [],
    errors: [],
    ...overrides,
  }
}

/**
 * Creates a mock SuiteVerificationResult with sensible defaults
 */
export function createMockSuiteStatus(
  overrides: Partial<SuiteVerificationResult> = {},
): SuiteVerificationResult {
  const base: SuiteVerificationResult = {
    suite: 'test-suite',
    status: 'VALID',
    fingerprint: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    age: 5,
  }

  return {
    ...base,
    ...overrides,
  }
}

/**
 * Creates a mock AttestItConfig with sensible defaults
 */
export function createMockConfig(overrides: Partial<AttestItConfig> = {}): AttestItConfig {
  return {
    version: 1,
    settings: {
      maxAgeDays: 30,
      publicKeyPath: '.attest-it/public.pem',
      attestationsPath: '.attest-it/attestations.json',
      algorithm: 'ed25519',
    },
    suites: {
      'test-suite': {
        description: 'Test suite',
        packages: ['packages/core'],
      },
    },
    ...overrides,
  }
}
