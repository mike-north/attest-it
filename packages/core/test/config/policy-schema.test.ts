/**
 * Tests for policy configuration schema and validation.
 */

import { describe, expect, it } from 'vitest'
import {
  type PolicyConfig,
  PolicyValidationError,
  parsePolicyContent,
  policySchema,
} from '../../src/config/policy-schema.js'

import * as fs from 'node:fs'
import * as path from 'node:path'

const FIXTURES_DIR = path.join(__dirname, '../fixtures/split-config')

describe('policy-schema', () => {
  describe('parsePolicyContent with fixture files', () => {
    it('should parse valid-policy.yaml fixture', () => {
      const yaml = fs.readFileSync(path.join(FIXTURES_DIR, 'valid-policy.yaml'), 'utf-8')
      const config = parsePolicyContent(yaml, 'yaml')

      expect(config.version).toBe(1)
      expect(config.settings.maxAgeDays).toBe(30)
      expect(config.settings.publicKeyPath).toBe('.attest-it/pubkey.pem')
      expect(config.settings.attestationsPath).toBe('.attest-it/attestations.json')
      expect(config.team).toBeDefined()
      expect(config.team?.alice).toBeDefined()
      expect(config.team?.alice.name).toBe('Alice Developer')
      expect(config.team?.alice.email).toBe('alice@example.com')
      expect(config.team?.alice.github).toBe('alice-dev')
      expect(config.team?.bob).toBeDefined()
      expect(config.gates).toBeDefined()
      expect(config.gates?.['security-tests']).toBeDefined()
      expect(config.gates?.['unit-tests']).toBeDefined()
    })

    it('should parse minimal-policy.yaml fixture', () => {
      const yaml = fs.readFileSync(path.join(FIXTURES_DIR, 'minimal-policy.yaml'), 'utf-8')
      const config = parsePolicyContent(yaml, 'yaml')

      expect(config.version).toBe(1)
      expect(config.team).toBeDefined()
      expect(config.team?.dev).toBeDefined()
      expect(config.team?.dev.name).toBe('Developer')
      expect(config.gates).toBeDefined()
      expect(config.gates?.default).toBeDefined()
      expect(config.gates?.default.name).toBe('Default Gate')
    })

    it('should parse policy-missing-team-member.yaml fixture without schema errors', () => {
      const yaml = fs.readFileSync(
        path.join(FIXTURES_DIR, 'policy-missing-team-member.yaml'),
        'utf-8',
      )
      const config = parsePolicyContent(yaml, 'yaml')

      // Schema validation should pass - this file is syntactically valid
      // The semantic error (charlie not being in team) is caught by validation.ts
      expect(config.version).toBe(1)
      expect(config.team).toBeDefined()
      expect(config.team?.alice).toBeDefined()
      expect(config.team?.charlie).toBeUndefined()
      expect(config.gates).toBeDefined()
      expect(config.gates?.broken).toBeDefined()
      expect(config.gates?.broken.authorizedSigners).toContain('charlie')
    })
  })

  describe('parsePolicyContent', () => {
    describe('positive tests', () => {
      it('should parse a minimal valid policy YAML', () => {
        const yaml = `
version: 1
settings:
  maxAgeDays: 30
  publicKeyPath: .attest-it/pubkey.pem
  attestationsPath: .attest-it/attestations.json
`
        const config = parsePolicyContent(yaml, 'yaml')

        expect(config.version).toBe(1)
        expect(config.settings.maxAgeDays).toBe(30)
        expect(config.settings.publicKeyPath).toBe('.attest-it/pubkey.pem')
        expect(config.settings.attestationsPath).toBe('.attest-it/attestations.json')
        expect(config.team).toBeUndefined()
        expect(config.gates).toBeUndefined()
      })

      it('should parse a valid policy JSON', () => {
        const json = JSON.stringify({
          version: 1,
          settings: {
            maxAgeDays: 30,
            publicKeyPath: '.attest-it/pubkey.pem',
            attestationsPath: '.attest-it/attestations.json',
          },
        })

        const config = parsePolicyContent(json, 'json')

        expect(config.version).toBe(1)
        expect(config.settings.maxAgeDays).toBe(30)
      })

      it('should apply default settings when settings object is empty', () => {
        const yaml = `
version: 1
settings: {}
`
        const config = parsePolicyContent(yaml, 'yaml')

        expect(config.settings.maxAgeDays).toBe(30)
        expect(config.settings.publicKeyPath).toBe('.attest-it/pubkey.pem')
        expect(config.settings.attestationsPath).toBe('.attest-it/attestations.json')
      })

      it('should apply defaults when settings is omitted', () => {
        const yaml = `
version: 1
`
        const config = parsePolicyContent(yaml, 'yaml')

        expect(config.settings.maxAgeDays).toBe(30)
        expect(config.settings.publicKeyPath).toBe('.attest-it/pubkey.pem')
        expect(config.settings.attestationsPath).toBe('.attest-it/attestations.json')
      })

      it('should parse policy with team members', () => {
        const yaml = `
version: 1
team:
  alice:
    name: Alice Smith
    email: alice@example.com
    github: alice-dev
    publicKey: ssh-rsa AAAAB3NzaC1yc2EAAA...
  bob:
    name: Bob Jones
    publicKey: ssh-rsa AAAAB3NzaC1yc2EBBB...
`
        const config = parsePolicyContent(yaml, 'yaml')

        expect(config.team).toBeDefined()
        expect(config.team?.alice).toBeDefined()
        expect(config.team?.alice.name).toBe('Alice Smith')
        expect(config.team?.alice.email).toBe('alice@example.com')
        expect(config.team?.alice.github).toBe('alice-dev')
        expect(config.team?.alice.publicKey).toContain('ssh-rsa')

        expect(config.team?.bob).toBeDefined()
        expect(config.team?.bob.name).toBe('Bob Jones')
        expect(config.team?.bob.email).toBeUndefined()
        expect(config.team?.bob.github).toBeUndefined()
      })

      it('should parse policy with gates', () => {
        const yaml = `
version: 1
gates:
  unit-tests:
    name: Unit Test Gate
    description: Requires unit tests to pass
    authorizedSigners:
      - alice
      - bob
    fingerprint:
      paths:
        - src/**/*.ts
        - test/**/*.test.ts
      exclude:
        - '**/*.spec.ts'
    maxAge: 7d
`
        const config = parsePolicyContent(yaml, 'yaml')

        expect(config.gates).toBeDefined()
        expect(config.gates?.['unit-tests']).toBeDefined()

        const gate = config.gates?.['unit-tests']
        expect(gate?.name).toBe('Unit Test Gate')
        expect(gate?.description).toBe('Requires unit tests to pass')
        expect(gate?.authorizedSigners).toEqual(['alice', 'bob'])
        expect(gate?.fingerprint.paths).toEqual(['src/**/*.ts', 'test/**/*.test.ts'])
        expect(gate?.fingerprint.exclude).toEqual(['**/*.spec.ts'])
        expect(gate?.maxAge).toBe('7d')
      })

      it('should parse policy with both team and gates', () => {
        const yaml = `
version: 1
settings:
  maxAgeDays: 60
team:
  alice:
    name: Alice
    publicKey: ssh-rsa AAA...
gates:
  security-review:
    name: Security Review
    description: Security team review required
    authorizedSigners:
      - alice
    fingerprint:
      paths:
        - security/**
    maxAge: 30d
`
        const config = parsePolicyContent(yaml, 'yaml')

        expect(config.settings.maxAgeDays).toBe(60)
        expect(config.team?.alice).toBeDefined()
        expect(config.gates?.['security-review']).toBeDefined()
      })

      it('should allow custom maxAgeDays', () => {
        const yaml = `
version: 1
settings:
  maxAgeDays: 90
`
        const config = parsePolicyContent(yaml, 'yaml')

        expect(config.settings.maxAgeDays).toBe(90)
      })

      it('should allow custom paths', () => {
        const yaml = `
version: 1
settings:
  publicKeyPath: custom/path/public.pem
  attestationsPath: custom/path/attestations.json
`
        const config = parsePolicyContent(yaml, 'yaml')

        expect(config.settings.publicKeyPath).toBe('custom/path/public.pem')
        expect(config.settings.attestationsPath).toBe('custom/path/attestations.json')
      })
    })

    describe('negative tests', () => {
      it('should reject policy with invalid version', () => {
        const yaml = `
version: 2
`
        expect(() => parsePolicyContent(yaml, 'yaml')).toThrow(PolicyValidationError)
        expect(() => parsePolicyContent(yaml, 'yaml')).toThrow('version')
      })

      it('should reject policy with missing version', () => {
        const yaml = `
settings:
  maxAgeDays: 30
`
        expect(() => parsePolicyContent(yaml, 'yaml')).toThrow(PolicyValidationError)
        expect(() => parsePolicyContent(yaml, 'yaml')).toThrow('version')
      })

      it('should reject policy with negative maxAgeDays', () => {
        const yaml = `
version: 1
settings:
  maxAgeDays: -1
`
        expect(() => parsePolicyContent(yaml, 'yaml')).toThrow(PolicyValidationError)
      })

      it('should reject policy with zero maxAgeDays', () => {
        const yaml = `
version: 1
settings:
  maxAgeDays: 0
`
        expect(() => parsePolicyContent(yaml, 'yaml')).toThrow(PolicyValidationError)
      })

      it('should reject policy with non-integer maxAgeDays', () => {
        const yaml = `
version: 1
settings:
  maxAgeDays: 30.5
`
        expect(() => parsePolicyContent(yaml, 'yaml')).toThrow(PolicyValidationError)
      })

      it('should reject policy with extra top-level properties', () => {
        const yaml = `
version: 1
extraProperty: invalid
`
        expect(() => parsePolicyContent(yaml, 'yaml')).toThrow(PolicyValidationError)
      })

      it('should reject policy with extra settings properties', () => {
        const yaml = `
version: 1
settings:
  maxAgeDays: 30
  keyProvider:
    type: filesystem
`
        expect(() => parsePolicyContent(yaml, 'yaml')).toThrow(PolicyValidationError)
      })

      it('should reject team member without name', () => {
        const yaml = `
version: 1
team:
  alice:
    publicKey: ssh-rsa AAA...
`
        expect(() => parsePolicyContent(yaml, 'yaml')).toThrow(PolicyValidationError)
        expect(() => parsePolicyContent(yaml, 'yaml')).toThrow('name')
      })

      it('should reject team member with empty name', () => {
        const yaml = `
version: 1
team:
  alice:
    name: ''
    publicKey: ssh-rsa AAA...
`
        expect(() => parsePolicyContent(yaml, 'yaml')).toThrow(PolicyValidationError)
      })

      it('should reject team member without public key', () => {
        const yaml = `
version: 1
team:
  alice:
    name: Alice
`
        expect(() => parsePolicyContent(yaml, 'yaml')).toThrow(PolicyValidationError)
        expect(() => parsePolicyContent(yaml, 'yaml')).toThrow('publicKey')
      })

      it('should reject team member with empty public key', () => {
        const yaml = `
version: 1
team:
  alice:
    name: Alice
    publicKey: ''
`
        expect(() => parsePolicyContent(yaml, 'yaml')).toThrow(PolicyValidationError)
      })

      it('should reject team member with invalid email', () => {
        const yaml = `
version: 1
team:
  alice:
    name: Alice
    email: not-an-email
    publicKey: ssh-rsa AAA...
`
        expect(() => parsePolicyContent(yaml, 'yaml')).toThrow(PolicyValidationError)
      })

      it('should reject gate without name', () => {
        const yaml = `
version: 1
gates:
  test:
    description: Test gate
    authorizedSigners:
      - alice
    fingerprint:
      paths:
        - src/**
    maxAge: 7d
`
        expect(() => parsePolicyContent(yaml, 'yaml')).toThrow(PolicyValidationError)
        expect(() => parsePolicyContent(yaml, 'yaml')).toThrow('name')
      })

      it('should reject gate without description', () => {
        const yaml = `
version: 1
gates:
  test:
    name: Test Gate
    authorizedSigners:
      - alice
    fingerprint:
      paths:
        - src/**
    maxAge: 7d
`
        expect(() => parsePolicyContent(yaml, 'yaml')).toThrow(PolicyValidationError)
        expect(() => parsePolicyContent(yaml, 'yaml')).toThrow('description')
      })

      it('should reject gate without authorizedSigners', () => {
        const yaml = `
version: 1
gates:
  test:
    name: Test Gate
    description: Test gate
    fingerprint:
      paths:
        - src/**
    maxAge: 7d
`
        expect(() => parsePolicyContent(yaml, 'yaml')).toThrow(PolicyValidationError)
        expect(() => parsePolicyContent(yaml, 'yaml')).toThrow('authorizedSigners')
      })

      it('should accept gate with empty authorizedSigners (valid intermediate state during setup)', () => {
        const yaml = `
version: 1
gates:
  test:
    name: Test Gate
    description: Test gate
    authorizedSigners: []
    fingerprint:
      paths:
        - src/**
    maxAge: 7d
`
        const result = parsePolicyContent(yaml, 'yaml')
        expect(result.gates?.test?.authorizedSigners).toEqual([])
      })

      it('should reject gate without fingerprint', () => {
        const yaml = `
version: 1
gates:
  test:
    name: Test Gate
    description: Test gate
    authorizedSigners:
      - alice
    maxAge: 7d
`
        expect(() => parsePolicyContent(yaml, 'yaml')).toThrow(PolicyValidationError)
        expect(() => parsePolicyContent(yaml, 'yaml')).toThrow('fingerprint')
      })

      it('should reject gate without maxAge', () => {
        const yaml = `
version: 1
gates:
  test:
    name: Test Gate
    description: Test gate
    authorizedSigners:
      - alice
    fingerprint:
      paths:
        - src/**
`
        expect(() => parsePolicyContent(yaml, 'yaml')).toThrow(PolicyValidationError)
        expect(() => parsePolicyContent(yaml, 'yaml')).toThrow('maxAge')
      })

      it('should reject gate with invalid maxAge duration', () => {
        const yaml = `
version: 1
gates:
  test:
    name: Test Gate
    description: Test gate
    authorizedSigners:
      - alice
    fingerprint:
      paths:
        - src/**
    maxAge: invalid
`
        expect(() => parsePolicyContent(yaml, 'yaml')).toThrow(PolicyValidationError)
        expect(() => parsePolicyContent(yaml, 'yaml')).toThrow('Duration must be')
      })

      it('should reject fingerprint without paths', () => {
        const yaml = `
version: 1
gates:
  test:
    name: Test Gate
    description: Test gate
    authorizedSigners:
      - alice
    fingerprint:
      exclude:
        - '**/*.spec.ts'
    maxAge: 7d
`
        expect(() => parsePolicyContent(yaml, 'yaml')).toThrow(PolicyValidationError)
        expect(() => parsePolicyContent(yaml, 'yaml')).toThrow('paths')
      })

      it('should reject fingerprint with empty paths array', () => {
        const yaml = `
version: 1
gates:
  test:
    name: Test Gate
    description: Test gate
    authorizedSigners:
      - alice
    fingerprint:
      paths: []
    maxAge: 7d
`
        expect(() => parsePolicyContent(yaml, 'yaml')).toThrow(PolicyValidationError)
        expect(() => parsePolicyContent(yaml, 'yaml')).toThrow('At least one path')
      })

      it('should reject invalid YAML syntax', () => {
        const yaml = `
version: 1
team: [unclosed array
`
        expect(() => parsePolicyContent(yaml, 'yaml')).toThrow(PolicyValidationError)
        expect(() => parsePolicyContent(yaml, 'yaml')).toThrow('Failed to parse YAML')
      })

      it('should reject invalid JSON syntax', () => {
        const json = `{"version": 1, "team": {`

        expect(() => parsePolicyContent(json, 'json')).toThrow(PolicyValidationError)
        expect(() => parsePolicyContent(json, 'json')).toThrow('Failed to parse JSON')
      })
    })

    describe('edge cases', () => {
      it('should handle very large maxAgeDays', () => {
        const yaml = `
version: 1
settings:
  maxAgeDays: 999999
`
        const config = parsePolicyContent(yaml, 'yaml')
        expect(config.settings.maxAgeDays).toBe(999999)
      })

      it('should handle team member with all optional fields omitted', () => {
        const yaml = `
version: 1
team:
  alice:
    name: Alice
    publicKey: ssh-rsa AAA...
`
        const config = parsePolicyContent(yaml, 'yaml')
        expect(config.team?.alice.email).toBeUndefined()
        expect(config.team?.alice.github).toBeUndefined()
      })

      it('should handle gate with exclude patterns', () => {
        const yaml = `
version: 1
gates:
  test:
    name: Test Gate
    description: Test gate
    authorizedSigners:
      - alice
    fingerprint:
      paths:
        - src/**
      exclude:
        - '**/*.spec.ts'
        - '**/node_modules/**'
    maxAge: 7d
`
        const config = parsePolicyContent(yaml, 'yaml')
        expect(config.gates?.test.fingerprint.exclude).toEqual([
          '**/*.spec.ts',
          '**/node_modules/**',
        ])
      })

      it('should handle gate without exclude patterns', () => {
        const yaml = `
version: 1
gates:
  test:
    name: Test Gate
    description: Test gate
    authorizedSigners:
      - alice
    fingerprint:
      paths:
        - src/**
    maxAge: 7d
`
        const config = parsePolicyContent(yaml, 'yaml')
        expect(config.gates?.test.fingerprint.exclude).toBeUndefined()
      })

      it('should handle empty team object', () => {
        const yaml = `
version: 1
team: {}
`
        const config = parsePolicyContent(yaml, 'yaml')
        expect(config.team).toEqual({})
      })

      it('should handle empty gates object', () => {
        const yaml = `
version: 1
gates: {}
`
        const config = parsePolicyContent(yaml, 'yaml')
        expect(config.gates).toEqual({})
      })

      it('should handle maxAge with various duration formats', () => {
        const testCases = [
          { duration: '7d', expected: '7d' },
          { duration: '24h', expected: '24h' },
          { duration: '30d', expected: '30d' },
          { duration: '1w', expected: '1w' },
        ]

        for (const { duration, expected } of testCases) {
          const yaml = `
version: 1
gates:
  test:
    name: Test Gate
    description: Test gate
    authorizedSigners:
      - alice
    fingerprint:
      paths:
        - src/**
    maxAge: ${duration}
`
          const config = parsePolicyContent(yaml, 'yaml')
          expect(config.gates?.test.maxAge).toBe(expected)
        }
      })

      it('should handle special characters in slugs', () => {
        const yaml = `
version: 1
team:
  'alice-dev@main':
    name: Alice
    publicKey: ssh-rsa AAA...
gates:
  'unit-tests:critical':
    name: Unit Tests
    description: Critical unit tests
    authorizedSigners:
      - 'alice-dev@main'
    fingerprint:
      paths:
        - src/**
    maxAge: 7d
`
        const config = parsePolicyContent(yaml, 'yaml')
        expect(config.team?.['alice-dev@main']).toBeDefined()
        expect(config.gates?.['unit-tests:critical']).toBeDefined()
      })
    })
  })

  describe('PolicyValidationError', () => {
    it('should include Zod issues in the error', () => {
      const yaml = `
version: 1
settings:
  maxAgeDays: -1
`
      try {
        parsePolicyContent(yaml, 'yaml')
        expect.fail('Expected PolicyValidationError to be thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(PolicyValidationError)
        if (error instanceof PolicyValidationError) {
          expect(error.issues).toBeDefined()
          expect(Array.isArray(error.issues)).toBe(true)
          expect(error.issues.length).toBeGreaterThan(0)
        }
      }
    })

    it('should have descriptive error message', () => {
      const yaml = `
version: 2
`
      try {
        parsePolicyContent(yaml, 'yaml')
        expect.fail('Expected PolicyValidationError to be thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(PolicyValidationError)
        if (error instanceof PolicyValidationError) {
          expect(error.message).toContain('Policy validation failed')
        }
      }
    })
  })

  describe('policySchema direct usage', () => {
    it('should validate correct policy object', () => {
      const policy: PolicyConfig = {
        version: 1,
        settings: {
          maxAgeDays: 30,
          publicKeyPath: '.attest-it/pubkey.pem',
          attestationsPath: '.attest-it/attestations.json',
        },
      }

      const result = policySchema.safeParse(policy)
      expect(result.success).toBe(true)
    })

    it('should reject invalid policy object', () => {
      const policy = {
        version: 2,
        settings: {
          maxAgeDays: 30,
        },
      }

      const result = policySchema.safeParse(policy)
      expect(result.success).toBe(false)
    })
  })
})
