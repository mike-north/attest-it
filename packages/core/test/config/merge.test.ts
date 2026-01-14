/**
 * Tests for configuration merging.
 */

import { describe, expect, it } from 'vitest'
import { mergeConfigs } from '../../src/config/merge.js'
import type { OperationalConfig } from '../../src/config/operational-schema.js'
import type { PolicyConfig } from '../../src/config/policy-schema.js'

import * as fs from 'node:fs'
import * as path from 'node:path'
import { parsePolicyContent } from '../../src/config/policy-schema.js'
import { parseOperationalContent } from '../../src/config/operational-schema.js'

const FIXTURES_DIR = path.join(__dirname, '../fixtures/split-config')

describe('merge', () => {
  describe('mergeConfigs with fixture files', () => {
    it('should merge valid-policy.yaml and valid-operational.yaml fixtures', () => {
      const policyYaml = fs.readFileSync(path.join(FIXTURES_DIR, 'valid-policy.yaml'), 'utf-8')
      const operationalYaml = fs.readFileSync(
        path.join(FIXTURES_DIR, 'valid-operational.yaml'),
        'utf-8',
      )

      const policy = parsePolicyContent(policyYaml, 'yaml')
      const operational = parseOperationalContent(operationalYaml, 'yaml')

      const merged = mergeConfigs(policy, operational)

      // Verify policy settings are preserved
      expect(merged.settings.maxAgeDays).toBe(30)
      expect(merged.settings.publicKeyPath).toBe('.attest-it/pubkey.pem')
      expect(merged.settings.attestationsPath).toBe('.attest-it/attestations.json')

      // Verify operational settings are added
      expect(merged.settings.defaultCommand).toBe('pnpm test')
      expect(merged.settings.keyProvider?.type).toBe('filesystem')

      // Verify team and gates from policy
      expect(merged.team?.alice).toBeDefined()
      expect(merged.team?.bob).toBeDefined()
      expect(merged.gates?.['security-tests']).toBeDefined()
      expect(merged.gates?.['unit-tests']).toBeDefined()

      // Verify suites and groups from operational
      expect(merged.suites.security).toBeDefined()
      expect(merged.suites.unit).toBeDefined()
      expect(merged.groups?.all).toEqual(['security', 'unit'])
      expect(merged.groups?.quick).toEqual(['unit'])
    })

    it('should merge minimal-policy.yaml and minimal-operational.yaml fixtures', () => {
      const policyYaml = fs.readFileSync(path.join(FIXTURES_DIR, 'minimal-policy.yaml'), 'utf-8')
      const operationalYaml = fs.readFileSync(
        path.join(FIXTURES_DIR, 'minimal-operational.yaml'),
        'utf-8',
      )

      const policy = parsePolicyContent(policyYaml, 'yaml')
      const operational = parseOperationalContent(operationalYaml, 'yaml')

      const merged = mergeConfigs(policy, operational)

      expect(merged.version).toBe(1)
      expect(merged.team?.dev).toBeDefined()
      expect(merged.gates?.default).toBeDefined()
      expect(merged.suites.test).toBeDefined()
      expect(merged.suites.test.gate).toBe('default')
    })
  })

  describe('mergeConfigs', () => {
    describe('positive tests', () => {
      it('should merge minimal policy and operational configs', () => {
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
              packages: ['packages/core'],
              command: 'npm test',
            },
          },
        }

        const merged = mergeConfigs(policy, operational)

        expect(merged.version).toBe(1)
        expect(merged.settings.maxAgeDays).toBe(30)
        expect(merged.settings.publicKeyPath).toBe('.attest-it/pubkey.pem')
        expect(merged.settings.attestationsPath).toBe('.attest-it/attestations.json')
        expect(merged.settings.defaultCommand).toBeUndefined()
        expect(merged.settings.keyProvider).toBeUndefined()
        expect(merged.team).toBeUndefined()
        expect(merged.gates).toBeUndefined()
        expect(merged.groups).toBeUndefined()
        expect(merged.suites).toEqual(operational.suites)
      })

      it('should merge policy settings with operational settings', () => {
        const policy: PolicyConfig = {
          version: 1,
          settings: {
            maxAgeDays: 45,
            publicKeyPath: 'custom/pubkey.pem',
            attestationsPath: 'custom/attestations.json',
          },
        }

        const operational: OperationalConfig = {
          version: 1,
          settings: {
            defaultCommand: 'npm run test:ci',
            keyProvider: {
              type: 'filesystem',
              options: {
                privateKeyPath: '.attest-it/private.pem',
              },
            },
          },
          suites: {
            integration: {
              packages: ['packages/*'],
            },
          },
        }

        const merged = mergeConfigs(policy, operational)

        // Policy settings should be preserved
        expect(merged.settings.maxAgeDays).toBe(45)
        expect(merged.settings.publicKeyPath).toBe('custom/pubkey.pem')
        expect(merged.settings.attestationsPath).toBe('custom/attestations.json')

        // Operational settings should be added
        expect(merged.settings.defaultCommand).toBe('npm run test:ci')
        expect(merged.settings.keyProvider).toEqual({
          type: 'filesystem',
          options: {
            privateKeyPath: '.attest-it/private.pem',
          },
        })
      })

      it('should include team and gates from policy', () => {
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
              email: 'alice@example.com',
              publicKey: 'ssh-rsa AAAAB3NzaC1yc2EAAA...',
            },
            bob: {
              name: 'Bob Jones',
              publicKey: 'ssh-rsa AAAAB3NzaC1yc2EBBB...',
            },
          },
          gates: {
            core: {
              name: 'Core Tests',
              description: 'Unit and integration tests for core package',
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

        const merged = mergeConfigs(policy, operational)

        expect(merged.team).toEqual(policy.team)
        expect(merged.gates).toEqual(policy.gates)
        expect(merged.team?.alice).toBeDefined()
        expect(merged.team?.bob).toBeDefined()
        expect(merged.gates?.core).toBeDefined()
      })

      it('should include suites and groups from operational config', () => {
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
              packages: ['packages/core'],
              command: 'npm run test:unit',
            },
            integration: {
              packages: ['packages/*'],
              command: 'npm run test:integration',
            },
            e2e: {
              packages: ['test/e2e'],
              command: 'npm run test:e2e',
            },
          },
          groups: {
            all: ['unit', 'integration', 'e2e'],
            fast: ['unit'],
          },
        }

        const merged = mergeConfigs(policy, operational)

        expect(merged.suites).toEqual(operational.suites)
        expect(merged.groups).toEqual(operational.groups)
        expect(Object.keys(merged.suites)).toEqual(['unit', 'integration', 'e2e'])
        expect(merged.groups?.all).toEqual(['unit', 'integration', 'e2e'])
        expect(merged.groups?.fast).toEqual(['unit'])
      })

      it('should merge complete policy and operational configs', () => {
        const policy: PolicyConfig = {
          version: 1,
          settings: {
            maxAgeDays: 60,
            publicKeyPath: 'keys/public.pem',
            attestationsPath: 'attestations/data.json',
          },
          team: {
            maintainer: {
              name: 'Project Maintainer',
              email: 'maintainer@example.com',
              github: 'maintainer-gh',
              publicKey: 'ssh-rsa MAINTAINER_KEY',
            },
          },
          gates: {
            security: {
              name: 'Security Tests',
              description: 'Security and vulnerability tests',
              authorizedSigners: ['maintainer'],
              fingerprint: {
                paths: ['src/**/*.ts', 'test/security/**/*.ts'],
                exclude: ['**/*.test.ts'],
              },
              maxAge: '14d',
            },
          },
        }

        const operational: OperationalConfig = {
          version: 1,
          settings: {
            defaultCommand: 'npm run verify',
            keyProvider: {
              type: '1password',
              options: {
                vault: 'Engineering',
                itemName: 'attest-it-key',
                account: 'team.1password.com',
              },
            },
          },
          suites: {
            security: {
              gate: 'security',
              command: 'npm run test:security',
              timeout: '5m',
              interactive: false,
            },
          },
          groups: {
            critical: ['security'],
          },
        }

        const merged = mergeConfigs(policy, operational)

        // Verify all fields are correctly merged
        expect(merged.version).toBe(1)
        expect(merged.settings.maxAgeDays).toBe(60)
        expect(merged.settings.publicKeyPath).toBe('keys/public.pem')
        expect(merged.settings.attestationsPath).toBe('attestations/data.json')
        expect(merged.settings.defaultCommand).toBe('npm run verify')
        expect(merged.settings.keyProvider?.type).toBe('1password')
        expect(merged.team?.maintainer).toBeDefined()
        expect(merged.gates?.security).toBeDefined()
        expect(merged.suites.security).toBeDefined()
        expect(merged.groups?.critical).toEqual(['security'])
      })
    })

    describe('edge cases', () => {
      it('should handle empty team and gates in policy', () => {
        const policy: PolicyConfig = {
          version: 1,
          settings: {
            maxAgeDays: 30,
            publicKeyPath: '.attest-it/pubkey.pem',
            attestationsPath: '.attest-it/attestations.json',
          },
          team: {},
          gates: {},
        }

        const operational: OperationalConfig = {
          version: 1,
          settings: {},
          suites: {
            unit: {
              packages: ['packages/core'],
            },
          },
        }

        const merged = mergeConfigs(policy, operational)

        expect(merged.team).toEqual({})
        expect(merged.gates).toEqual({})
      })

      it('should handle undefined team and gates in policy', () => {
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
              packages: ['packages/core'],
            },
          },
        }

        const merged = mergeConfigs(policy, operational)

        expect(merged.team).toBeUndefined()
        expect(merged.gates).toBeUndefined()
      })

      it('should handle undefined groups in operational config', () => {
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
              packages: ['packages/core'],
            },
          },
        }

        const merged = mergeConfigs(policy, operational)

        expect(merged.groups).toBeUndefined()
      })

      it('should handle undefined defaultCommand and keyProvider in operational settings', () => {
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
              packages: ['packages/core'],
            },
          },
        }

        const merged = mergeConfigs(policy, operational)

        expect(merged.settings.defaultCommand).toBeUndefined()
        expect(merged.settings.keyProvider).toBeUndefined()
      })

      it('should handle suites with various optional fields', () => {
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
            minimal: {
              packages: ['src'],
            },
            complete: {
              gate: 'core',
              description: 'Complete test suite',
              packages: ['packages/core'],
              files: ['docs/**/*.md'],
              ignore: ['*.tmp'],
              command: 'npm test',
              timeout: '10m',
              interactive: true,
              invalidates: ['downstream'],
              depends_on: ['upstream'],
            },
          },
        }

        const merged = mergeConfigs(policy, operational)

        expect(merged.suites.minimal).toEqual(operational.suites.minimal)
        expect(merged.suites.complete).toEqual(operational.suites.complete)
      })
    })

    describe('policy settings precedence', () => {
      it('should always use policy settings for security-critical fields', () => {
        const policy: PolicyConfig = {
          version: 1,
          settings: {
            maxAgeDays: 100,
            publicKeyPath: 'policy/pubkey.pem',
            attestationsPath: 'policy/attestations.json',
          },
        }

        const operational: OperationalConfig = {
          version: 1,
          settings: {
            defaultCommand: 'npm test',
          },
          suites: {
            unit: {
              packages: ['src'],
            },
          },
        }

        const merged = mergeConfigs(policy, operational)

        // Policy settings must not be overridden
        expect(merged.settings.maxAgeDays).toBe(100)
        expect(merged.settings.publicKeyPath).toBe('policy/pubkey.pem')
        expect(merged.settings.attestationsPath).toBe('policy/attestations.json')
        // Operational setting should be added
        expect(merged.settings.defaultCommand).toBe('npm test')
      })
    })
  })
})
