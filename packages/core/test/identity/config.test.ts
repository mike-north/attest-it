/**
 * Tests for identity configuration loading and validation.
 */

import * as fs from 'node:fs'
import { homedir } from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  LocalConfigValidationError,
  getActiveIdentity,
  getLocalConfigPath,
  loadLocalConfig,
  loadLocalConfigSync,
  saveLocalConfig,
  saveLocalConfigSync,
  getHomePublicKeysDir,
  getProjectPublicKeysDir,
  hasProjectConfig,
  savePublicKey,
  savePublicKeySync,
  setAttestItHomeDir,
  type Identity,
  type LocalConfig,
} from '../../src/identity/index.js'

const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures', 'identity-configs')

describe('identity/config', () => {
  describe('getLocalConfigPath', () => {
    describe('positive tests', () => {
      it('should return path to ~/.config/attest-it/config.yaml', () => {
        const configPath = getLocalConfigPath()
        const expectedPath = path.join(homedir(), '.config', 'attest-it', 'config.yaml')
        expect(configPath).toBe(expectedPath)
      })

      it('should always return absolute path', () => {
        const configPath = getLocalConfigPath()
        expect(path.isAbsolute(configPath)).toBe(true)
      })
    })

    describe('edge cases', () => {
      it('should handle ~ expansion in path', () => {
        const configPath = getLocalConfigPath()
        expect(configPath).not.toContain('~')
        expect(configPath).toContain(homedir())
      })
    })
  })

  describe('loadLocalConfig', () => {
    describe('positive tests', () => {
      it('should load a valid config with file-based private key', async () => {
        const configPath = path.join(FIXTURES_DIR, 'valid-file.yaml')
        const config = await loadLocalConfig(configPath)

        expect(config).not.toBeNull()
        expect(config?.activeIdentity).toBe('default')
        expect(config?.identities.default).toBeDefined()

        const identity = config?.identities.default
        expect(identity?.name).toBe('default')
        expect(identity?.email).toBe('user@example.com')
        expect(identity?.github).toBe('testuser')
        expect(identity?.publicKey).toBe('AbCdEfGhIjKlMnOpQrStUvWxYz1234567890=')
        expect(identity?.privateKey.type).toBe('file')
        if (identity?.privateKey.type === 'file') {
          expect(identity.privateKey.path).toBe('/home/user/.ssh/attest-it.key')
        }
      })

      it('should load a valid config with keychain-based private key', async () => {
        const configPath = path.join(FIXTURES_DIR, 'valid-keychain.yaml')
        const config = await loadLocalConfig(configPath)

        expect(config).not.toBeNull()
        expect(config?.activeIdentity).toBe('work')

        const identity = config?.identities.work
        expect(identity?.privateKey.type).toBe('keychain')
        if (identity?.privateKey.type === 'keychain') {
          expect(identity.privateKey.service).toBe('attest-it')
          expect(identity.privateKey.account).toBe('work-key')
        }
      })

      it('should load a valid config with 1Password-based private key', async () => {
        const configPath = path.join(FIXTURES_DIR, 'valid-1password.yaml')
        const config = await loadLocalConfig(configPath)

        expect(config).not.toBeNull()
        expect(config?.activeIdentity).toBe('personal')

        const identity = config?.identities.personal
        expect(identity?.privateKey.type).toBe('1password')
        if (identity?.privateKey.type === '1password') {
          expect(identity.privateKey.account).toBe('user@example.com')
          expect(identity.privateKey.vault).toBe('Development')
          expect(identity.privateKey.item).toBe('attest-it-key')
          expect(identity.privateKey.field).toBe('private_key')
        }
      })

      it('should load a config with multiple identities', async () => {
        const configPath = path.join(FIXTURES_DIR, 'multiple-identities.yaml')
        const config = await loadLocalConfig(configPath)

        expect(config).not.toBeNull()
        expect(config?.activeIdentity).toBe('work')
        expect(Object.keys(config?.identities ?? {})).toHaveLength(2)
        expect(config?.identities.work).toBeDefined()
        expect(config?.identities.personal).toBeDefined()
      })

      it('should load a minimal config without optional fields', async () => {
        const configPath = path.join(FIXTURES_DIR, 'minimal.yaml')
        const config = await loadLocalConfig(configPath)

        expect(config).not.toBeNull()
        expect(config?.activeIdentity).toBe('minimal')

        const identity = config?.identities.minimal
        expect(identity?.name).toBe('minimal')
        expect(identity?.email).toBeUndefined()
        expect(identity?.github).toBeUndefined()
        expect(identity?.publicKey).toBe('bWluaW1hbCBwdWJsaWMga2V5IGZvciB0ZXN0aW5n')
      })
    })

    describe('negative tests', () => {
      it('should return null when config file does not exist', async () => {
        const nonExistentPath = path.join(FIXTURES_DIR, 'nonexistent.yaml')
        const config = await loadLocalConfig(nonExistentPath)

        expect(config).toBeNull()
      })

      it('should throw LocalConfigValidationError for empty identities', async () => {
        const configPath = path.join(FIXTURES_DIR, 'invalid-no-identities.yaml')

        await expect(loadLocalConfig(configPath)).rejects.toThrow(LocalConfigValidationError)
        await expect(loadLocalConfig(configPath)).rejects.toThrow(
          'At least one identity must be defined',
        )
      })

      it('should throw LocalConfigValidationError for empty public key', async () => {
        const configPath = path.join(FIXTURES_DIR, 'invalid-empty-publickey.yaml')

        await expect(loadLocalConfig(configPath)).rejects.toThrow(LocalConfigValidationError)
        await expect(loadLocalConfig(configPath)).rejects.toThrow('Public key cannot be empty')
      })

      it('should throw LocalConfigValidationError for extra properties', async () => {
        const configPath = path.join(FIXTURES_DIR, 'invalid-extra-property.yaml')

        await expect(loadLocalConfig(configPath)).rejects.toThrow(LocalConfigValidationError)
      })

      it('should throw LocalConfigValidationError for invalid private key type', async () => {
        const configPath = path.join(FIXTURES_DIR, 'invalid-privatekey-type.yaml')

        await expect(loadLocalConfig(configPath)).rejects.toThrow(LocalConfigValidationError)
      })

      it('should throw LocalConfigValidationError for invalid YAML syntax', async () => {
        const tempDir = fs.mkdtempSync(path.join(__dirname, 'test-identity-'))
        const configPath = path.join(tempDir, 'config.yaml')

        try {
          fs.writeFileSync(
            configPath,
            `
activeIdentity: default
identities:
  default:
    name: [unclosed array
`,
          )

          await expect(loadLocalConfig(configPath)).rejects.toThrow(LocalConfigValidationError)
        } finally {
          fs.rmSync(tempDir, { recursive: true, force: true })
        }
      })

      it('should throw LocalConfigValidationError when missing required fields', async () => {
        const tempDir = fs.mkdtempSync(path.join(__dirname, 'test-identity-'))
        const configPath = path.join(tempDir, 'config.yaml')

        try {
          fs.writeFileSync(
            configPath,
            `
activeIdentity: default
identities:
  default:
    name: default
    # Missing publicKey and privateKey
`,
          )

          await expect(loadLocalConfig(configPath)).rejects.toThrow(LocalConfigValidationError)
        } finally {
          fs.rmSync(tempDir, { recursive: true, force: true })
        }
      })
    })

    describe('edge cases', () => {
      it('should handle empty active identity name', async () => {
        const tempDir = fs.mkdtempSync(path.join(__dirname, 'test-identity-'))
        const configPath = path.join(tempDir, 'config.yaml')

        try {
          fs.writeFileSync(
            configPath,
            `
activeIdentity: ""
identities:
  default:
    name: default
    publicKey: dGVzdA==
    privateKey:
      type: file
      path: /path
`,
          )

          await expect(loadLocalConfig(configPath)).rejects.toThrow(LocalConfigValidationError)
          await expect(loadLocalConfig(configPath)).rejects.toThrow(
            'Active identity name cannot be empty',
          )
        } finally {
          fs.rmSync(tempDir, { recursive: true, force: true })
        }
      })

      it('should handle file private key with empty path', async () => {
        const tempDir = fs.mkdtempSync(path.join(__dirname, 'test-identity-'))
        const configPath = path.join(tempDir, 'config.yaml')

        try {
          fs.writeFileSync(
            configPath,
            `
activeIdentity: default
identities:
  default:
    name: default
    publicKey: dGVzdA==
    privateKey:
      type: file
      path: ""
`,
          )

          await expect(loadLocalConfig(configPath)).rejects.toThrow(LocalConfigValidationError)
          await expect(loadLocalConfig(configPath)).rejects.toThrow('File path cannot be empty')
        } finally {
          fs.rmSync(tempDir, { recursive: true, force: true })
        }
      })

      it('should handle keychain private key with empty service', async () => {
        const tempDir = fs.mkdtempSync(path.join(__dirname, 'test-identity-'))
        const configPath = path.join(tempDir, 'config.yaml')

        try {
          fs.writeFileSync(
            configPath,
            `
activeIdentity: default
identities:
  default:
    name: default
    publicKey: dGVzdA==
    privateKey:
      type: keychain
      service: ""
      account: test
`,
          )

          await expect(loadLocalConfig(configPath)).rejects.toThrow(LocalConfigValidationError)
          await expect(loadLocalConfig(configPath)).rejects.toThrow('Service name cannot be empty')
        } finally {
          fs.rmSync(tempDir, { recursive: true, force: true })
        }
      })

      it('should handle 1Password private key with empty vault', async () => {
        const tempDir = fs.mkdtempSync(path.join(__dirname, 'test-identity-'))
        const configPath = path.join(tempDir, 'config.yaml')

        try {
          fs.writeFileSync(
            configPath,
            `
activeIdentity: default
identities:
  default:
    name: default
    publicKey: dGVzdA==
    privateKey:
      type: 1password
      vault: ""
      item: test
`,
          )

          await expect(loadLocalConfig(configPath)).rejects.toThrow(LocalConfigValidationError)
          await expect(loadLocalConfig(configPath)).rejects.toThrow('Vault name cannot be empty')
        } finally {
          fs.rmSync(tempDir, { recursive: true, force: true })
        }
      })

      it('should handle 1Password without optional account field', async () => {
        const tempDir = fs.mkdtempSync(path.join(__dirname, 'test-identity-'))
        const configPath = path.join(tempDir, 'config.yaml')

        try {
          fs.writeFileSync(
            configPath,
            `
activeIdentity: default
identities:
  default:
    name: default
    publicKey: dGVzdA==
    privateKey:
      type: 1password
      vault: Development
      item: my-key
`,
          )

          const config = await loadLocalConfig(configPath)

          expect(config).not.toBeNull()
          const identity = config?.identities.default
          expect(identity?.privateKey.type).toBe('1password')
          if (identity?.privateKey.type === '1password') {
            expect(identity.privateKey.account).toBeUndefined()
            expect(identity.privateKey.field).toBeUndefined()
          }
        } finally {
          fs.rmSync(tempDir, { recursive: true, force: true })
        }
      })
    })
  })

  describe('loadLocalConfigSync', () => {
    describe('positive tests', () => {
      it('should load a valid config synchronously', () => {
        const configPath = path.join(FIXTURES_DIR, 'valid-file.yaml')
        const config = loadLocalConfigSync(configPath)

        expect(config).not.toBeNull()
        expect(config?.activeIdentity).toBe('default')
        expect(config?.identities.default).toBeDefined()
      })
    })

    describe('negative tests', () => {
      it('should return null when config file does not exist', () => {
        const nonExistentPath = path.join(FIXTURES_DIR, 'nonexistent.yaml')
        const config = loadLocalConfigSync(nonExistentPath)

        expect(config).toBeNull()
      })

      it('should throw LocalConfigValidationError for invalid config', () => {
        const configPath = path.join(FIXTURES_DIR, 'invalid-no-identities.yaml')

        expect(() => loadLocalConfigSync(configPath)).toThrow(LocalConfigValidationError)
      })
    })
  })

  describe('saveLocalConfig and saveLocalConfigSync', () => {
    let tempDir: string

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(__dirname, 'test-save-'))
    })

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true })
    })

    describe('positive tests', () => {
      it('should save config with async version', async () => {
        const configPath = path.join(tempDir, 'config.yaml')

        const config: LocalConfig = {
          activeIdentity: 'test',
          identities: {
            test: {
              name: 'test',
              email: 'test@example.com',
              publicKey: 'dGVzdCBwdWJsaWMga2V5',
              privateKey: {
                type: 'file',
                path: '/test/path',
              },
            },
          },
        }

        await saveLocalConfig(config, configPath)

        const content = fs.readFileSync(configPath, 'utf8')
        expect(content).toContain('activeIdentity: test')
        expect(content).toContain('test@example.com')
      })

      it('should save config with sync version', () => {
        const configPath = path.join(tempDir, 'config.yaml')

        const config: LocalConfig = {
          activeIdentity: 'test',
          identities: {
            test: {
              name: 'test',
              publicKey: 'dGVzdCBwdWJsaWMga2V5',
              privateKey: {
                type: 'keychain',
                service: 'attest-it',
                account: 'test-key',
              },
            },
          },
        }

        saveLocalConfigSync(config, configPath)

        const content = fs.readFileSync(configPath, 'utf8')
        expect(content).toContain('activeIdentity: test')
        expect(content).toContain('type: keychain')
      })

      it('should create parent directories if they do not exist', async () => {
        const nestedPath = path.join(tempDir, 'nested', 'dir', 'config.yaml')

        const config: LocalConfig = {
          activeIdentity: 'test',
          identities: {
            test: {
              name: 'test',
              publicKey: 'dGVzdCBwdWJsaWMga2V5',
              privateKey: {
                type: 'file',
                path: '/test/path',
              },
            },
          },
        }

        await saveLocalConfig(config, nestedPath)

        expect(fs.existsSync(nestedPath)).toBe(true)
      })

      it('should overwrite existing config', async () => {
        const configPath = path.join(tempDir, 'config.yaml')

        const config1: LocalConfig = {
          activeIdentity: 'first',
          identities: {
            first: {
              name: 'first',
              publicKey: 'Zmlyc3Q=',
              privateKey: {
                type: 'file',
                path: '/first',
              },
            },
          },
        }

        await saveLocalConfig(config1, configPath)

        const config2: LocalConfig = {
          activeIdentity: 'second',
          identities: {
            second: {
              name: 'second',
              publicKey: 'c2Vjb25k',
              privateKey: {
                type: 'file',
                path: '/second',
              },
            },
          },
        }

        await saveLocalConfig(config2, configPath)

        const content = fs.readFileSync(configPath, 'utf8')
        expect(content).toContain('activeIdentity: second')
        expect(content).not.toContain('first')
      })
    })
  })

  describe('getActiveIdentity', () => {
    describe('positive tests', () => {
      it('should return the active identity', () => {
        const config: LocalConfig = {
          activeIdentity: 'work',
          identities: {
            work: {
              name: 'work',
              email: 'work@company.com',
              publicKey: 'd29yaw==',
              privateKey: {
                type: 'file',
                path: '/work/key',
              },
            },
            personal: {
              name: 'personal',
              publicKey: 'cGVyc29uYWw=',
              privateKey: {
                type: 'file',
                path: '/personal/key',
              },
            },
          },
        }

        const active = getActiveIdentity(config)

        expect(active).toBeDefined()
        expect(active?.name).toBe('work')
        expect(active?.email).toBe('work@company.com')
      })

      it('should preserve all identity properties', () => {
        const config: LocalConfig = {
          activeIdentity: 'full',
          identities: {
            full: {
              name: 'full',
              email: 'full@example.com',
              github: 'fulluser',
              publicKey: 'ZnVsbA==',
              privateKey: {
                type: '1password',
                account: 'user@example.com',
                vault: 'Development',
                item: 'key',
                field: 'private_key',
              },
            },
          },
        }

        const active = getActiveIdentity(config)

        expect(active?.name).toBe('full')
        expect(active?.email).toBe('full@example.com')
        expect(active?.github).toBe('fulluser')
        expect(active?.publicKey).toBe('ZnVsbA==')
        expect(active?.privateKey.type).toBe('1password')
      })
    })

    describe('negative tests', () => {
      it('should return undefined when active identity does not exist', () => {
        const config: LocalConfig = {
          activeIdentity: 'nonexistent',
          identities: {
            existing: {
              name: 'existing',
              publicKey: 'ZXhpc3Rpbmc=',
              privateKey: {
                type: 'file',
                path: '/existing',
              },
            },
          },
        }

        const active = getActiveIdentity(config)

        expect(active).toBeUndefined()
      })
    })

    describe('edge cases', () => {
      it('should handle single identity config', () => {
        const config: LocalConfig = {
          activeIdentity: 'only',
          identities: {
            only: {
              name: 'only',
              publicKey: 'b25seQ==',
              privateKey: {
                type: 'file',
                path: '/only',
              },
            },
          },
        }

        const active = getActiveIdentity(config)

        expect(active).toBeDefined()
        expect(active?.name).toBe('only')
      })

      it('should handle config with many identities', () => {
        const identities: Record<string, Identity> = {}
        for (let i = 0; i < 50; i++) {
          const iStr = i.toString()
          identities[`identity${iStr}`] = {
            name: `identity${iStr}`,
            publicKey: `aWRlbnRpdHk${iStr}`,
            privateKey: {
              type: 'file',
              path: `/identity${iStr}`,
            },
          }
        }

        const config: LocalConfig = {
          activeIdentity: 'identity25',
          identities,
        }

        const active = getActiveIdentity(config)

        expect(active).toBeDefined()
        expect(active?.name).toBe('identity25')
      })
    })
  })

  describe('LocalConfigValidationError', () => {
    it('should include Zod issues in the error', async () => {
      const configPath = path.join(FIXTURES_DIR, 'invalid-no-identities.yaml')

      try {
        await loadLocalConfig(configPath)
        expect.fail('Expected LocalConfigValidationError to be thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(LocalConfigValidationError)
        if (error instanceof LocalConfigValidationError) {
          expect(error.issues).toBeDefined()
          expect(Array.isArray(error.issues)).toBe(true)
          expect(error.issues.length).toBeGreaterThan(0)
        }
      }
    })

    it('should have a descriptive error message', async () => {
      const configPath = path.join(FIXTURES_DIR, 'invalid-empty-publickey.yaml')

      try {
        await loadLocalConfig(configPath)
        expect.fail('Expected LocalConfigValidationError to be thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(LocalConfigValidationError)
        if (error instanceof LocalConfigValidationError) {
          expect(error.message).toContain('Local configuration validation failed')
          expect(error.message).toContain('publicKey')
        }
      }
    })
  })

  describe('public key storage', () => {
    let tempDir: string
    let originalHomeDir: string | null

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(__dirname, 'test-pubkey-'))
      originalHomeDir = null
    })

    afterEach(() => {
      // Reset home dir override
      if (originalHomeDir !== null) {
        setAttestItHomeDir(originalHomeDir)
      } else {
        setAttestItHomeDir(null)
      }
      fs.rmSync(tempDir, { recursive: true, force: true })
    })

    describe('getHomePublicKeysDir', () => {
      it('should return ~/.attest-it/public-keys by default', () => {
        setAttestItHomeDir(null)
        const dir = getHomePublicKeysDir()
        expect(dir).toBe(path.join(homedir(), '.attest-it', 'public-keys'))
      })

      it('should respect home dir override', () => {
        setAttestItHomeDir(tempDir)
        const dir = getHomePublicKeysDir()
        expect(dir).toBe(path.join(tempDir, 'public-keys'))
      })
    })

    describe('getProjectPublicKeysDir', () => {
      it('should return .attest-it/public-keys relative to project root', () => {
        const dir = getProjectPublicKeysDir('/my/project')
        expect(dir).toBe('/my/project/.attest-it/public-keys')
      })

      it('should use cwd as default project root', () => {
        const dir = getProjectPublicKeysDir()
        expect(dir).toBe(path.join(process.cwd(), '.attest-it', 'public-keys'))
      })
    })

    describe('hasProjectConfig', () => {
      it('should return true when config.yaml exists', () => {
        const configDir = path.join(tempDir, '.attest-it')
        fs.mkdirSync(configDir, { recursive: true })
        fs.writeFileSync(path.join(configDir, 'config.yaml'), 'version: 1')

        expect(hasProjectConfig(tempDir)).toBe(true)
      })

      it('should return true when config.yml exists', () => {
        const configDir = path.join(tempDir, '.attest-it')
        fs.mkdirSync(configDir, { recursive: true })
        fs.writeFileSync(path.join(configDir, 'config.yml'), 'version: 1')

        expect(hasProjectConfig(tempDir)).toBe(true)
      })

      it('should return true when config.json exists', () => {
        const configDir = path.join(tempDir, '.attest-it')
        fs.mkdirSync(configDir, { recursive: true })
        fs.writeFileSync(path.join(configDir, 'config.json'), '{"version": 1}')

        expect(hasProjectConfig(tempDir)).toBe(true)
      })

      it('should return false when no config exists', () => {
        expect(hasProjectConfig(tempDir)).toBe(false)
      })

      it('should return false when .attest-it directory exists but no config file', () => {
        const configDir = path.join(tempDir, '.attest-it')
        fs.mkdirSync(configDir, { recursive: true })

        expect(hasProjectConfig(tempDir)).toBe(false)
      })
    })

    describe('savePublicKey', () => {
      it('should save public key to home directory', async () => {
        setAttestItHomeDir(tempDir)

        const result = await savePublicKey('test-identity', 'dGVzdC1wdWJsaWMta2V5', tempDir)

        expect(result.homePath).toBe(path.join(tempDir, 'public-keys', 'test-identity.pem'))
        expect(fs.existsSync(result.homePath)).toBe(true)
        expect(fs.readFileSync(result.homePath, 'utf8')).toBe('dGVzdC1wdWJsaWMta2V5')
      })

      it('should no longer save to project directory (keys now stored inline)', async () => {
        setAttestItHomeDir(tempDir)

        // Create project config
        const configDir = path.join(tempDir, '.attest-it')
        fs.mkdirSync(configDir, { recursive: true })
        fs.writeFileSync(path.join(configDir, 'config.yaml'), 'version: 1')

        const result = await savePublicKey('my-identity', 'bXktcHVibGljLWtleQ==', tempDir)

        // Should save to home directory
        expect(result.homePath).toBe(path.join(tempDir, 'public-keys', 'my-identity.pem'))
        expect(fs.existsSync(result.homePath)).toBe(true)

        // Should NOT save to project directory
        expect(result.projectPath).toBeUndefined()
        const projectKeyPath = path.join(tempDir, '.attest-it', 'public-keys', 'my-identity.pem')
        expect(fs.existsSync(projectKeyPath)).toBe(false)
      })

      it('should not save to project directory when project has no config', async () => {
        setAttestItHomeDir(tempDir)

        // Create a separate project directory without config
        const projectDir = path.join(tempDir, 'no-config-project')
        fs.mkdirSync(projectDir, { recursive: true })

        const result = await savePublicKey('no-project', 'bm8tcHJvamVjdA==', projectDir)

        expect(result.homePath).toBe(path.join(tempDir, 'public-keys', 'no-project.pem'))
        expect(result.projectPath).toBeUndefined()
      })

      it('should create directories if they do not exist', async () => {
        setAttestItHomeDir(tempDir)

        const result = await savePublicKey('new-identity', 'bmV3LWlkZW50aXR5', tempDir)

        expect(fs.existsSync(path.dirname(result.homePath))).toBe(true)
      })
    })

    describe('savePublicKeySync', () => {
      it('should save public key to home directory synchronously', () => {
        setAttestItHomeDir(tempDir)

        const result = savePublicKeySync('sync-identity', 'c3luYy1pZGVudGl0eQ==', tempDir)

        expect(result.homePath).toBe(path.join(tempDir, 'public-keys', 'sync-identity.pem'))
        expect(fs.existsSync(result.homePath)).toBe(true)
        expect(fs.readFileSync(result.homePath, 'utf8')).toBe('c3luYy1pZGVudGl0eQ==')
      })

      it('should no longer save to project directory (keys now stored inline)', () => {
        setAttestItHomeDir(tempDir)

        // Create project config
        const configDir = path.join(tempDir, '.attest-it')
        fs.mkdirSync(configDir, { recursive: true })
        fs.writeFileSync(path.join(configDir, 'config.yaml'), 'version: 1')

        const result = savePublicKeySync('sync-project', 'c3luYy1wcm9qZWN0', tempDir)

        // Should save to home directory
        expect(result.homePath).toBe(path.join(tempDir, 'public-keys', 'sync-project.pem'))
        expect(fs.existsSync(result.homePath)).toBe(true)

        // Should NOT save to project directory
        expect(result.projectPath).toBeUndefined()
        const projectKeyPath = path.join(tempDir, '.attest-it', 'public-keys', 'sync-project.pem')
        expect(fs.existsSync(projectKeyPath)).toBe(false)
      })
    })
  })
})
