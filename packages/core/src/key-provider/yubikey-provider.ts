/**
 * YubiKey-based key provider implementation.
 *
 * @remarks
 * This provider stores private keys encrypted with a key derived from YubiKey
 * HMAC-SHA1 challenge-response. The key cannot be decrypted without the physical
 * YubiKey present. Uses HKDF to derive an AES-256-GCM encryption key from the
 * challenge-response output.
 *
 * Requires the `ykman` (YubiKey Manager) CLI tool to be installed.
 *
 * @packageDocumentation
 */

import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { generateKeyPair as cryptoGenerateKeyPair, setKeyPermissions } from '../crypto.js'
import type {
  KeyProvider,
  KeyProviderConfig,
  KeyRetrievalResult,
  KeyGenerationResult,
  KeygenProviderOptions,
} from './types.js'

/**
 * Options for creating a YubiKeyProvider.
 * @public
 */
export interface YubiKeyProviderOptions {
  /** Path to the encrypted key file */
  encryptedKeyPath: string
  /** YubiKey slot to use for challenge-response (default: 2) */
  slot?: 1 | 2
  /** Serial number of specific YubiKey to use (optional) */
  serial?: string
}

/**
 * Information about a connected YubiKey.
 * @public
 */
export interface YubiKeyInfo {
  /** Device serial number */
  serial: string
  /** Device type (e.g., "YubiKey 5 NFC") */
  type: string
  /** Firmware version */
  firmware: string
}

/**
 * Encrypted key file structure.
 * @internal
 */
interface EncryptedKeyFile {
  /** Version of the encryption format */
  version: 1
  /** AES-256-GCM initialization vector (base64) */
  iv: string
  /** Authentication tag (base64) */
  authTag: string
  /** Salt used for HKDF (base64) */
  salt: string
  /** Challenge sent to YubiKey (base64) */
  challenge: string
  /** Encrypted private key (base64) */
  ciphertext: string
  /** YubiKey slot used */
  slot: 1 | 2
  /** YubiKey serial (optional, for verification) */
  serial?: string
}

/**
 * Key provider that encrypts private keys using YubiKey HMAC challenge-response.
 *
 * @remarks
 * This provider uses the YubiKey HMAC-SHA1 challenge-response feature (typically slot 2)
 * to derive an encryption key. The Ed25519 private key is encrypted with AES-256-GCM,
 * and can only be decrypted when the correct YubiKey is present.
 *
 * This approach:
 * - Works with all YubiKeys that support HMAC-SHA1 challenge-response
 * - Preserves Ed25519 compatibility (signing happens in software)
 * - Requires physical YubiKey presence to decrypt and use the key
 *
 * @public
 */
export class YubiKeyProvider implements KeyProvider {
  readonly type = 'yubikey'
  readonly displayName = 'YubiKey'

  private readonly encryptedKeyPath: string
  private readonly slot: 1 | 2
  private readonly serial?: string

  /**
   * Create a new YubiKeyProvider.
   * @param options - Provider options
   */
  constructor(options: YubiKeyProviderOptions) {
    this.encryptedKeyPath = options.encryptedKeyPath
    this.slot = options.slot ?? 2
    if (options.serial !== undefined) {
      this.serial = options.serial
    }
  }

  /**
   * Check if ykman CLI is installed and available.
   * @returns true if ykman is available
   */
  static async isInstalled(): Promise<boolean> {
    try {
      await execCommand('ykman', ['--version'])
      return true
    } catch {
      return false
    }
  }

  /**
   * Check if any YubiKey is connected.
   * @returns true if at least one YubiKey is connected
   */
  static async isConnected(): Promise<boolean> {
    try {
      const output = await execCommand('ykman', ['list', '--serials'])
      return output.trim().length > 0
    } catch {
      return false
    }
  }

  /**
   * Check if HMAC challenge-response is configured on a slot.
   * @param slot - Slot number (1 or 2)
   * @param serial - Optional YubiKey serial number
   * @returns true if challenge-response is configured
   */
  static async isChallengeResponseConfigured(slot: 1 | 2 = 2, serial?: string): Promise<boolean> {
    try {
      const args = ['otp', 'info']
      if (serial) {
        args.unshift('--device', serial)
      }
      const output = await execCommand('ykman', args)
      // Look for "Slot X: programmed (challenge-response)" pattern
      const slotPattern = new RegExp(`Slot ${slot}:\\s+programmed.*challenge-response`, 'i')
      return slotPattern.test(output)
    } catch {
      return false
    }
  }

  /**
   * List connected YubiKeys.
   * @returns Array of YubiKey information
   */
  static async listDevices(): Promise<YubiKeyInfo[]> {
    if (!(await YubiKeyProvider.isInstalled())) {
      return []
    }

    try {
      const output = await execCommand('ykman', ['list', '--serials'])
      const serials = output
        .trim()
        .split('\n')
        .filter((s) => s.length > 0)

      const devices: YubiKeyInfo[] = []
      for (const serial of serials) {
        try {
          const infoOutput = await execCommand('ykman', ['--device', serial, 'info'])
          // Parse device type and firmware from info output
          const typeMatch = /Device type:\s+(.+)/i.exec(infoOutput)
          const fwMatch = /Firmware version:\s+(.+)/i.exec(infoOutput)

          devices.push({
            serial,
            type: typeMatch?.[1]?.trim() ?? 'YubiKey',
            firmware: fwMatch?.[1]?.trim() ?? 'Unknown',
          })
        } catch {
          // If we can't get info, just use the serial
          devices.push({
            serial,
            type: 'YubiKey',
            firmware: 'Unknown',
          })
        }
      }
      return devices
    } catch {
      return []
    }
  }

  /**
   * Check if this provider is available on the current system.
   * Requires ykman to be installed.
   */
  async isAvailable(): Promise<boolean> {
    return YubiKeyProvider.isInstalled()
  }

  /**
   * Check if an encrypted key file exists.
   * @param keyRef - Path to encrypted key file
   */
  async keyExists(keyRef: string): Promise<boolean> {
    try {
      await fs.access(keyRef)
      return true
    } catch {
      return false
    }
  }

  /**
   * Get the private key by decrypting with YubiKey.
   * Downloads to a temporary file and returns a cleanup function.
   * @param keyRef - Path to encrypted key file
   * @throws Error if the key cannot be decrypted
   */
  async getPrivateKey(keyRef: string): Promise<KeyRetrievalResult> {
    // Check if encrypted key file exists
    if (!(await this.keyExists(keyRef))) {
      throw new Error(`Encrypted key file not found: ${keyRef}`)
    }

    // Check if YubiKey is connected
    if (!(await YubiKeyProvider.isConnected())) {
      throw new Error('No YubiKey detected. Please insert your YubiKey and try again.')
    }

    // Read and parse the encrypted key file
    const encryptedData = await fs.readFile(keyRef, 'utf8')
    let keyFile: EncryptedKeyFile
    try {
      keyFile = JSON.parse(encryptedData) as EncryptedKeyFile
    } catch {
      throw new Error(`Invalid encrypted key file format: ${keyRef}`)
    }

    if (keyFile.version !== 1) {
      throw new Error(`Unsupported encrypted key format version: ${String(keyFile.version)}`)
    }

    // Determine which serial to use (provider setting takes precedence, then key file)
    const expectedSerial = this.serial ?? keyFile.serial

    // Verify YubiKey serial if specified
    if (expectedSerial) {
      const devices = await YubiKeyProvider.listDevices()
      const matchingDevice = devices.find((d) => d.serial === expectedSerial)
      if (!matchingDevice) {
        throw new Error(
          `YubiKey with serial ${expectedSerial} not found. ` +
            `Connected devices: ${devices.map((d) => d.serial).join(', ') || 'none'}`,
        )
      }
    }

    // Perform challenge-response to get the decryption key
    const challenge = Buffer.from(keyFile.challenge, 'base64')
    const response = await performChallengeResponse(challenge, keyFile.slot, expectedSerial)

    // Derive AES-256 key from response using HKDF
    const salt = Buffer.from(keyFile.salt, 'base64')
    const aesKey = deriveKey(response, salt)

    // Decrypt the private key
    const iv = Buffer.from(keyFile.iv, 'base64')
    const authTag = Buffer.from(keyFile.authTag, 'base64')
    const ciphertext = Buffer.from(keyFile.ciphertext, 'base64')

    let privateKeyContent: string
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, iv)
      decipher.setAuthTag(authTag)
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
      privateKeyContent = decrypted.toString('utf8')
    } catch (err) {
      throw new Error(
        'Failed to decrypt private key. Wrong YubiKey or corrupted key file. ' +
          `Details: ${err instanceof Error ? err.message : String(err)}`,
      )
    }

    // Create a temporary file
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'attest-it-'))
    const tempKeyPath = path.join(tempDir, 'private.pem')

    try {
      // Write decrypted key to temp file
      await fs.writeFile(tempKeyPath, privateKeyContent, { mode: 0o600 })
      await setKeyPermissions(tempKeyPath)

      return {
        keyPath: tempKeyPath,
        cleanup: async () => {
          // Securely delete the temporary file and directory
          try {
            // Overwrite with random data before deleting
            const keySize = Buffer.byteLength(privateKeyContent)
            await fs.writeFile(tempKeyPath, crypto.randomBytes(keySize))
            await fs.unlink(tempKeyPath)
            await fs.rmdir(tempDir)
          } catch (cleanupError) {
            console.warn(
              `Warning: Failed to clean up temporary key file at ${tempKeyPath}: ` +
                `${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
            )
          }
        },
      }
    } catch (error) {
      // Clean up temp directory on error
      try {
        await fs.rm(tempDir, { recursive: true, force: true })
      } catch (cleanupError) {
        console.warn(
          `Warning: Failed to clean up temporary key directory at ${tempDir}: ` +
            `${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
        )
      }
      throw error
    }
  }

  /**
   * Generate a new keypair and store encrypted with YubiKey.
   * Public key is written to filesystem for repository commit.
   * @param options - Key generation options
   */
  async generateKeyPair(options: KeygenProviderOptions): Promise<KeyGenerationResult> {
    const { publicKeyPath, force = false } = options

    // Check if YubiKey is connected
    if (!(await YubiKeyProvider.isConnected())) {
      throw new Error('No YubiKey detected. Please insert your YubiKey and try again.')
    }

    // Check if challenge-response is configured
    if (!(await YubiKeyProvider.isChallengeResponseConfigured(this.slot, this.serial))) {
      throw new Error(
        `YubiKey slot ${this.slot} is not configured for HMAC challenge-response. ` +
          'Use "ykman otp chalresp --generate 2" to configure it.',
      )
    }

    // Check if encrypted key file already exists
    if (!force && (await this.keyExists(this.encryptedKeyPath))) {
      throw new Error(
        `Encrypted key file already exists: ${this.encryptedKeyPath}. Use force: true to overwrite.`,
      )
    }

    // Get YubiKey serial for the encrypted file
    let serial: string | undefined
    if (this.serial) {
      serial = this.serial
    } else {
      const devices = await YubiKeyProvider.listDevices()
      if (devices.length === 1 && devices[0]) {
        serial = devices[0].serial
      }
    }

    // Create a temporary directory for key generation
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'attest-it-keygen-'))
    const tempPrivateKeyPath = path.join(tempDir, 'private.pem')

    try {
      // Generate the keypair to temporary location
      await cryptoGenerateKeyPair({
        privatePath: tempPrivateKeyPath,
        publicPath: publicKeyPath,
        force,
      })

      // Read the private key
      const privateKeyContent = await fs.readFile(tempPrivateKeyPath, 'utf8')

      // Generate random challenge and salt
      const challenge = crypto.randomBytes(32)
      const salt = crypto.randomBytes(32)
      const iv = crypto.randomBytes(12) // 96 bits for GCM

      // Perform challenge-response
      const response = await performChallengeResponse(challenge, this.slot, this.serial)

      // Derive AES-256 key from response using HKDF
      const aesKey = deriveKey(response, salt)

      // Encrypt the private key with AES-256-GCM
      const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv)
      const ciphertext = Buffer.concat([
        cipher.update(Buffer.from(privateKeyContent, 'utf8')),
        cipher.final(),
      ])
      const authTag = cipher.getAuthTag()

      // Create the encrypted key file
      const keyFile: EncryptedKeyFile = {
        version: 1,
        iv: iv.toString('base64'),
        authTag: authTag.toString('base64'),
        salt: salt.toString('base64'),
        challenge: challenge.toString('base64'),
        ciphertext: ciphertext.toString('base64'),
        slot: this.slot,
        ...(serial && { serial }),
      }

      // Ensure parent directory exists
      await fs.mkdir(path.dirname(this.encryptedKeyPath), { recursive: true })

      // Write the encrypted key file
      await fs.writeFile(this.encryptedKeyPath, JSON.stringify(keyFile, null, 2), { mode: 0o600 })
      await setKeyPermissions(this.encryptedKeyPath)

      // Clean up temporary private key (overwrite before delete)
      const keySize = Buffer.byteLength(privateKeyContent)
      await fs.writeFile(tempPrivateKeyPath, crypto.randomBytes(keySize))
      await fs.unlink(tempPrivateKeyPath)
      await fs.rmdir(tempDir)

      return {
        privateKeyRef: this.encryptedKeyPath,
        publicKeyPath,
        storageDescription: `YubiKey-encrypted: ${this.encryptedKeyPath}`,
      }
    } catch (error) {
      // Clean up on error
      try {
        await fs.rm(tempDir, { recursive: true, force: true })
      } catch (cleanupError) {
        console.warn(
          `Warning: Failed to clean up temporary key directory at ${tempDir}: ` +
            `${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
        )
      }
      throw error
    }
  }

/**
   * Encrypt an existing private key with YubiKey challenge-response.
   *
   * @remarks
   * This static method allows encrypting a private key that was generated
   * elsewhere (e.g., by the CLI) without having to create a provider instance first.
   *
   * @param options - Encryption options
   * @returns Path to the encrypted key file and storage description
   * @public
   */
  static async encryptPrivateKey(options: {
    /** The private key content (PEM format) */
    privateKey: string
    /** Path where the encrypted key file will be saved */
    encryptedKeyPath: string
    /** YubiKey slot to use (default: 2) */
    slot?: 1 | 2
    /** Optional YubiKey serial number */
    serial?: string
  }): Promise<{ encryptedKeyPath: string; storageDescription: string }> {
    const { privateKey, encryptedKeyPath, slot = 2, serial } = options

    // Check if YubiKey is connected
    if (!(await YubiKeyProvider.isConnected())) {
      throw new Error('No YubiKey detected. Please insert your YubiKey and try again.')
    }

    // Check if challenge-response is configured
    if (!(await YubiKeyProvider.isChallengeResponseConfigured(slot, serial))) {
      throw new Error(
        `YubiKey slot ${slot} is not configured for HMAC challenge-response. ` +
          'Use "ykman otp chalresp --generate 2" to configure it.',
      )
    }

    // Generate random challenge, salt, and IV
    const challenge = crypto.randomBytes(32)
    const salt = crypto.randomBytes(32)
    const iv = crypto.randomBytes(12) // 96 bits for GCM

    // Perform challenge-response
    const response = await performChallengeResponse(challenge, slot, serial)

    // Derive AES-256 key from response using HKDF
    const aesKey = deriveKey(response, salt)

    // Encrypt the private key with AES-256-GCM
    const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv)
    const ciphertext = Buffer.concat([cipher.update(Buffer.from(privateKey, 'utf8')), cipher.final()])
    const authTag = cipher.getAuthTag()

    // Create the encrypted key file
    const keyFile: EncryptedKeyFile = {
      version: 1,
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      salt: salt.toString('base64'),
      challenge: challenge.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      slot,
      ...(serial && { serial }),
    }

    // Ensure parent directory exists
    await fs.mkdir(path.dirname(encryptedKeyPath), { recursive: true })

    // Write the encrypted key file
    await fs.writeFile(encryptedKeyPath, JSON.stringify(keyFile, null, 2), { mode: 0o600 })
    await setKeyPermissions(encryptedKeyPath)

    return {
      encryptedKeyPath,
      storageDescription: `YubiKey-encrypted: ${encryptedKeyPath}`,
    }
  }

  /**
   * Get the configuration for this provider.
   */
  getConfig(): KeyProviderConfig {
    return {
      type: this.type,
      options: {
        encryptedKeyPath: this.encryptedKeyPath,
        slot: this.slot,
        ...(this.serial && { serial: this.serial }),
      },
    }
  }
}

/**
 * Execute a command and return stdout.
 * @internal
 */
async function execCommand(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim())
      } else {
        reject(new Error(`Command failed with exit code ${String(code)}: ${stderr}`))
      }
    })

    proc.on('error', (error) => {
      reject(error)
    })
  })
}

/**
 * Perform HMAC-SHA1 challenge-response with YubiKey.
 * @param challenge - Challenge bytes to send
 * @param slot - YubiKey slot (1 or 2)
 * @param serial - Optional YubiKey serial number
 * @returns Response from YubiKey (20 bytes for HMAC-SHA1)
 * @internal
 */
async function performChallengeResponse(
  challenge: Buffer,
  slot: 1 | 2,
  serial?: string,
): Promise<Buffer> {
  const args = ['otp', 'chalresp', '--slot', String(slot)]
  if (serial) {
    args.unshift('--device', serial)
  }
  args.push(challenge.toString('hex'))

  try {
    const output = await execCommand('ykman', args)
    // Response is hex-encoded
    return Buffer.from(output.trim(), 'hex')
  } catch (err) {
    throw new Error(
      `YubiKey challenge-response failed: ${err instanceof Error ? err.message : String(err)}. ` +
        'Make sure your YubiKey is inserted and slot is configured for challenge-response.',
    )
  }
}

/**
 * Derive an AES-256 key from the challenge-response using HKDF.
 * @param response - Challenge-response output from YubiKey
 * @param salt - Random salt for HKDF
 * @returns 32-byte AES-256 key
 * @internal
 */
function deriveKey(response: Buffer, salt: Buffer): Buffer {
  // Use HKDF to derive a 256-bit key
  // hkdfSync returns ArrayBuffer, convert to Buffer
  const derived = crypto.hkdfSync('sha256', response, salt, 'attest-it-yubikey-v1', 32)
  return Buffer.from(derived)
}
