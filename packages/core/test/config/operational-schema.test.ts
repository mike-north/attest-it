/**
 * Tests for operational configuration schema and validation.
 */

import { describe, expect, it } from 'vitest'
import {
  type OperationalConfig,
  OperationalValidationError,
  parseOperationalContent,
  operationalSchema,
} from '../../src/config/operational-schema.js'

import * as fs from 'node:fs'
import * as path from 'node:path'

const FIXTURES_DIR = path.join(__dirname, '../fixtures/split-config')

describe('operational-schema', () => {
  describe('parseOperationalContent with fixture files', () => {
    it('should parse valid-operational.yaml fixture', () => {
      const yaml = fs.readFileSync(path.join(FIXTURES_DIR, 'valid-operational.yaml'), 'utf-8')
      const config = parseOperationalContent(yaml, 'yaml')

      expect(config.version).toBe(1)
      expect(config.settings.defaultCommand).toBe('pnpm test')
      expect(config.settings.keyProvider).toBeDefined()
      expect(config.settings.keyProvider?.type).toBe('filesystem')
      expect(config.settings.keyProvider?.options?.privateKeyPath).toBe('.attest-it/private.pem')
      expect(config.suites).toBeDefined()
      expect(config.suites.security).toBeDefined()
      expect(config.suites.security.gate).toBe('security-tests')
      expect(config.suites.unit).toBeDefined()
      expect(config.suites.unit.gate).toBe('unit-tests')
      expect(config.suites.unit.depends_on).toEqual(['security'])
      expect(config.groups).toBeDefined()
      expect(config.groups?.all).toEqual(['security', 'unit'])
      expect(config.groups?.quick).toEqual(['unit'])
    })

    it('should parse minimal-operational.yaml fixture', () => {
      const yaml = fs.readFileSync(path.join(FIXTURES_DIR, 'minimal-operational.yaml'), 'utf-8')
      const config = parseOperationalContent(yaml, 'yaml')

      expect(config.version).toBe(1)
      expect(config.suites).toBeDefined()
      expect(config.suites.test).toBeDefined()
      expect(config.suites.test.gate).toBe('default')
      expect(config.suites.test.command).toBe('pnpm test')
    })

    it('should parse invalid-gate-reference.yaml fixture without schema errors', () => {
      const yaml = fs.readFileSync(path.join(FIXTURES_DIR, 'invalid-gate-reference.yaml'), 'utf-8')
      const config = parseOperationalContent(yaml, 'yaml')

      // Schema validation should pass - this file is syntactically valid
      // The semantic error (nonexistent-gate) is caught by validation.ts
      expect(config.version).toBe(1)
      expect(config.suites).toBeDefined()
      expect(config.suites.test).toBeDefined()
      expect(config.suites.test.gate).toBe('nonexistent-gate')
    })
  })

  describe('parseOperationalContent', () => {
    describe('positive tests', () => {
      it('should parse a minimal valid operational YAML', () => {
        const yaml = `
version: 1
suites:
  unit:
    gate: unit-gate
`
        const config = parseOperationalContent(yaml, 'yaml')

        expect(config.version).toBe(1)
        expect(config.suites.unit).toBeDefined()
        expect(config.suites.unit.gate).toBe('unit-gate')
        expect(config.settings.defaultCommand).toBeUndefined()
        expect(config.settings.keyProvider).toBeUndefined()
        expect(config.groups).toBeUndefined()
      })

      it('should parse a valid operational JSON', () => {
        const json = JSON.stringify({
          version: 1,
          suites: {
            unit: {
              gate: 'unit-gate',
            },
          },
        })

        const config = parseOperationalContent(json, 'json')

        expect(config.version).toBe(1)
        expect(config.suites.unit).toBeDefined()
        expect(config.suites.unit.gate).toBe('unit-gate')
      })

      it('should parse config with defaultCommand', () => {
        const yaml = `
version: 1
settings:
  defaultCommand: pnpm test
suites:
  unit:
    gate: unit-gate
`
        const config = parseOperationalContent(yaml, 'yaml')

        expect(config.settings.defaultCommand).toBe('pnpm test')
      })

      it('should parse config with filesystem keyProvider', () => {
        const yaml = `
version: 1
settings:
  keyProvider:
    type: filesystem
    options:
      privateKeyPath: /custom/path/private.pem
suites:
  unit:
    gate: unit-gate
`
        const config = parseOperationalContent(yaml, 'yaml')

        expect(config.settings.keyProvider).toBeDefined()
        expect(config.settings.keyProvider?.type).toBe('filesystem')
        expect(config.settings.keyProvider?.options?.privateKeyPath).toBe(
          '/custom/path/private.pem',
        )
      })

      it('should parse config with 1password keyProvider', () => {
        const yaml = `
version: 1
settings:
  keyProvider:
    type: 1password
    options:
      account: user@example.com
      vault: Development
      itemName: attest-it-key
suites:
  unit:
    gate: unit-gate
`
        const config = parseOperationalContent(yaml, 'yaml')

        expect(config.settings.keyProvider?.type).toBe('1password')
        expect(config.settings.keyProvider?.options?.account).toBe('user@example.com')
        expect(config.settings.keyProvider?.options?.vault).toBe('Development')
        expect(config.settings.keyProvider?.options?.itemName).toBe('attest-it-key')
      })

      it('should parse suite with gate reference', () => {
        const yaml = `
version: 1
suites:
  unit:
    gate: unit-tests
    command: pnpm test:unit
`
        const config = parseOperationalContent(yaml, 'yaml')

        expect(config.suites.unit.gate).toBe('unit-tests')
        expect(config.suites.unit.command).toBe('pnpm test:unit')
      })

      it('should parse suite with description and command', () => {
        const yaml = `
version: 1
suites:
  unit:
    gate: unit-tests
    description: Unit tests for core functionality
    command: pnpm test:unit
`
        const config = parseOperationalContent(yaml, 'yaml')

        expect(config.suites.unit.gate).toBe('unit-tests')
        expect(config.suites.unit.description).toBe('Unit tests for core functionality')
        expect(config.suites.unit.command).toBe('pnpm test:unit')
      })

      it('should parse suite with timeout and interactive', () => {
        const yaml = `
version: 1
suites:
  e2e:
    gate: e2e-gate
    command: pnpm test:e2e
    timeout: 30m
    interactive: true
`
        const config = parseOperationalContent(yaml, 'yaml')

        expect(config.suites.e2e.timeout).toBe('30m')
        expect(config.suites.e2e.interactive).toBe(true)
      })

      it('should parse suite with dependencies', () => {
        const yaml = `
version: 1
suites:
  unit:
    gate: unit-gate
  integration:
    gate: integration-gate
    depends_on:
      - unit
`
        const config = parseOperationalContent(yaml, 'yaml')

        expect(config.suites.integration.depends_on).toEqual(['unit'])
      })

      it('should parse suite with invalidates', () => {
        const yaml = `
version: 1
suites:
  unit:
    gate: unit-gate
  integration:
    gate: integration-gate
    invalidates:
      - unit
`
        const config = parseOperationalContent(yaml, 'yaml')

        expect(config.suites.integration.invalidates).toEqual(['unit'])
      })

      it('should parse config with groups', () => {
        const yaml = `
version: 1
suites:
  unit:
    gate: unit-gate
  integration:
    gate: integration-gate
  e2e:
    gate: e2e-gate
groups:
  fast-tests:
    - unit
  slow-tests:
    - integration
    - e2e
`
        const config = parseOperationalContent(yaml, 'yaml')

        expect(config.groups).toBeDefined()
        expect(config.groups?.['fast-tests']).toEqual(['unit'])
        expect(config.groups?.['slow-tests']).toEqual(['integration', 'e2e'])
      })

      it('should parse config with all settings', () => {
        const yaml = `
version: 1
settings:
  defaultCommand: pnpm test
  keyProvider:
    type: filesystem
    options:
      privateKeyPath: /path/to/key.pem
suites:
  lint:
    gate: lint-gate
  unit:
    gate: unit-tests
    command: pnpm test:unit
    timeout: 5m
    interactive: false
    depends_on:
      - lint
    invalidates:
      - build
  build:
    gate: build-gate
groups:
  ci:
    - unit
`
        const config = parseOperationalContent(yaml, 'yaml')

        expect(config.settings.defaultCommand).toBe('pnpm test')
        expect(config.settings.keyProvider?.type).toBe('filesystem')
        expect(config.suites.unit).toBeDefined()
        expect(config.groups?.ci).toEqual(['unit'])
      })

      it('should allow empty settings object', () => {
        const yaml = `
version: 1
settings: {}
suites:
  unit:
    gate: unit-gate
`
        const config = parseOperationalContent(yaml, 'yaml')

        expect(config.settings.defaultCommand).toBeUndefined()
        expect(config.settings.keyProvider).toBeUndefined()
      })

      it('should allow settings to be omitted', () => {
        const yaml = `
version: 1
suites:
  unit:
    gate: unit-gate
`
        const config = parseOperationalContent(yaml, 'yaml')

        expect(config.settings.defaultCommand).toBeUndefined()
        expect(config.settings.keyProvider).toBeUndefined()
      })

      it('should parse keyProvider without options', () => {
        const yaml = `
version: 1
settings:
  keyProvider:
    type: filesystem
suites:
  unit:
    gate: unit-gate
`
        const config = parseOperationalContent(yaml, 'yaml')

        expect(config.settings.keyProvider?.type).toBe('filesystem')
        expect(config.settings.keyProvider?.options).toBeUndefined()
      })
    })

    describe('negative tests', () => {
      it('should reject config with invalid version', () => {
        const yaml = `
version: 2
suites:
  unit:
    gate: unit-gate
`
        expect(() => parseOperationalContent(yaml, 'yaml')).toThrow(OperationalValidationError)
        expect(() => parseOperationalContent(yaml, 'yaml')).toThrow('version')
      })

      it('should reject config with missing version', () => {
        const yaml = `
suites:
  unit:
    gate: unit-gate
`
        expect(() => parseOperationalContent(yaml, 'yaml')).toThrow(OperationalValidationError)
        expect(() => parseOperationalContent(yaml, 'yaml')).toThrow('version')
      })

      it('should reject config with no suites', () => {
        const yaml = `
version: 1
suites: {}
`
        expect(() => parseOperationalContent(yaml, 'yaml')).toThrow(OperationalValidationError)
        expect(() => parseOperationalContent(yaml, 'yaml')).toThrow('At least one suite')
      })

      it('should reject config with missing suites', () => {
        const yaml = `
version: 1
`
        expect(() => parseOperationalContent(yaml, 'yaml')).toThrow(OperationalValidationError)
        expect(() => parseOperationalContent(yaml, 'yaml')).toThrow('suites')
      })

      it('should reject suite without gate', () => {
        const yaml = `
version: 1
suites:
  unit:
    command: pnpm test
`
        expect(() => parseOperationalContent(yaml, 'yaml')).toThrow(OperationalValidationError)
        expect(() => parseOperationalContent(yaml, 'yaml')).toThrow('gate')
      })

      it('should reject suite with empty gate string', () => {
        const yaml = `
version: 1
suites:
  unit:
    gate: ''
`
        expect(() => parseOperationalContent(yaml, 'yaml')).toThrow(OperationalValidationError)
        expect(() => parseOperationalContent(yaml, 'yaml')).toThrow(
          'Gate reference cannot be empty',
        )
      })

      it('should reject suite with empty string in invalidates', () => {
        const yaml = `
version: 1
suites:
  unit:
    gate: unit-gate
  integration:
    gate: integration-gate
    invalidates:
      - unit
      - ''
`
        expect(() => parseOperationalContent(yaml, 'yaml')).toThrow(OperationalValidationError)
        expect(() => parseOperationalContent(yaml, 'yaml')).toThrow(
          'Invalidated suite name cannot be empty',
        )
      })

      it('should reject suite with empty string in depends_on', () => {
        const yaml = `
version: 1
suites:
  unit:
    gate: unit-gate
  integration:
    gate: integration-gate
    depends_on:
      - unit
      - ''
`
        expect(() => parseOperationalContent(yaml, 'yaml')).toThrow(OperationalValidationError)
        expect(() => parseOperationalContent(yaml, 'yaml')).toThrow(
          'Dependency suite name cannot be empty',
        )
      })

      it('should reject group with empty string in suite list', () => {
        const yaml = `
version: 1
suites:
  unit:
    gate: unit-gate
groups:
  test-group:
    - unit
    - ''
`
        expect(() => parseOperationalContent(yaml, 'yaml')).toThrow(OperationalValidationError)
        expect(() => parseOperationalContent(yaml, 'yaml')).toThrow(
          'Suite name in group cannot be empty',
        )
      })

      it('should reject config with extra top-level properties', () => {
        const yaml = `
version: 1
extraProperty: invalid
suites:
  unit:
    gate: unit-gate
`
        expect(() => parseOperationalContent(yaml, 'yaml')).toThrow(OperationalValidationError)
      })

      it('should reject settings with extra properties', () => {
        const yaml = `
version: 1
settings:
  defaultCommand: pnpm test
  maxAgeDays: 30
suites:
  unit:
    gate: unit-gate
`
        expect(() => parseOperationalContent(yaml, 'yaml')).toThrow(OperationalValidationError)
      })

      it('should reject suite with extra properties', () => {
        const yaml = `
version: 1
suites:
  unit:
    gate: unit-gate
    extraField: invalid
`
        expect(() => parseOperationalContent(yaml, 'yaml')).toThrow(OperationalValidationError)
      })

      it('should reject keyProvider without type', () => {
        const yaml = `
version: 1
settings:
  keyProvider:
    options:
      privateKeyPath: /path/to/key.pem
suites:
  unit:
    gate: unit-gate
`
        expect(() => parseOperationalContent(yaml, 'yaml')).toThrow(OperationalValidationError)
        expect(() => parseOperationalContent(yaml, 'yaml')).toThrow('type')
      })

      // Note: keyProvider options allow extra properties (passthrough) to support custom providers

      it('should reject invalid YAML syntax', () => {
        const yaml = `
version: 1
suites: [unclosed array
`
        expect(() => parseOperationalContent(yaml, 'yaml')).toThrow(OperationalValidationError)
        expect(() => parseOperationalContent(yaml, 'yaml')).toThrow('Failed to parse YAML')
      })

      it('should reject invalid JSON syntax', () => {
        const json = `{"version": 1, "suites": {`

        expect(() => parseOperationalContent(json, 'json')).toThrow(OperationalValidationError)
        expect(() => parseOperationalContent(json, 'json')).toThrow('Failed to parse JSON')
      })
    })

    describe('edge cases', () => {
      it('should handle empty depends_on array', () => {
        const yaml = `
version: 1
suites:
  unit:
    gate: unit-gate
    depends_on: []
`
        const config = parseOperationalContent(yaml, 'yaml')
        expect(config.suites.unit.depends_on).toEqual([])
      })

      it('should handle empty invalidates array', () => {
        const yaml = `
version: 1
suites:
  unit:
    gate: unit-gate
    invalidates: []
`
        const config = parseOperationalContent(yaml, 'yaml')
        expect(config.suites.unit.invalidates).toEqual([])
      })

      it('should handle empty groups object', () => {
        const yaml = `
version: 1
suites:
  unit:
    gate: unit-gate
groups: {}
`
        const config = parseOperationalContent(yaml, 'yaml')
        expect(config.groups).toEqual({})
      })

      it('should handle empty group array', () => {
        const yaml = `
version: 1
suites:
  unit:
    gate: unit-gate
groups:
  empty-group: []
`
        const config = parseOperationalContent(yaml, 'yaml')
        expect(config.groups?.['empty-group']).toEqual([])
      })

      it('should handle keyProvider with empty options object', () => {
        const yaml = `
version: 1
settings:
  keyProvider:
    type: filesystem
    options: {}
suites:
  unit:
    gate: unit-gate
`
        const config = parseOperationalContent(yaml, 'yaml')
        expect(config.settings.keyProvider?.options).toEqual({})
      })

      it('should handle suite names with special characters', () => {
        const yaml = `
version: 1
suites:
  'unit-test:special@chars':
    gate: unit-gate
`
        const config = parseOperationalContent(yaml, 'yaml')
        expect(config.suites['unit-test:special@chars']).toBeDefined()
      })

      it('should handle multiple suites depending on same suite', () => {
        const yaml = `
version: 1
suites:
  base:
    gate: base-gate
  suite-a:
    gate: suite-a-gate
    depends_on:
      - base
  suite-b:
    gate: suite-b-gate
    depends_on:
      - base
`
        const config = parseOperationalContent(yaml, 'yaml')
        expect(config.suites['suite-a'].depends_on).toEqual(['base'])
        expect(config.suites['suite-b'].depends_on).toEqual(['base'])
      })

      it('should handle suite appearing in multiple groups', () => {
        const yaml = `
version: 1
suites:
  unit:
    gate: unit-gate
groups:
  group-a:
    - unit
  group-b:
    - unit
`
        const config = parseOperationalContent(yaml, 'yaml')
        expect(config.groups?.['group-a']).toEqual(['unit'])
        expect(config.groups?.['group-b']).toEqual(['unit'])
      })

      it('should handle custom keyProvider type', () => {
        const yaml = `
version: 1
settings:
  keyProvider:
    type: custom-provider
    options:
      customOption: value
suites:
  unit:
    gate: unit-gate
`
        const config = parseOperationalContent(yaml, 'yaml')
        expect(config.settings.keyProvider?.type).toBe('custom-provider')
      })

      it('should handle interactive false explicitly', () => {
        const yaml = `
version: 1
suites:
  unit:
    gate: unit-gate
    interactive: false
`
        const config = parseOperationalContent(yaml, 'yaml')
        expect(config.suites.unit.interactive).toBe(false)
      })
    })
  })

  describe('OperationalValidationError', () => {
    it('should include Zod issues in the error', () => {
      const yaml = `
version: 1
suites: {}
`
      try {
        parseOperationalContent(yaml, 'yaml')
        expect.fail('Expected OperationalValidationError to be thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(OperationalValidationError)
        if (error instanceof OperationalValidationError) {
          expect(error.issues).toBeDefined()
          expect(Array.isArray(error.issues)).toBe(true)
          expect(error.issues.length).toBeGreaterThan(0)
        }
      }
    })

    it('should have descriptive error message', () => {
      const yaml = `
version: 2
suites:
  unit:
    packages:
      - '@attest-it/core'
`
      try {
        parseOperationalContent(yaml, 'yaml')
        expect.fail('Expected OperationalValidationError to be thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(OperationalValidationError)
        if (error instanceof OperationalValidationError) {
          expect(error.message).toContain('Operational configuration validation failed')
        }
      }
    })
  })

  describe('operationalSchema direct usage', () => {
    it('should validate correct operational object', () => {
      const operational: OperationalConfig = {
        version: 1,
        settings: {},
        suites: {
          unit: {
            gate: 'unit-gate',
          },
        },
      }

      const result = operationalSchema.safeParse(operational)
      expect(result.success).toBe(true)
    })

    it('should reject invalid operational object', () => {
      const operational = {
        version: 2,
        suites: {
          unit: {
            gate: 'unit-gate',
          },
        },
      }

      const result = operationalSchema.safeParse(operational)
      expect(result.success).toBe(false)
    })
  })
})
