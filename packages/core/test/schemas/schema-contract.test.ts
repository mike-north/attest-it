/**
 * Schema Contract Tests
 *
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║  IMPORTANT: THESE TESTS ARE INTENTIONALLY STRICT ABOUT SCHEMA STABILITY     ║
 * ╠══════════════════════════════════════════════════════════════════════════════╣
 * ║  These tests validate sample configurations against the JSON Schema files.   ║
 * ║  They serve as CONTRACT TESTS to detect breaking schema changes.             ║
 * ║                                                                              ║
 * ║  The sample YAML fixtures represent REAL-WORLD configurations that users    ║
 * ║  have deployed. If these tests fail, it means users' configs would break.   ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 *
 * ┌──────────────────────────────────────────────────────────────────────────────┐
 * │  IF THESE TESTS FAIL AFTER A SCHEMA CHANGE:                                  │
 * │                                                                              │
 * │  ❌ DO NOT modify the tests to make them pass                                │
 * │  ❌ DO NOT modify the v1 schemas to make them pass                           │
 * │  ❌ DO NOT modify the fixture files to make them pass                        │
 * │                                                                              │
 * │  ✅ INSTEAD: Create a new schemas/v2/ directory:                             │
 * │     1. Copy schemas/v1/ to schemas/v2/                                       │
 * │     2. Update $id fields to use /v2/ path                                    │
 * │     3. Make your breaking changes in v2 only                                 │
 * │     4. Keep v1 unchanged (old configs still reference v1)                    │
 * │     5. Update code to generate new configs with v2 schema reference          │
 * │     6. Create new test fixtures for v2                                       │
 * │                                                                              │
 * │  The test failure is telling you: "This change would break existing users"  │
 * └──────────────────────────────────────────────────────────────────────────────┘
 *
 * WHY THIS MATTERS:
 *
 * Users' YAML files reference these schemas via URL:
 *   # yaml-language-server: $schema=https://raw.githubusercontent.com/.../v1/...
 *
 * If we change v1 schemas in breaking ways:
 *   - Users see red squiggles on valid configs
 *   - CI/CD pipelines fail validation
 *   - Users think their configs are wrong (they're not)
 *   - Trust in the tool erodes
 *
 * WHAT COUNTS AS A BREAKING CHANGE:
 *   - Removing properties
 *   - Renaming properties
 *   - Changing property types
 *   - Adding new REQUIRED properties
 *   - Tightening validation (e.g., adding minLength where there wasn't one)
 *
 * WHAT IS ALLOWED (non-breaking):
 *   - Adding new OPTIONAL properties
 *   - Relaxing validation constraints
 *   - Improving descriptions
 *   - Fixing bugs that prevented valid configs from validating
 *
 * See schemas/v1/README.md for the full policy on schema versioning.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'

const SCHEMAS_DIR = join(__dirname, '../../../../schemas/v1')
const FIXTURES_DIR = join(__dirname, 'fixtures')

// Load schemas
function loadSchema(name: string): object {
  const content = readFileSync(join(SCHEMAS_DIR, name), 'utf-8')
  return JSON.parse(content)
}

// Load YAML fixture
function loadYamlFixture(name: string): unknown {
  const content = readFileSync(join(FIXTURES_DIR, name), 'utf-8')
  return parseYaml(content)
}

describe('Schema Contract Tests', () => {
  /**
   * These tests use Ajv to validate sample YAML configs against the JSON schemas.
   * If any of these tests fail after you modified a schema, READ THE FILE HEADER COMMENT.
   */
  let ajv: Ajv

  beforeAll(() => {
    ajv = new Ajv({ strict: false, allErrors: true })
    addFormats(ajv)
  })

  describe('project-config.schema.json - CONTRACT TESTS', () => {
    /**
     * Tests for the project configuration schema (.attest-it/config.yaml).
     * These fixtures represent real configs that users have deployed.
     * DO NOT modify these tests to accommodate schema changes - create v2 instead.
     */
    let validate: ReturnType<typeof ajv.compile>

    beforeAll(() => {
      const schema = loadSchema('project-config.schema.json')
      validate = ajv.compile(schema)
    })

    it('should validate a comprehensive project configuration', () => {
      const config = loadYamlFixture('valid-project-config.yaml')
      const valid = validate(config)

      if (!valid) {
        console.error('Validation errors:', JSON.stringify(validate.errors, null, 2))
      }

      expect(valid).toBe(true)
    })

    it('should validate a minimal project configuration (version only)', () => {
      const config = loadYamlFixture('minimal-project-config.yaml')
      const valid = validate(config)

      if (!valid) {
        console.error('Validation errors:', JSON.stringify(validate.errors, null, 2))
      }

      expect(valid).toBe(true)
    })

    it('should accept team members with all optional fields', () => {
      const config = {
        version: 1,
        team: {
          alice: {
            name: 'Alice',
            email: 'alice@example.com',
            github: 'alice',
            publicKey: 'abc123',
            publicKeyAlgorithm: 'ed25519',
          },
        },
      }
      expect(validate(config)).toBe(true)
    })

    it('should accept team members with only required fields', () => {
      const config = {
        version: 1,
        team: {
          alice: {
            name: 'Alice',
            publicKey: 'abc123',
          },
        },
      }
      expect(validate(config)).toBe(true)
    })

    it('should accept gates with all required fields', () => {
      const config = {
        version: 1,
        gates: {
          'my-gate': {
            name: 'My Gate',
            description: 'A test gate',
            authorizedSigners: ['alice'],
            fingerprint: {
              paths: ['src/**'],
              exclude: ['**/*.test.ts'],
            },
            maxAge: '30d',
          },
        },
      }
      expect(validate(config)).toBe(true)
    })

    it('should accept suites with various configurations', () => {
      const config = {
        version: 1,
        suites: {
          basic: {
            command: 'npm test',
          },
          full: {
            gate: 'my-gate',
            description: 'Full test',
            command: 'npm test',
            packages: ['pkg-a'],
            files: ['src/**'],
            ignore: ['**/*.spec.ts'],
            timeout: '5m',
            interactive: true,
            invalidates: ['other-suite'],
            depends_on: ['basic'],
          },
        },
      }
      expect(validate(config)).toBe(true)
    })

    it('should accept groups', () => {
      const config = {
        version: 1,
        groups: {
          all: ['suite-a', 'suite-b'],
          critical: ['suite-c'],
        },
      }
      expect(validate(config)).toBe(true)
    })

    it('should reject invalid version', () => {
      const config = { version: 2 }
      expect(validate(config)).toBe(false)
    })

    it('should reject missing version', () => {
      const config = { team: {} }
      expect(validate(config)).toBe(false)
    })

    it('should reject unknown top-level properties', () => {
      const config = { version: 1, unknownField: 'value' }
      expect(validate(config)).toBe(false)
    })
  })

  describe('identity.schema.json - CONTRACT TESTS', () => {
    /**
     * Tests for the identity configuration schema (~/.config/attest-it/config.yaml).
     * These fixtures represent real configs that users have on their machines.
     * DO NOT modify these tests to accommodate schema changes - create v2 instead.
     */
    let validate: ReturnType<typeof ajv.compile>

    beforeAll(() => {
      const schema = loadSchema('identity.schema.json')
      validate = ajv.compile(schema)
    })

    it('should validate a comprehensive identity configuration', () => {
      const config = loadYamlFixture('valid-identity-config.yaml')
      const valid = validate(config)

      if (!valid) {
        console.error('Validation errors:', JSON.stringify(validate.errors, null, 2))
      }

      expect(valid).toBe(true)
    })

    it('should validate a minimal identity configuration', () => {
      const config = loadYamlFixture('minimal-identity-config.yaml')
      const valid = validate(config)

      if (!valid) {
        console.error('Validation errors:', JSON.stringify(validate.errors, null, 2))
      }

      expect(valid).toBe(true)
    })

    it('should accept file-based private keys', () => {
      const config = {
        activeIdentity: 'test',
        identities: {
          test: {
            name: 'Test User',
            publicKey: 'abc123',
            privateKey: {
              type: 'file',
              path: '/path/to/key.pem',
            },
          },
        },
      }
      expect(validate(config)).toBe(true)
    })

    it('should accept keychain-based private keys', () => {
      const config = {
        activeIdentity: 'test',
        identities: {
          test: {
            name: 'Test User',
            publicKey: 'abc123',
            privateKey: {
              type: 'keychain',
              service: 'attest-it',
              account: 'test-user',
            },
          },
        },
      }
      expect(validate(config)).toBe(true)
    })

    it('should accept keychain with optional keychain path', () => {
      const config = {
        activeIdentity: 'test',
        identities: {
          test: {
            name: 'Test User',
            publicKey: 'abc123',
            privateKey: {
              type: 'keychain',
              service: 'attest-it',
              account: 'test-user',
              keychain: '/path/to/keychain',
            },
          },
        },
      }
      expect(validate(config)).toBe(true)
    })

    it('should accept 1Password-based private keys', () => {
      const config = {
        activeIdentity: 'test',
        identities: {
          test: {
            name: 'Test User',
            publicKey: 'abc123',
            privateKey: {
              type: '1password',
              vault: 'Development',
              item: 'attest-it-key',
            },
          },
        },
      }
      expect(validate(config)).toBe(true)
    })

    it('should accept 1Password with all optional fields', () => {
      const config = {
        activeIdentity: 'test',
        identities: {
          test: {
            name: 'Test User',
            publicKey: 'abc123',
            privateKey: {
              type: '1password',
              account: 'my.1password.com',
              vault: 'Development',
              item: 'attest-it-key',
              field: 'privateKey',
            },
          },
        },
      }
      expect(validate(config)).toBe(true)
    })

    it('should accept identity with optional email and github', () => {
      const config = {
        activeIdentity: 'test',
        identities: {
          test: {
            name: 'Test User',
            email: 'test@example.com',
            github: 'testuser',
            publicKey: 'abc123',
            privateKey: {
              type: 'file',
              path: '/path/to/key.pem',
            },
          },
        },
      }
      expect(validate(config)).toBe(true)
    })

    it('should reject missing activeIdentity', () => {
      const config = {
        identities: {
          test: {
            name: 'Test User',
            publicKey: 'abc123',
            privateKey: { type: 'file', path: '/path' },
          },
        },
      }
      expect(validate(config)).toBe(false)
    })

    it('should reject missing identities', () => {
      const config = {
        activeIdentity: 'test',
      }
      expect(validate(config)).toBe(false)
    })

    it('should reject identity missing required privateKey', () => {
      const config = {
        activeIdentity: 'test',
        identities: {
          test: {
            name: 'Test User',
            publicKey: 'abc123',
            // missing privateKey
          },
        },
      }
      expect(validate(config)).toBe(false)
    })

    it('should reject unknown private key type', () => {
      const config = {
        activeIdentity: 'test',
        identities: {
          test: {
            name: 'Test User',
            publicKey: 'abc123',
            privateKey: {
              type: 'unknown-type',
              path: '/path',
            },
          },
        },
      }
      expect(validate(config)).toBe(false)
    })
  })

  describe('Schema files exist and are valid JSON', () => {
    const schemaFiles = [
      'project-config.schema.json',
      'identity.schema.json',
      'config.schema.json',
      'policy.schema.json',
    ]

    it.each(schemaFiles)('%s should be valid JSON Schema', (filename) => {
      const schema = loadSchema(filename)
      expect(schema).toHaveProperty('$schema')
      expect(schema).toHaveProperty('$id')
      expect((schema as { $id: string }).$id).toContain('/v1/')
    })
  })
})
