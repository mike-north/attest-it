/**
 * Tests for cross-configuration validation.
 */

import { describe, expect, it } from 'vitest'
import { validateSuiteGateReferences } from '../../src/config/validation.js'
import type { OperationalConfig } from '../../src/config/operational-schema.js'
import type { PolicyConfig } from '../../src/config/policy-schema.js'

import * as fs from 'node:fs'
import * as path from 'node:path'
import { parsePolicyContent } from '../../src/config/policy-schema.js'
import { parseOperationalContent } from '../../src/config/operational-schema.js'

const FIXTURES_DIR = path.join(__dirname, '../fixtures/split-config')

describe('validation', () => {
  describe('validateSuiteGateReferences with fixture files', () => {
    it('should validate valid-policy.yaml and valid-operational.yaml fixtures without errors', () => {
      const policyYaml = fs.readFileSync(path.join(FIXTURES_DIR, 'valid-policy.yaml'), 'utf-8')
      const operationalYaml = fs.readFileSync(
        path.join(FIXTURES_DIR, 'valid-operational.yaml'),
        'utf-8',
      )

      const policy = parsePolicyContent(policyYaml, 'yaml')
      const operational = parseOperationalContent(operationalYaml, 'yaml')

      const errors = validateSuiteGateReferences(policy, operational)

      expect(errors).toEqual([])
    })

    it('should validate minimal-policy.yaml and minimal-operational.yaml fixtures without errors', () => {
      const policyYaml = fs.readFileSync(path.join(FIXTURES_DIR, 'minimal-policy.yaml'), 'utf-8')
      const operationalYaml = fs.readFileSync(
        path.join(FIXTURES_DIR, 'minimal-operational.yaml'),
        'utf-8',
      )

      const policy = parsePolicyContent(policyYaml, 'yaml')
      const operational = parseOperationalContent(operationalYaml, 'yaml')

      const errors = validateSuiteGateReferences(policy, operational)

      expect(errors).toEqual([])
    })

    it('should detect unknown gate in invalid-gate-reference.yaml fixture', () => {
      const policyYaml = fs.readFileSync(path.join(FIXTURES_DIR, 'minimal-policy.yaml'), 'utf-8')
      const operationalYaml = fs.readFileSync(
        path.join(FIXTURES_DIR, 'invalid-gate-reference.yaml'),
        'utf-8',
      )

      const policy = parsePolicyContent(policyYaml, 'yaml')
      const operational = parseOperationalContent(operationalYaml, 'yaml')

      const errors = validateSuiteGateReferences(policy, operational)

      expect(errors).toHaveLength(1)
      expect(errors[0].type).toBe('UNKNOWN_GATE')
      expect(errors[0].suite).toBe('test')
      expect(errors[0].gate).toBe('nonexistent-gate')
      expect(errors[0].message).toContain('nonexistent-gate')
      expect(errors[0].message).toContain('policy.yaml')
    })

    it('should detect missing team member in policy-missing-team-member.yaml fixture', () => {
      const policyYaml = fs.readFileSync(
        path.join(FIXTURES_DIR, 'policy-missing-team-member.yaml'),
        'utf-8',
      )
      const operationalYaml = `
version: 1
suites:
  test:
    gate: broken
    command: pnpm test
`

      const policy = parsePolicyContent(policyYaml, 'yaml')
      const operational = parseOperationalContent(operationalYaml, 'yaml')

      const errors = validateSuiteGateReferences(policy, operational)

      expect(errors).toHaveLength(1)
      expect(errors[0].type).toBe('MISSING_TEAM_MEMBER')
      expect(errors[0].suite).toBe('test')
      expect(errors[0].gate).toBe('broken')
      expect(errors[0].signer).toBe('charlie')
      expect(errors[0].message).toContain('charlie')
      expect(errors[0].message).toContain('broken')
      expect(errors[0].message).toContain('policy.yaml')
    })

    it('should validate end-to-end: parse fixtures, merge, and validate', () => {
      // This test demonstrates the complete workflow
      const policyYaml = fs.readFileSync(path.join(FIXTURES_DIR, 'valid-policy.yaml'), 'utf-8')
      const operationalYaml = fs.readFileSync(
        path.join(FIXTURES_DIR, 'valid-operational.yaml'),
        'utf-8',
      )

      // Step 1: Parse both files
      const policy = parsePolicyContent(policyYaml, 'yaml')
      const operational = parseOperationalContent(operationalYaml, 'yaml')

      // Step 2: Validate cross-references
      const errors = validateSuiteGateReferences(policy, operational)

      // Step 3: Verify no errors
      expect(errors).toEqual([])

      // All gates referenced by suites exist
      expect(policy.gates?.['security-tests']).toBeDefined()
      expect(policy.gates?.['unit-tests']).toBeDefined()

      // All signers in gates exist in team
      expect(policy.team?.alice).toBeDefined()
      expect(policy.team?.bob).toBeDefined()
    })
  })

  describe('validateSuiteGateReferences', () => {
    describe('positive tests (valid configurations)', () => {
      it('should return no errors for valid suite-gate references', () => {
        const policy: PolicyConfig = {
          version: 1,
          settings: {
            maxAgeDays: 30,
            publicKeyPath: '.attest-it/pubkey.pem',
            attestationsPath: '.attest-it/attestations.json',
          },
          team: {
            alice: {
              name: 'Alice Smith',
              publicKey: 'ssh-rsa ALICE_KEY',
            },
            bob: {
              name: 'Bob Jones',
              publicKey: 'ssh-rsa BOB_KEY',
            },
          },
          gates: {
            core: {
              name: 'Core Tests',
              description: 'Core package tests',
              authorizedSigners: ['alice', 'bob'],
              fingerprint: {
                paths: ['packages/core/**/*.ts'],
              },
              maxAge: '7d',
            },
          },
        }

        const operational: OperationalConfig = {
          version: 1,
          settings: {},
          suites: {
            unit: {
              gate: 'core',
              command: 'npm test',
            },
          },
        }

        const errors = validateSuiteGateReferences(policy, operational)

        expect(errors).toEqual([])
      })

      it('should return no errors with multiple suites referencing the same gate', () => {
        const policy: PolicyConfig = {
          version: 1,
          settings: {
            maxAgeDays: 30,
            publicKeyPath: '.attest-it/pubkey.pem',
            attestationsPath: '.attest-it/attestations.json',
          },
          team: {
            lead: {
              name: 'Team Lead',
              publicKey: 'ssh-rsa LEAD_KEY',
            },
          },
          gates: {
            core: {
              name: 'Core Tests',
              description: 'Core functionality tests',
              authorizedSigners: ['lead'],
              fingerprint: {
                paths: ['packages/core/**/*.ts'],
              },
              maxAge: '7d',
            },
          },
        }

        const operational: OperationalConfig = {
          version: 1,
          settings: {},
          suites: {
            unit: {
              gate: 'core',
              command: 'npm run test:unit',
            },
            integration: {
              gate: 'core',
              command: 'npm run test:integration',
            },
          },
        }

        const errors = validateSuiteGateReferences(policy, operational)

        expect(errors).toEqual([])
      })
    })

    describe('negative tests (invalid configurations)', () => {
      it('should return error when suite references non-existent gate', () => {
        const policy: PolicyConfig = {
          version: 1,
          settings: {
            maxAgeDays: 30,
            publicKeyPath: '.attest-it/pubkey.pem',
            attestationsPath: '.attest-it/attestations.json',
          },
          gates: {
            existing: {
              name: 'Existing Gate',
              description: 'This gate exists',
              authorizedSigners: ['alice'],
              fingerprint: {
                paths: ['src/**/*.ts'],
              },
              maxAge: '7d',
            },
          },
        }

        const operational: OperationalConfig = {
          version: 1,
          settings: {},
          suites: {
            unit: {
              gate: 'nonexistent',
              command: 'npm test',
            },
          },
        }

        const errors = validateSuiteGateReferences(policy, operational)

        expect(errors).toHaveLength(1)
        expect(errors[0]).toEqual({
          type: 'UNKNOWN_GATE',
          suite: 'unit',
          gate: 'nonexistent',
          message:
            'Suite "unit" references unknown gate "nonexistent". The gate must be defined in policy.yaml.',
        })
      })

      it('should return error when gate references non-existent team member', () => {
        const policy: PolicyConfig = {
          version: 1,
          settings: {
            maxAgeDays: 30,
            publicKeyPath: '.attest-it/pubkey.pem',
            attestationsPath: '.attest-it/attestations.json',
          },
          team: {
            alice: {
              name: 'Alice Smith',
              publicKey: 'ssh-rsa ALICE_KEY',
            },
          },
          gates: {
            core: {
              name: 'Core Tests',
              description: 'Core package tests',
              authorizedSigners: ['alice', 'bob'], // bob doesn't exist
              fingerprint: {
                paths: ['packages/core/**/*.ts'],
              },
              maxAge: '7d',
            },
          },
        }

        const operational: OperationalConfig = {
          version: 1,
          settings: {},
          suites: {
            unit: {
              gate: 'core',
              command: 'npm test',
            },
          },
        }

        const errors = validateSuiteGateReferences(policy, operational)

        expect(errors).toHaveLength(1)
        expect(errors[0]).toEqual({
          type: 'MISSING_TEAM_MEMBER',
          suite: 'unit',
          gate: 'core',
          signer: 'bob',
          message:
            'Gate "core" (referenced by suite "unit") authorizes signer "bob", but this team member is not defined in policy.yaml.',
        })
      })

      it('should return multiple errors for multiple missing team members', () => {
        const policy: PolicyConfig = {
          version: 1,
          settings: {
            maxAgeDays: 30,
            publicKeyPath: '.attest-it/pubkey.pem',
            attestationsPath: '.attest-it/attestations.json',
          },
          team: {},
          gates: {
            core: {
              name: 'Core Tests',
              description: 'Core package tests',
              authorizedSigners: ['alice', 'bob', 'charlie'],
              fingerprint: {
                paths: ['packages/core/**/*.ts'],
              },
              maxAge: '7d',
            },
          },
        }

        const operational: OperationalConfig = {
          version: 1,
          settings: {},
          suites: {
            unit: {
              gate: 'core',
              command: 'npm test',
            },
          },
        }

        const errors = validateSuiteGateReferences(policy, operational)

        expect(errors).toHaveLength(3)
        expect(errors[0].type).toBe('MISSING_TEAM_MEMBER')
        expect(errors[0].signer).toBe('alice')
        expect(errors[1].type).toBe('MISSING_TEAM_MEMBER')
        expect(errors[1].signer).toBe('bob')
        expect(errors[2].type).toBe('MISSING_TEAM_MEMBER')
        expect(errors[2].signer).toBe('charlie')
      })

      it('should return errors for multiple suites with issues', () => {
        const policy: PolicyConfig = {
          version: 1,
          settings: {
            maxAgeDays: 30,
            publicKeyPath: '.attest-it/pubkey.pem',
            attestationsPath: '.attest-it/attestations.json',
          },
          team: {
            alice: {
              name: 'Alice Smith',
              publicKey: 'ssh-rsa ALICE_KEY',
            },
          },
          gates: {
            existing: {
              name: 'Existing Gate',
              description: 'This gate exists',
              authorizedSigners: ['alice', 'bob'], // bob doesn't exist
              fingerprint: {
                paths: ['src/**/*.ts'],
              },
              maxAge: '7d',
            },
          },
        }

        const operational: OperationalConfig = {
          version: 1,
          settings: {},
          suites: {
            unit: {
              gate: 'nonexistent', // Gate doesn't exist
              command: 'npm test',
            },
            integration: {
              gate: 'existing', // Gate exists but has missing team member
              command: 'npm run test:integration',
            },
          },
        }

        const errors = validateSuiteGateReferences(policy, operational)

        expect(errors.length).toBeGreaterThanOrEqual(2)
        expect(errors.some((e) => e.type === 'UNKNOWN_GATE' && e.suite === 'unit')).toBe(true)
        expect(
          errors.some((e) => e.type === 'MISSING_TEAM_MEMBER' && e.suite === 'integration'),
        ).toBe(true)
      })

      it('should skip validation and not report errors for non-existent team members in gates not referenced by suites', () => {
        const policy: PolicyConfig = {
          version: 1,
          settings: {
            maxAgeDays: 30,
            publicKeyPath: '.attest-it/pubkey.pem',
            attestationsPath: '.attest-it/attestations.json',
          },
          team: {
            alice: {
              name: 'Alice Smith',
              publicKey: 'ssh-rsa ALICE_KEY',
            },
          },
          gates: {
            unused: {
              name: 'Unused Gate',
              description: 'This gate is not used',
              authorizedSigners: ['nonexistent'], // This should not cause an error
              fingerprint: {
                paths: ['src/**/*.ts'],
              },
              maxAge: '7d',
            },
            used: {
              name: 'Used Gate',
              description: 'This gate is used',
              authorizedSigners: ['alice'],
              fingerprint: {
                paths: ['src/**/*.ts'],
              },
              maxAge: '7d',
            },
          },
        }

        const operational: OperationalConfig = {
          version: 1,
          settings: {},
          suites: {
            unit: {
              gate: 'used',
              command: 'npm test',
            },
          },
        }

        const errors = validateSuiteGateReferences(policy, operational)

        expect(errors).toEqual([])
      })
    })

    describe('edge cases', () => {
      it('should handle undefined gates in policy', () => {
        const policy: PolicyConfig = {
          version: 1,
          settings: {
            maxAgeDays: 30,
            publicKeyPath: '.attest-it/pubkey.pem',
            attestationsPath: '.attest-it/attestations.json',
          },
        }

        const operational: OperationalConfig = {
          version: 1,
          settings: {},
          suites: {
            unit: {
              gate: 'core',
              command: 'npm test',
            },
          },
        }

        const errors = validateSuiteGateReferences(policy, operational)

        expect(errors).toHaveLength(1)
        expect(errors[0].type).toBe('UNKNOWN_GATE')
        expect(errors[0].gate).toBe('core')
      })

      it('should handle undefined team in policy', () => {
        const policy: PolicyConfig = {
          version: 1,
          settings: {
            maxAgeDays: 30,
            publicKeyPath: '.attest-it/pubkey.pem',
            attestationsPath: '.attest-it/attestations.json',
          },
          gates: {
            core: {
              name: 'Core Tests',
              description: 'Core package tests',
              authorizedSigners: ['alice'],
              fingerprint: {
                paths: ['packages/core/**/*.ts'],
              },
              maxAge: '7d',
            },
          },
        }

        const operational: OperationalConfig = {
          version: 1,
          settings: {},
          suites: {
            unit: {
              gate: 'core',
              command: 'npm test',
            },
          },
        }

        const errors = validateSuiteGateReferences(policy, operational)

        expect(errors).toHaveLength(1)
        expect(errors[0].type).toBe('MISSING_TEAM_MEMBER')
        expect(errors[0].signer).toBe('alice')
      })

      it('should handle empty gates object in policy', () => {
        const policy: PolicyConfig = {
          version: 1,
          settings: {
            maxAgeDays: 30,
            publicKeyPath: '.attest-it/pubkey.pem',
            attestationsPath: '.attest-it/attestations.json',
          },
          gates: {},
        }

        const operational: OperationalConfig = {
          version: 1,
          settings: {},
          suites: {
            unit: {
              gate: 'core',
              command: 'npm test',
            },
          },
        }

        const errors = validateSuiteGateReferences(policy, operational)

        expect(errors).toHaveLength(1)
        expect(errors[0].type).toBe('UNKNOWN_GATE')
      })

      it('should handle empty team object in policy', () => {
        const policy: PolicyConfig = {
          version: 1,
          settings: {
            maxAgeDays: 30,
            publicKeyPath: '.attest-it/pubkey.pem',
            attestationsPath: '.attest-it/attestations.json',
          },
          team: {},
          gates: {
            core: {
              name: 'Core Tests',
              description: 'Core package tests',
              authorizedSigners: ['alice'],
              fingerprint: {
                paths: ['packages/core/**/*.ts'],
              },
              maxAge: '7d',
            },
          },
        }

        const operational: OperationalConfig = {
          version: 1,
          settings: {},
          suites: {
            unit: {
              gate: 'core',
              command: 'npm test',
            },
          },
        }

        const errors = validateSuiteGateReferences(policy, operational)

        expect(errors).toHaveLength(1)
        expect(errors[0].type).toBe('MISSING_TEAM_MEMBER')
      })

      it('should handle gate with empty authorizedSigners array', () => {
        const policy: PolicyConfig = {
          version: 1,
          settings: {
            maxAgeDays: 30,
            publicKeyPath: '.attest-it/pubkey.pem',
            attestationsPath: '.attest-it/attestations.json',
          },
          team: {
            alice: {
              name: 'Alice Smith',
              publicKey: 'ssh-rsa ALICE_KEY',
            },
          },
          gates: {
            core: {
              name: 'Core Tests',
              description: 'Core package tests',
              authorizedSigners: [], // This should be caught by schema validation, but we handle it gracefully
              fingerprint: {
                paths: ['packages/core/**/*.ts'],
              },
              maxAge: '7d',
            },
          },
        }

        const operational: OperationalConfig = {
          version: 1,
          settings: {},
          suites: {
            unit: {
              gate: 'core',
              command: 'npm test',
            },
          },
        }

        const errors = validateSuiteGateReferences(policy, operational)

        // No errors because there are no signers to validate
        expect(errors).toEqual([])
      })
    })

    describe('error message content', () => {
      it('should include all relevant information in UNKNOWN_GATE error messages', () => {
        const policy: PolicyConfig = {
          version: 1,
          settings: {
            maxAgeDays: 30,
            publicKeyPath: '.attest-it/pubkey.pem',
            attestationsPath: '.attest-it/attestations.json',
          },
        }

        const operational: OperationalConfig = {
          version: 1,
          settings: {},
          suites: {
            'my-suite': {
              gate: 'missing-gate',
              command: 'npm test',
            },
          },
        }

        const errors = validateSuiteGateReferences(policy, operational)

        expect(errors[0].message).toContain('my-suite')
        expect(errors[0].message).toContain('missing-gate')
        expect(errors[0].message).toContain('policy.yaml')
      })

      it('should include all relevant information in MISSING_TEAM_MEMBER error messages', () => {
        const policy: PolicyConfig = {
          version: 1,
          settings: {
            maxAgeDays: 30,
            publicKeyPath: '.attest-it/pubkey.pem',
            attestationsPath: '.attest-it/attestations.json',
          },
          gates: {
            'security-gate': {
              name: 'Security Gate',
              description: 'Security tests',
              authorizedSigners: ['missing-person'],
              fingerprint: {
                paths: ['src/**/*.ts'],
              },
              maxAge: '7d',
            },
          },
        }

        const operational: OperationalConfig = {
          version: 1,
          settings: {},
          suites: {
            'security-suite': {
              gate: 'security-gate',
              command: 'npm run test:security',
            },
          },
        }

        const errors = validateSuiteGateReferences(policy, operational)

        expect(errors[0].message).toContain('security-gate')
        expect(errors[0].message).toContain('security-suite')
        expect(errors[0].message).toContain('missing-person')
        expect(errors[0].message).toContain('policy.yaml')
      })
    })
  })
})
