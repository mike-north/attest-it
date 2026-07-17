/**
 * Tests for identity configuration loading, validation, and v1→v2 migration.
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

  describe('loadLocalConfig (v2 format)', () => {
    describe('positive tests', () => {
      it('should load a valid v2 config with file-based private key', async () => {
        const configPath = path.join(FIXTURES_DIR, 'valid-file.yaml')
        const config = await loadLocalConfig(configPath)

        expect(config).not.toBeNull()
        expect(config?.version).toBe(2)
        expect(config?.activeIdentity).toBe('default')
        expect(config?.identities.default).toBeDefined()

        const identity = config?.identities.default
        expect(identity?.name).toBe('default')
        expect(identity?.email).toBe('user@example.com')
        expect(identity?.github).toBe('testuser')
        expect(identity?.publicKey).toBe('AbCdEfGhIjKlMnOpQrStUvWxYz1234567890=')
        expect(identity?.privateKey.type).toBe('file')
        if (identity?.privateKey.type === 'file') {
          expect(identity.privateKey.id).toBe('attest-it-550e8400-e29b-41d4-a716-446655440000')
        }
      })

      it('should load a valid v2 config with keychain-based private key', async () => {
        const configPath = path.join(FIXTURES_DIR, 'valid-keychain.yaml')
        const config = await loadLocalConfig(configPath)

        expect(config).not.toBeNull()
        expect(config?.version).toBe(2)
        expect(config?.activeIdentity).toBe('work')

        const identity = config?.identities.work
        expect(identity?.privateKey.type).toBe('keychain')
        if (identity?.privateKey.type === 'keychain') {
          expect(identity.privateKey.id).toBe('attest-it-work-keychain-key')
        }
      })

      it('should load a valid v2 config with 1Password-based private key', async () => {
        const configPath = path.join(FIXTURES_DIR, 'valid-1password.yaml')
        const config = await loadLocalConfig(configPath)

        expect(config).not.toBeNull()
        expect(config?.version).toBe(2)
        expect(config?.activeIdentity).toBe('personal')

        const identity = config?.identities.personal
        expect(identity?.privateKey.type).toBe('1password')
        if (identity?.privateKey.type === '1password') {
          expect(identity.privateKey.id).toBe('attest-it-personal-key')
          expect(identity.privateKey.vault).toBe('Development')
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

      it('should load a minimal v2 config without optional fields', async () => {
        const configPath = path.join(FIXTURES_DIR, 'minimal.yaml')
        const config = await loadLocalConfig(configPath)

        expect(config).not.toBeNull()
        expect(config?.version).toBe(2)
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

      it('should throw LocalConfigValidationError for invalid YAML syntax', async () => {
        const tempDir = fs.mkdtempSync(path.join(__dirname, 'test-identity-'))
        const configPath = path.join(tempDir, 'config.yaml')

        try {
          fs.writeFileSync(
            configPath,
            `
version: 2
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
version: 2
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
version: 2
activeIdentity: ""
identities:
  default:
    name: default
    publicKey: dGVzdA==
    privateKey:
      type: file
      id: attest-it-test-key
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

      it('should handle file private key with empty id', async () => {
        const tempDir = fs.mkdtempSync(path.join(__dirname, 'test-identity-'))
        const configPath = path.join(tempDir, 'config.yaml')

        try {
          fs.writeFileSync(
            configPath,
            `
version: 2
activeIdentity: default
identities:
  default:
    name: default
    publicKey: dGVzdA==
    privateKey:
      type: file
      id: ""
`,
          )

          await expect(loadLocalConfig(configPath)).rejects.toThrow(LocalConfigValidationError)
          await expect(loadLocalConfig(configPath)).rejects.toThrow('Secret ID cannot be empty')
        } finally {
          fs.rmSync(tempDir, { recursive: true, force: true })
        }
      })

      it('should handle 1Password without optional vault field', async () => {
        const tempDir = fs.mkdtempSync(path.join(__dirname, 'test-identity-'))
        const configPath = path.join(tempDir, 'config.yaml')

        try {
          fs.writeFileSync(
            configPath,
            `
version: 2
activeIdentity: default
identities:
  default:
    name: default
    publicKey: dGVzdA==
    privateKey:
      type: 1password
      id: attest-it-my-key
`,
          )

          const config = await loadLocalConfig(configPath)

          expect(config).not.toBeNull()
          const identity = config?.identities.default
          expect(identity?.privateKey.type).toBe('1password')
          if (identity?.privateKey.type === '1password') {
            expect(identity.privateKey.id).toBe('attest-it-my-key')
            expect(identity.privateKey.vault).toBeUndefined()
          }
        } finally {
          fs.rmSync(tempDir, { recursive: true, force: true })
        }
      })
    })
  })

  describe('v1→v2 migration', () => {
    it('should automatically migrate a v1 file-based config to v2', async () => {
      const configPath = path.join(FIXTURES_DIR, 'v1-file.yaml')
      const config = await loadLocalConfig(configPath)

      expect(config).not.toBeNull()
      // After migration, version is 2
      expect(config?.version).toBe(2)
      expect(config?.activeIdentity).toBe('default')

      // v1 `type: file` with `path:` becomes `type: filesystem` with `path:` (legacy fallback)
      const identity = config?.identities.default
      expect(identity?.privateKey.type).toBe('filesystem')
      if (identity?.privateKey.type === 'filesystem') {
        expect(identity.privateKey.path).toBe('/home/user/.ssh/attest-it.key')
      }
    })

    it('should automatically migrate a v1 keychain config to v2', async () => {
      const configPath = path.join(FIXTURES_DIR, 'v1-keychain.yaml')
      const config = await loadLocalConfig(configPath)

      expect(config).not.toBeNull()
      expect(config?.version).toBe(2)

      // v1 `type: keychain` becomes `type: filesystem` with a pseudo-URI path
      const identity = config?.identities.work
      expect(identity?.privateKey.type).toBe('filesystem')
      if (identity?.privateKey.type === 'filesystem') {
        expect(identity.privateKey.path).toBe('keychain://attest-it/work-key')
      }
    })

    it('should automatically migrate a v1 1Password config to v2', async () => {
      const configPath = path.join(FIXTURES_DIR, 'v1-1password.yaml')
      const config = await loadLocalConfig(configPath)

      expect(config).not.toBeNull()
      expect(config?.version).toBe(2)

      // v1 `type: 1password` becomes `type: filesystem` with a pseudo-URI path
      const identity = config?.identities.personal
      expect(identity?.privateKey.type).toBe('filesystem')
      if (identity?.privateKey.type === 'filesystem') {
        expect(identity.privateKey.path).toBe('1password://Development/attest-it-key')
      }
    })

    it('should automatically migrate a v1 yubikey config to v2', async () => {
      const tempDir = fs.mkdtempSync(path.join(__dirname, 'test-migration-'))
      const configPath = path.join(tempDir, 'config.yaml')

      try {
        fs.writeFileSync(
          configPath,
          `
version: 1
activeIdentity: default
identities:
  default:
    name: default
    publicKey: dGVzdA==
    privateKey:
      type: yubikey
      encryptedKeyPath: /path/to/encrypted.key
      slot: 2
`,
        )

        const config = await loadLocalConfig(configPath)

        expect(config?.version).toBe(2)
        const identity = config?.identities.default
        // v1 yubikey becomes `type: filesystem` using encryptedKeyPath
        expect(identity?.privateKey.type).toBe('filesystem')
        if (identity?.privateKey.type === 'filesystem') {
          expect(identity.privateKey.path).toBe('/path/to/encrypted.key')
        }
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true })
      }
    })

    it('should migrate a versionless (legacy) file to v2', async () => {
      const tempDir = fs.mkdtempSync(path.join(__dirname, 'test-migration-'))
      const configPath = path.join(tempDir, 'config.yaml')

      try {
        fs.writeFileSync(
          configPath,
          `
activeIdentity: legacy
identities:
  legacy:
    name: legacy
    publicKey: bGVnYWN5
    privateKey:
      type: file
      path: /legacy/path/key
`,
        )

        const config = await loadLocalConfig(configPath)

        expect(config?.version).toBe(2)
        const identity = config?.identities.legacy
        expect(identity?.privateKey.type).toBe('filesystem')
        if (identity?.privateKey.type === 'filesystem') {
          expect(identity.privateKey.path).toBe('/legacy/path/key')
        }
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true })
      }
    })

    it('should preserve email and github through migration', async () => {
      const configPath = path.join(FIXTURES_DIR, 'v1-1password.yaml')
      const config = await loadLocalConfig(configPath)

      const identity = config?.identities.personal
      expect(identity?.email).toBe('personal@example.com')
      expect(identity?.github).toBe('mygithub')
    })

    it('should sync-load and migrate a v1 config correctly', () => {
      const configPath = path.join(FIXTURES_DIR, 'v1-file.yaml')
      const config = loadLocalConfigSync(configPath)

      expect(config).not.toBeNull()
      expect(config?.version).toBe(2)
      const identity = config?.identities.default
      expect(identity?.privateKey.type).toBe('filesystem')
    })
  })

  describe('loadLocalConfigSync', () => {
    describe('positive tests', () => {
      it('should load a valid v2 config synchronously', () => {
        const configPath = path.join(FIXTURES_DIR, 'valid-file.yaml')
        const config = loadLocalConfigSync(configPath)

        expect(config).not.toBeNull()
        expect(config?.version).toBe(2)
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
      it('should save a v2 config with async version', async () => {
        const configPath = path.join(tempDir, 'config.yaml')

        const config: LocalConfig = {
          version: 2,
          activeIdentity: 'test',
          identities: {
            test: {
              name: 'test',
              email: 'test@example.com',
              publicKey: 'dGVzdCBwdWJsaWMga2V5',
              privateKey: {
                type: 'file',
                id: 'attest-it-test-id',
              },
            },
          },
        }

        await saveLocalConfig(config, configPath)

        const content = fs.readFileSync(configPath, 'utf8')
        expect(content).toContain('activeIdentity: test')
        expect(content).toContain('test@example.com')
        expect(content).toContain('version: 2')
      })

      it('should save a v2 config with sync version', () => {
        const configPath = path.join(tempDir, 'config.yaml')

        const config: LocalConfig = {
          version: 2,
          activeIdentity: 'test',
          identities: {
            test: {
              name: 'test',
              publicKey: 'dGVzdCBwdWJsaWMga2V5',
              privateKey: {
                type: 'keychain',
                id: 'attest-it-keychain-key',
              },
            },
          },
        }

        saveLocalConfigSync(config, configPath)

        const content = fs.readFileSync(configPath, 'utf8')
        expect(content).toContain('activeIdentity: test')
        expect(content).toContain('type: keychain')
        expect(content).toContain('version: 2')
      })

      it('should save a config with the legacy filesystem type', async () => {
        const configPath = path.join(tempDir, 'config.yaml')

        const config: LocalConfig = {
          version: 2,
          activeIdentity: 'legacy',
          identities: {
            legacy: {
              name: 'legacy',
              publicKey: 'bGVnYWN5',
              privateKey: {
                type: 'filesystem',
                path: '/old/path/to/key',
              },
            },
          },
        }

        await saveLocalConfig(config, configPath)

        const content = fs.readFileSync(configPath, 'utf8')
        expect(content).toContain('type: filesystem')
        expect(content).toContain('/old/path/to/key')
      })

      it('should create parent directories if they do not exist', async () => {
        const nestedPath = path.join(tempDir, 'nested', 'dir', 'config.yaml')

        const config: LocalConfig = {
          version: 2,
          activeIdentity: 'test',
          identities: {
            test: {
              name: 'test',
              publicKey: 'dGVzdCBwdWJsaWMga2V5',
              privateKey: {
                type: 'file',
                id: 'attest-it-test-id',
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
          version: 2,
          activeIdentity: 'first',
          identities: {
            first: {
              name: 'first',
              publicKey: 'Zmlyc3Q=',
              privateKey: {
                type: 'file',
                id: 'first-id',
              },
            },
          },
        }

        await saveLocalConfig(config1, configPath)

        const config2: LocalConfig = {
          version: 2,
          activeIdentity: 'second',
          identities: {
            second: {
              name: 'second',
              publicKey: 'c2Vjb25k',
              privateKey: {
                type: 'file',
                id: 'second-id',
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
          version: 2,
          activeIdentity: 'work',
          identities: {
            work: {
              name: 'work',
              email: 'work@company.com',
              publicKey: 'd29yaw==',
              privateKey: {
                type: 'keychain',
                id: 'work-keychain-id',
              },
            },
            personal: {
              name: 'personal',
              publicKey: 'cGVyc29uYWw=',
              privateKey: {
                type: 'file',
                id: 'personal-file-id',
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
          version: 2,
          activeIdentity: 'full',
          identities: {
            full: {
              name: 'full',
              email: 'full@example.com',
              github: 'fulluser',
              publicKey: 'ZnVsbA==',
              privateKey: {
                type: '1password',
                id: 'my-1password-key',
                vault: 'Development',
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
          version: 2,
          activeIdentity: 'nonexistent',
          identities: {
            existing: {
              name: 'existing',
              publicKey: 'ZXhpc3Rpbmc=',
              privateKey: {
                type: 'file',
                id: 'existing-id',
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
          version: 2,
          activeIdentity: 'only',
          identities: {
            only: {
              name: 'only',
              publicKey: 'b25seQ==',
              privateKey: {
                type: 'file',
                id: 'only-id',
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
              id: `identity-${iStr}-id`,
            },
          }
        }

        const config: LocalConfig = {
          version: 2,
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

    describe('savePublicKey', () => {
      it('should save public key to home directory', async () => {
        setAttestItHomeDir(tempDir)

        const result = await savePublicKey('test-identity', 'dGVzdC1wdWJsaWMta2V5')

        expect(result.homePath).toBe(path.join(tempDir, 'public-keys', 'test-identity.pem'))
        expect(fs.existsSync(result.homePath)).toBe(true)
        expect(fs.readFileSync(result.homePath, 'utf8')).toBe('dGVzdC1wdWJsaWMta2V5')
      })

      it('should create directories if they do not exist', async () => {
        setAttestItHomeDir(tempDir)

        const result = await savePublicKey('new-identity', 'bmV3LWlkZW50aXR5')

        expect(fs.existsSync(path.dirname(result.homePath))).toBe(true)
      })
    })

    describe('savePublicKeySync', () => {
      it('should save public key to home directory synchronously', () => {
        setAttestItHomeDir(tempDir)

        const result = savePublicKeySync('sync-identity', 'c3luYy1pZGVudGl0eQ==')

        expect(result.homePath).toBe(path.join(tempDir, 'public-keys', 'sync-identity.pem'))
        expect(fs.existsSync(result.homePath)).toBe(true)
        expect(fs.readFileSync(result.homePath, 'utf8')).toBe('c3luYy1pZGVudGl0eQ==')
      })
    })
  })
})
