/**
 * Tests for configuration loading and validation.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  type Config,
  ConfigNotFoundError,
  ConfigValidationError,
  findConfigPath,
  loadConfig,
  loadConfigSync,
  resolveConfigPaths,
} from '../src/config.js'

const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'configs')

describe('config', () => {
  describe('loadConfig', () => {
    describe('positive tests', () => {
      it('should load a valid YAML config file', async () => {
        const configPath = path.join(FIXTURES_DIR, 'valid.yaml')
        const config = await loadConfig(configPath)

        expect(config.version).toBe(1)
        expect(config.settings.maxAgeDays).toBe(30)
        expect(config.settings.publicKeyPath).toBe('.attest-it/pubkey.pem')
        expect(config.settings.attestationsPath).toBe('.attest-it/attestations.json')
        expect(config.settings.defaultCommand).toBe('pnpm test')

        const unitSuite = config.suites.unit
        expect(unitSuite).toBeDefined()
        expect(unitSuite?.description).toBe('Unit tests for core functionality')
        expect(unitSuite?.packages).toEqual(['@attest-it/core'])
        expect(unitSuite?.files).toEqual(['src/**/*.test.ts'])
        expect(unitSuite?.ignore).toEqual(['**/node_modules/**', '**/*.spec.ts'])
        expect(unitSuite?.command).toBe('pnpm test:unit')

        const integrationSuite = config.suites.integration
        expect(integrationSuite).toBeDefined()
        expect(integrationSuite?.invalidates).toEqual(['unit'])
      })

      it('should load a valid JSON config file', async () => {
        const configPath = path.join(FIXTURES_DIR, 'valid.json')
        const config = await loadConfig(configPath)

        expect(config.version).toBe(1)
        expect(config.settings.maxAgeDays).toBe(30)
        expect(config.settings.publicKeyPath).toBe('.attest-it/pubkey.pem')
        expect(config.settings.attestationsPath).toBe('.attest-it/attestations.json')
        expect(config.settings.defaultCommand).toBe('pnpm test')

        expect(config.suites.unit).toBeDefined()
        expect(config.suites.integration).toBeDefined()
      })

      it('should load a minimal config with only required fields', async () => {
        const configPath = path.join(FIXTURES_DIR, 'minimal.yaml')
        const config = await loadConfig(configPath)

        expect(config.version).toBe(1)
        expect(config.settings.maxAgeDays).toBe(30) // default
        expect(config.settings.publicKeyPath).toBe('.attest-it/pubkey.pem') // default
        expect(config.settings.attestationsPath).toBe('.attest-it/attestations.json') // default
        expect(config.settings.defaultCommand).toBeUndefined()

        const unitSuite = config.suites.unit
        expect(unitSuite).toBeDefined()
        expect(unitSuite?.packages).toEqual(['@attest-it/core'])
      })

      it('should apply default values for missing settings', async () => {
        const configPath = path.join(FIXTURES_DIR, 'minimal.yaml')
        const config = await loadConfig(configPath)

        // Check all defaults are applied
        expect(config.settings.maxAgeDays).toBe(30)
        expect(config.settings.publicKeyPath).toBe('.attest-it/pubkey.pem')
        expect(config.settings.attestationsPath).toBe('.attest-it/attestations.json')
      })

      it('should load config with suite dependencies', async () => {
        const configPath = path.join(FIXTURES_DIR, 'with-dependencies.yaml')
        const config = await loadConfig(configPath)

        expect(config.version).toBe(1)
        expect(config.suites['visual-effects']).toBeDefined()
        expect(config.suites['focus-detection']).toBeDefined()
        expect(config.suites['full-acceptance']).toBeDefined()

        const fullAcceptance = config.suites['full-acceptance']
        expect(fullAcceptance?.depends_on).toBeDefined()
        expect(fullAcceptance?.depends_on).toEqual(['visual-effects', 'focus-detection'])
      })

      it('should load config with groups', async () => {
        const configPath = path.join(FIXTURES_DIR, 'with-groups.yaml')
        const config = await loadConfig(configPath)

        expect(config.version).toBe(1)
        expect(config.groups).toBeDefined()
        expect(config.groups?.['ui-tests']).toEqual(['visual-effects', 'custom-colors'])
        expect(config.groups?.['behavior-tests']).toEqual(['focus-detection', 'multi-session'])
      })

      it('should load config with both dependencies and groups', async () => {
        const configPath = path.join(FIXTURES_DIR, 'with-dependencies-and-groups.yaml')
        const config = await loadConfig(configPath)

        expect(config.version).toBe(1)

        // Check dependencies
        const fullAcceptance = config.suites['full-acceptance']
        expect(fullAcceptance?.depends_on).toEqual(['visual-effects', 'focus-detection'])

        // Check groups
        expect(config.groups).toBeDefined()
        expect(config.groups?.['ui-tests']).toEqual(['visual-effects', 'custom-colors'])
        expect(config.groups?.['behavior-tests']).toEqual(['focus-detection'])
      })

      it('should handle config without dependencies or groups (backwards compatible)', async () => {
        const configPath = path.join(FIXTURES_DIR, 'minimal.yaml')
        const config = await loadConfig(configPath)

        expect(config.version).toBe(1)
        expect(config.suites.unit).toBeDefined()
        expect(config.suites.unit?.depends_on).toBeUndefined()
        expect(config.groups).toBeUndefined()
      })
    })

    describe('negative tests', () => {
      it('should reject config with no suites', async () => {
        const configPath = path.join(FIXTURES_DIR, 'invalid-no-suites.yaml')

        await expect(loadConfig(configPath)).rejects.toThrow(ConfigValidationError)
        await expect(loadConfig(configPath)).rejects.toThrow('At least one suite must be defined')
      })

      it('should reject suite with empty packages array', async () => {
        const configPath = path.join(FIXTURES_DIR, 'invalid-empty-packages.yaml')

        await expect(loadConfig(configPath)).rejects.toThrow(ConfigValidationError)
        await expect(loadConfig(configPath)).rejects.toThrow(
          'At least one package pattern is required',
        )
      })

      it('should reject config with missing version', async () => {
        const tempDir = fs.mkdtempSync(path.join(__dirname, 'test-config-'))
        const configPath = path.join(tempDir, 'config.yaml')

        try {
          fs.writeFileSync(
            configPath,
            `
suites:
  unit:
    packages:
      - '@attest-it/core'
`,
          )

          await expect(loadConfig(configPath)).rejects.toThrow(ConfigValidationError)
          await expect(loadConfig(configPath)).rejects.toThrow('version')
        } finally {
          fs.rmSync(tempDir, { recursive: true, force: true })
        }
      })

      it('should reject config with invalid version', async () => {
        const tempDir = fs.mkdtempSync(path.join(__dirname, 'test-config-'))
        const configPath = path.join(tempDir, 'config.yaml')

        try {
          fs.writeFileSync(
            configPath,
            `
version: 2
suites:
  unit:
    packages:
      - '@attest-it/core'
`,
          )

          await expect(loadConfig(configPath)).rejects.toThrow(ConfigValidationError)
        } finally {
          fs.rmSync(tempDir, { recursive: true, force: true })
        }
      })

      // Note: algorithm field was removed - RSA is the only supported algorithm
      // Unknown fields in settings are now ignored for backwards compatibility

      it('should reject config with negative maxAgeDays', async () => {
        const tempDir = fs.mkdtempSync(path.join(__dirname, 'test-config-'))
        const configPath = path.join(tempDir, 'config.yaml')

        try {
          fs.writeFileSync(
            configPath,
            `
version: 1
settings:
  maxAgeDays: -1
suites:
  unit:
    packages:
      - '@attest-it/core'
`,
          )

          await expect(loadConfig(configPath)).rejects.toThrow(ConfigValidationError)
        } finally {
          fs.rmSync(tempDir, { recursive: true, force: true })
        }
      })

      it('should reject config with zero maxAgeDays', async () => {
        const tempDir = fs.mkdtempSync(path.join(__dirname, 'test-config-'))
        const configPath = path.join(tempDir, 'config.yaml')

        try {
          fs.writeFileSync(
            configPath,
            `
version: 1
settings:
  maxAgeDays: 0
suites:
  unit:
    packages:
      - '@attest-it/core'
`,
          )

          await expect(loadConfig(configPath)).rejects.toThrow(ConfigValidationError)
        } finally {
          fs.rmSync(tempDir, { recursive: true, force: true })
        }
      })

      it('should reject config with extra properties', async () => {
        const tempDir = fs.mkdtempSync(path.join(__dirname, 'test-config-'))
        const configPath = path.join(tempDir, 'config.yaml')

        try {
          fs.writeFileSync(
            configPath,
            `
version: 1
extraProperty: invalid
suites:
  unit:
    packages:
      - '@attest-it/core'
`,
          )

          await expect(loadConfig(configPath)).rejects.toThrow(ConfigValidationError)
        } finally {
          fs.rmSync(tempDir, { recursive: true, force: true })
        }
      })

      it('should reject suite with extra properties', async () => {
        const tempDir = fs.mkdtempSync(path.join(__dirname, 'test-config-'))
        const configPath = path.join(tempDir, 'config.yaml')

        try {
          fs.writeFileSync(
            configPath,
            `
version: 1
suites:
  unit:
    packages:
      - '@attest-it/core'
    extraField: invalid
`,
          )

          await expect(loadConfig(configPath)).rejects.toThrow(ConfigValidationError)
        } finally {
          fs.rmSync(tempDir, { recursive: true, force: true })
        }
      })

      it('should reject invalid YAML syntax', async () => {
        const tempDir = fs.mkdtempSync(path.join(__dirname, 'test-config-'))
        const configPath = path.join(tempDir, 'config.yaml')

        try {
          fs.writeFileSync(
            configPath,
            `
version: 1
suites:
  unit:
    packages: [unclosed array
`,
          )

          await expect(loadConfig(configPath)).rejects.toThrow(ConfigValidationError)
        } finally {
          fs.rmSync(tempDir, { recursive: true, force: true })
        }
      })

      it('should reject invalid JSON syntax', async () => {
        const tempDir = fs.mkdtempSync(path.join(__dirname, 'test-config-'))
        const configPath = path.join(tempDir, 'config.json')

        try {
          fs.writeFileSync(
            configPath,
            `
{
  "version": 1,
  "suites": {
    "unit": {
      "packages": ["@attest-it/core"
    }
  }
}
`,
          )

          await expect(loadConfig(configPath)).rejects.toThrow(ConfigValidationError)
        } finally {
          fs.rmSync(tempDir, { recursive: true, force: true })
        }
      })

      it('should throw ConfigNotFoundError when file does not exist', async () => {
        const configPath = path.join(FIXTURES_DIR, 'nonexistent.yaml')

        await expect(loadConfig(configPath)).rejects.toThrow(ConfigNotFoundError)
      })

      it('should throw ConfigNotFoundError when no config file is found in default locations', async () => {
        const tempDir = fs.mkdtempSync(path.join(__dirname, 'test-config-'))

        try {
          // Create .attest-it dir but no config file
          fs.mkdirSync(path.join(tempDir, '.attest-it'))

          // Change to temp dir (note: this won't actually change the process cwd in tests)
          // So we need to explicitly pass a path
          await expect(loadConfig()).rejects.toThrow(ConfigNotFoundError)
        } finally {
          fs.rmSync(tempDir, { recursive: true, force: true })
        }
      })

      it('should reject suite with empty dependency name', async () => {
        const configPath = path.join(FIXTURES_DIR, 'invalid-empty-dependency.yaml')

        await expect(loadConfig(configPath)).rejects.toThrow(ConfigValidationError)
        await expect(loadConfig(configPath)).rejects.toThrow(
          'Dependency suite name cannot be empty',
        )
      })

      it('should reject group with empty suite name', async () => {
        const configPath = path.join(FIXTURES_DIR, 'invalid-empty-group-suite.yaml')

        await expect(loadConfig(configPath)).rejects.toThrow(ConfigValidationError)
        await expect(loadConfig(configPath)).rejects.toThrow('Suite name in group cannot be empty')
      })

      it('should reject config with extra properties in suite when depends_on is present', async () => {
        const tempDir = fs.mkdtempSync(path.join(__dirname, 'test-config-'))
        const configPath = path.join(tempDir, 'config.yaml')

        try {
          fs.writeFileSync(
            configPath,
            `
version: 1
suites:
  unit:
    packages:
      - '@attest-it/core'
    depends_on:
      - integration
    extraField: invalid
`,
          )

          await expect(loadConfig(configPath)).rejects.toThrow(ConfigValidationError)
        } finally {
          fs.rmSync(tempDir, { recursive: true, force: true })
        }
      })

      it('should reject config with extra top-level properties when groups is present', async () => {
        const tempDir = fs.mkdtempSync(path.join(__dirname, 'test-config-'))
        const configPath = path.join(tempDir, 'config.yaml')

        try {
          fs.writeFileSync(
            configPath,
            `
version: 1
suites:
  unit:
    packages:
      - '@attest-it/core'
groups:
  test-group:
    - unit
extraTopLevel: invalid
`,
          )

          await expect(loadConfig(configPath)).rejects.toThrow(ConfigValidationError)
        } finally {
          fs.rmSync(tempDir, { recursive: true, force: true })
        }
      })
    })

    describe('edge cases', () => {
      it('should reject empty strings in packages array', async () => {
        const tempDir = fs.mkdtempSync(path.join(__dirname, 'test-config-'))
        const configPath = path.join(tempDir, 'config.yaml')

        try {
          fs.writeFileSync(
            configPath,
            `
version: 1
suites:
  unit:
    packages:
      - '@attest-it/core'
      - ''
`,
          )

          await expect(loadConfig(configPath)).rejects.toThrow(ConfigValidationError)
          await expect(loadConfig(configPath)).rejects.toThrow('Package path cannot be empty')
        } finally {
          fs.rmSync(tempDir, { recursive: true, force: true })
        }
      })

      it('should reject empty strings in files array', async () => {
        const tempDir = fs.mkdtempSync(path.join(__dirname, 'test-config-'))
        const configPath = path.join(tempDir, 'config.yaml')

        try {
          fs.writeFileSync(
            configPath,
            `
version: 1
suites:
  unit:
    packages:
      - '@attest-it/core'
    files:
      - 'src/**/*.test.ts'
      - ''
`,
          )

          await expect(loadConfig(configPath)).rejects.toThrow(ConfigValidationError)
          await expect(loadConfig(configPath)).rejects.toThrow('File path cannot be empty')
        } finally {
          fs.rmSync(tempDir, { recursive: true, force: true })
        }
      })

      it('should reject empty strings in ignore array', async () => {
        const tempDir = fs.mkdtempSync(path.join(__dirname, 'test-config-'))
        const configPath = path.join(tempDir, 'config.yaml')

        try {
          fs.writeFileSync(
            configPath,
            `
version: 1
suites:
  unit:
    packages:
      - '@attest-it/core'
    ignore:
      - '**/node_modules/**'
      - ''
`,
          )

          await expect(loadConfig(configPath)).rejects.toThrow(ConfigValidationError)
          await expect(loadConfig(configPath)).rejects.toThrow('Ignore pattern cannot be empty')
        } finally {
          fs.rmSync(tempDir, { recursive: true, force: true })
        }
      })

      it('should reject empty strings in invalidates array', async () => {
        const tempDir = fs.mkdtempSync(path.join(__dirname, 'test-config-'))
        const configPath = path.join(tempDir, 'config.yaml')

        try {
          fs.writeFileSync(
            configPath,
            `
version: 1
suites:
  unit:
    packages:
      - '@attest-it/core'
  integration:
    packages:
      - '@attest-it/cli'
    invalidates:
      - 'unit'
      - ''
`,
          )

          await expect(loadConfig(configPath)).rejects.toThrow(ConfigValidationError)
          await expect(loadConfig(configPath)).rejects.toThrow(
            'Invalidated suite name cannot be empty',
          )
        } finally {
          fs.rmSync(tempDir, { recursive: true, force: true })
        }
      })

      it('should handle suite names with special characters', async () => {
        const tempDir = fs.mkdtempSync(path.join(__dirname, 'test-config-'))
        const configPath = path.join(tempDir, 'config.yaml')

        try {
          fs.writeFileSync(
            configPath,
            `
version: 1
suites:
  'unit-test:special@chars':
    packages:
      - '@attest-it/core'
`,
          )

          const config = await loadConfig(configPath)
          expect(config.suites['unit-test:special@chars']).toBeDefined()
        } finally {
          fs.rmSync(tempDir, { recursive: true, force: true })
        }
      })

      it('should handle very large maxAgeDays', async () => {
        const tempDir = fs.mkdtempSync(path.join(__dirname, 'test-config-'))
        const configPath = path.join(tempDir, 'config.yaml')

        try {
          fs.writeFileSync(
            configPath,
            `
version: 1
settings:
  maxAgeDays: 9999999
suites:
  unit:
    packages:
      - '@attest-it/core'
`,
          )

          const config = await loadConfig(configPath)
          expect(config.settings.maxAgeDays).toBe(9999999)
        } finally {
          fs.rmSync(tempDir, { recursive: true, force: true })
        }
      })

      it('should handle empty depends_on array', async () => {
        const tempDir = fs.mkdtempSync(path.join(__dirname, 'test-config-'))
        const configPath = path.join(tempDir, 'config.yaml')

        try {
          fs.writeFileSync(
            configPath,
            `
version: 1
suites:
  unit:
    packages:
      - '@attest-it/core'
    depends_on: []
`,
          )

          const config = await loadConfig(configPath)
          expect(config.suites.unit?.depends_on).toEqual([])
        } finally {
          fs.rmSync(tempDir, { recursive: true, force: true })
        }
      })

      it('should handle empty groups object', async () => {
        const tempDir = fs.mkdtempSync(path.join(__dirname, 'test-config-'))
        const configPath = path.join(tempDir, 'config.yaml')

        try {
          fs.writeFileSync(
            configPath,
            `
version: 1
suites:
  unit:
    packages:
      - '@attest-it/core'
groups: {}
`,
          )

          const config = await loadConfig(configPath)
          expect(config.groups).toEqual({})
        } finally {
          fs.rmSync(tempDir, { recursive: true, force: true })
        }
      })

      it('should handle empty group array', async () => {
        const tempDir = fs.mkdtempSync(path.join(__dirname, 'test-config-'))
        const configPath = path.join(tempDir, 'config.yaml')

        try {
          fs.writeFileSync(
            configPath,
            `
version: 1
suites:
  unit:
    packages:
      - '@attest-it/core'
groups:
  empty-group: []
`,
          )

          const config = await loadConfig(configPath)
          expect(config.groups?.['empty-group']).toEqual([])
        } finally {
          fs.rmSync(tempDir, { recursive: true, force: true })
        }
      })

      it('should handle suite with single dependency', async () => {
        const tempDir = fs.mkdtempSync(path.join(__dirname, 'test-config-'))
        const configPath = path.join(tempDir, 'config.yaml')

        try {
          fs.writeFileSync(
            configPath,
            `
version: 1
suites:
  unit:
    packages:
      - '@attest-it/core'
  integration:
    packages:
      - '@attest-it/cli'
    depends_on:
      - unit
`,
          )

          const config = await loadConfig(configPath)
          expect(config.suites.integration?.depends_on).toEqual(['unit'])
        } finally {
          fs.rmSync(tempDir, { recursive: true, force: true })
        }
      })

      it('should handle group with single suite', async () => {
        const tempDir = fs.mkdtempSync(path.join(__dirname, 'test-config-'))
        const configPath = path.join(tempDir, 'config.yaml')

        try {
          fs.writeFileSync(
            configPath,
            `
version: 1
suites:
  unit:
    packages:
      - '@attest-it/core'
groups:
  single-group:
    - unit
`,
          )

          const config = await loadConfig(configPath)
          expect(config.groups?.['single-group']).toEqual(['unit'])
        } finally {
          fs.rmSync(tempDir, { recursive: true, force: true })
        }
      })

      it('should handle multiple suites depending on same suite', async () => {
        const tempDir = fs.mkdtempSync(path.join(__dirname, 'test-config-'))
        const configPath = path.join(tempDir, 'config.yaml')

        try {
          fs.writeFileSync(
            configPath,
            `
version: 1
suites:
  base:
    packages:
      - '@attest-it/core'
  suite-a:
    packages:
      - '@attest-it/a'
    depends_on:
      - base
  suite-b:
    packages:
      - '@attest-it/b'
    depends_on:
      - base
`,
          )

          const config = await loadConfig(configPath)
          expect(config.suites['suite-a']?.depends_on).toEqual(['base'])
          expect(config.suites['suite-b']?.depends_on).toEqual(['base'])
        } finally {
          fs.rmSync(tempDir, { recursive: true, force: true })
        }
      })

      it('should handle suite appearing in multiple groups', async () => {
        const tempDir = fs.mkdtempSync(path.join(__dirname, 'test-config-'))
        const configPath = path.join(tempDir, 'config.yaml')

        try {
          fs.writeFileSync(
            configPath,
            `
version: 1
suites:
  unit:
    packages:
      - '@attest-it/core'
groups:
  group-a:
    - unit
  group-b:
    - unit
`,
          )

          const config = await loadConfig(configPath)
          expect(config.groups?.['group-a']).toEqual(['unit'])
          expect(config.groups?.['group-b']).toEqual(['unit'])
        } finally {
          fs.rmSync(tempDir, { recursive: true, force: true })
        }
      })
    })
  })

  describe('loadConfigSync', () => {
    describe('positive tests', () => {
      it('should load a valid YAML config file synchronously', () => {
        const configPath = path.join(FIXTURES_DIR, 'valid.yaml')
        const config = loadConfigSync(configPath)

        expect(config.version).toBe(1)
        expect(config.settings.maxAgeDays).toBe(30)
        expect(config.suites.unit).toBeDefined()
      })

      it('should load a valid JSON config file synchronously', () => {
        const configPath = path.join(FIXTURES_DIR, 'valid.json')
        const config = loadConfigSync(configPath)

        expect(config.version).toBe(1)
        expect(config.settings.maxAgeDays).toBe(30)
        expect(config.suites.unit).toBeDefined()
      })
    })

    describe('negative tests', () => {
      it('should throw ConfigValidationError for invalid config', () => {
        const configPath = path.join(FIXTURES_DIR, 'invalid-no-suites.yaml')

        expect(() => loadConfigSync(configPath)).toThrow(ConfigValidationError)
      })

      it('should throw ConfigNotFoundError when file does not exist', () => {
        const configPath = path.join(FIXTURES_DIR, 'nonexistent.yaml')

        expect(() => loadConfigSync(configPath)).toThrow(ConfigNotFoundError)
      })
    })
  })

  describe('findConfigPath', () => {
    let tempDir: string

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(__dirname, 'test-find-'))
      fs.mkdirSync(path.join(tempDir, '.attest-it'))
    })

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true })
    })

    describe('positive tests', () => {
      it('should find config.yaml', () => {
        const configPath = path.join(tempDir, '.attest-it', 'config.yaml')
        fs.writeFileSync(configPath, 'version: 1\nsuites:\n  unit:\n    packages:\n      - test')

        const found = findConfigPath(tempDir)
        expect(found).toBe(configPath)
      })

      it('should find config.yml', () => {
        const configPath = path.join(tempDir, '.attest-it', 'config.yml')
        fs.writeFileSync(configPath, 'version: 1\nsuites:\n  unit:\n    packages:\n      - test')

        const found = findConfigPath(tempDir)
        expect(found).toBe(configPath)
      })

      it('should find config.json', () => {
        const configPath = path.join(tempDir, '.attest-it', 'config.json')
        fs.writeFileSync(configPath, '{"version":1,"suites":{"unit":{"packages":["test"]}}}')

        const found = findConfigPath(tempDir)
        expect(found).toBe(configPath)
      })

      it('should prefer config.yaml over config.yml', () => {
        const yamlPath = path.join(tempDir, '.attest-it', 'config.yaml')
        const ymlPath = path.join(tempDir, '.attest-it', 'config.yml')

        fs.writeFileSync(yamlPath, 'version: 1\nsuites:\n  unit:\n    packages:\n      - test')
        fs.writeFileSync(ymlPath, 'version: 1\nsuites:\n  unit:\n    packages:\n      - test')

        const found = findConfigPath(tempDir)
        expect(found).toBe(yamlPath)
      })

      it('should prefer config.yml over config.json', () => {
        const ymlPath = path.join(tempDir, '.attest-it', 'config.yml')
        const jsonPath = path.join(tempDir, '.attest-it', 'config.json')

        fs.writeFileSync(ymlPath, 'version: 1\nsuites:\n  unit:\n    packages:\n      - test')
        fs.writeFileSync(jsonPath, '{"version":1,"suites":{"unit":{"packages":["test"]}}}')

        const found = findConfigPath(tempDir)
        expect(found).toBe(ymlPath)
      })
    })

    describe('negative tests', () => {
      it('should return null when no config file exists', () => {
        const found = findConfigPath(tempDir)
        expect(found).toBeNull()
      })

      it('should return null when .attest-it directory does not exist', () => {
        const emptyDir = fs.mkdtempSync(path.join(__dirname, 'test-empty-'))

        try {
          const found = findConfigPath(emptyDir)
          expect(found).toBeNull()
        } finally {
          fs.rmSync(emptyDir, { recursive: true, force: true })
        }
      })
    })
  })

  describe('resolveConfigPaths', () => {
    describe('positive tests', () => {
      it('should resolve relative paths to absolute paths', () => {
        const config: Config = {
          version: 1,
          settings: {
            maxAgeDays: 30,
            publicKeyPath: '.attest-it/pubkey.pem',
            attestationsPath: '.attest-it/attestations.json',
          },
          suites: {
            unit: {
              packages: ['@attest-it/core'],
            },
          },
        }

        const repoRoot = '/repo/root'
        const resolved = resolveConfigPaths(config, repoRoot)

        expect(resolved.settings.publicKeyPath).toBe('/repo/root/.attest-it/pubkey.pem')
        expect(resolved.settings.attestationsPath).toBe('/repo/root/.attest-it/attestations.json')
      })

      it('should leave absolute paths unchanged', () => {
        const config: Config = {
          version: 1,
          settings: {
            maxAgeDays: 30,
            publicKeyPath: '/absolute/path/to/pubkey.pem',
            attestationsPath: '/absolute/path/to/attestations.json',
          },
          suites: {
            unit: {
              packages: ['@attest-it/core'],
            },
          },
        }

        const repoRoot = '/repo/root'
        const resolved = resolveConfigPaths(config, repoRoot)

        expect(resolved.settings.publicKeyPath).toBe('/absolute/path/to/pubkey.pem')
        expect(resolved.settings.attestationsPath).toBe('/absolute/path/to/attestations.json')
      })

      it('should not modify other config properties', () => {
        const config: Config = {
          version: 1,
          settings: {
            maxAgeDays: 30,
            publicKeyPath: '.attest-it/pubkey.pem',
            attestationsPath: '.attest-it/attestations.json',
            defaultCommand: 'pnpm test',
            algorithm: 'rsa',
          },
          suites: {
            unit: {
              packages: ['@attest-it/core'],
            },
          },
        }

        const repoRoot = '/repo/root'
        const resolved = resolveConfigPaths(config, repoRoot)

        expect(resolved.version).toBe(1)
        expect(resolved.settings.maxAgeDays).toBe(30)
        expect(resolved.settings.defaultCommand).toBe('pnpm test')
        expect(resolved.settings.algorithm).toBe('rsa')
        expect(resolved.suites.unit?.packages).toEqual(['@attest-it/core'])
      })
    })

    describe('edge cases', () => {
      it('should handle paths with ../ correctly', () => {
        const config: Config = {
          version: 1,
          settings: {
            maxAgeDays: 30,
            publicKeyPath: '../keys/pubkey.pem',
            attestationsPath: '.attest-it/attestations.json',
          },
          suites: {
            unit: {
              packages: ['@attest-it/core'],
            },
          },
        }

        const repoRoot = '/repo/root'
        const resolved = resolveConfigPaths(config, repoRoot)

        expect(resolved.settings.publicKeyPath).toBe('/repo/keys/pubkey.pem')
      })

      it('should handle Windows-style paths on Windows', () => {
        const config: Config = {
          version: 1,
          settings: {
            maxAgeDays: 30,
            publicKeyPath: 'keys\\pubkey.pem',
            attestationsPath: 'attestations\\data.json',
          },
          suites: {
            unit: {
              packages: ['@attest-it/core'],
            },
          },
        }

        const repoRoot = process.platform === 'win32' ? 'C:\\repo\\root' : '/repo/root'
        const resolved = resolveConfigPaths(config, repoRoot)

        // The exact format depends on the platform
        expect(resolved.settings.publicKeyPath).toContain('pubkey.pem')
        expect(resolved.settings.attestationsPath).toContain('data.json')
      })
    })
  })

  describe('ConfigValidationError', () => {
    it('should include Zod issues in the error', async () => {
      const configPath = path.join(FIXTURES_DIR, 'invalid-no-suites.yaml')

      try {
        await loadConfig(configPath)
        // Should not reach here
        expect.fail('Expected ConfigValidationError to be thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigValidationError)
        if (error instanceof ConfigValidationError) {
          expect(error.issues).toBeDefined()
          expect(Array.isArray(error.issues)).toBe(true)
          expect(error.issues.length).toBeGreaterThan(0)
        }
      }
    })

    it('should have a descriptive error message', async () => {
      const configPath = path.join(FIXTURES_DIR, 'invalid-empty-packages.yaml')

      try {
        await loadConfig(configPath)
        expect.fail('Expected ConfigValidationError to be thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigValidationError)
        if (error instanceof ConfigValidationError) {
          expect(error.message).toContain('Configuration validation failed')
          expect(error.message).toContain('packages')
        }
      }
    })
  })
})
