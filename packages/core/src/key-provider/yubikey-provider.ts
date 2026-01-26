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
 * **Security Note**: Private keys are temporarily held in memory as JavaScript
 * strings during encryption/decryption. JavaScript strings are immutable and
 * cannot be securely zeroed. The key remains in memory until garbage collected.
 * For maximum security, use full-disk encryption and disable swap on systems
 * handling sensitive keys.
 *
 * @packageDocumentation
 */

import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { z } from 'zod'
import { generateKeyPair as ed25519GenerateKeyPair } from '../crypto/ed25519.js'
import { setKeyPermissions } from '../crypto.js'
import { getIdentityConfigDir } from '../identity/config.js'
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
  /** Serial number of specific YubiKey to use (optional but recommended) */
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
 * Zod schema for validating encrypted key file structure.
 * @internal
 */
const EncryptedKeyFileSchema = z.object({
  version: z.literal(1),
  iv: z.string().min(1),
  authTag: z.string().min(1),
  salt: z.string().min(1),
  challenge: z.string().min(1),
  ciphertext: z.string().min(1),
  slot: z.union([z.literal(1), z.literal(2)]),
  serial: z.string().optional(),
  aad: z.string().optional(),
})

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
  /** YubiKey serial (for device verification) */
  serial?: string | undefined
  /** Additional authenticated data (base64) - binds metadata to ciphertext */
  aad?: string | undefined
}

/**
 * Track active cleanup handlers for process exit.
 * @internal
 */
const activeCleanupHandlers = new Set<() => Promise<void>>()
let processHandlersInstalled = false

/**
 * Install process exit handlers to ensure cleanup on unexpected termination.
 * @internal
 */
function installProcessHandlers(): void {
  if (processHandlersInstalled) return
  processHandlersInstalled = true

  const runCleanup = async () => {
    const handlers = Array.from(activeCleanupHandlers)
    await Promise.allSettled(handlers.map((h) => h()))
  }

  // Handle graceful shutdown
  process.once('beforeExit', () => {
    void runCleanup()
  })

  // Handle SIGINT (Ctrl+C)
  process.once('SIGINT', () => {
    void runCleanup().finally(() => process.exit(130))
  })

  // Handle SIGTERM
  process.once('SIGTERM', () => {
    void runCleanup().finally(() => process.exit(143))
  })
}

/**
 * Validate encrypted key file structure and buffer sizes.
 * @param data - Parsed JSON data
 * @returns Validated EncryptedKeyFile
 * @throws Error if validation fails
 * @internal
 */
function validateEncryptedKeyFile(data: unknown): EncryptedKeyFile {
  // Schema validation
  const parsed = EncryptedKeyFileSchema.parse(data)

  // Validate decoded buffer sizes
  const iv = Buffer.from(parsed.iv, 'base64')
  if (iv.length !== 12) {
    throw new Error(`Invalid IV size: expected 12 bytes, got ${String(iv.length)}`)
  }

  const authTag = Buffer.from(parsed.authTag, 'base64')
  if (authTag.length !== 16) {
    throw new Error(`Invalid auth tag size: expected 16 bytes, got ${String(authTag.length)}`)
  }

  const salt = Buffer.from(parsed.salt, 'base64')
  if (salt.length !== 32) {
    throw new Error(`Invalid salt size: expected 32 bytes, got ${String(salt.length)}`)
  }

  const challenge = Buffer.from(parsed.challenge, 'base64')
  if (challenge.length !== 32) {
    throw new Error(`Invalid challenge size: expected 32 bytes, got ${String(challenge.length)}`)
  }

  return parsed
}

/**
 * Construct Additional Authenticated Data (AAD) for GCM encryption.
 * This binds the metadata to the ciphertext, preventing tampering.
 * @internal
 */
function constructAAD(version: number, slot: 1 | 2, serial: string | undefined): Buffer {
  const aadObject = {
    version,
    slot,
    serial: serial ?? 'unspecified',
  }
  return Buffer.from(JSON.stringify(aadObject), 'utf8')
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
 * **Security Note**: Always use the `serial` option to bind keys to a specific YubiKey.
 * Without serial verification, any YubiKey with the same HMAC secret could decrypt the key.
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
   * @throws Error if encryptedKeyPath is outside the attest-it config directory
   */
  constructor(options: YubiKeyProviderOptions) {
    // Validate and normalize the encrypted key path
    const resolvedPath = path.resolve(options.encryptedKeyPath)
    const configDir = getIdentityConfigDir()

    // Security: Ensure path is within the config directory to prevent path traversal
    if (!resolvedPath.startsWith(configDir)) {
      throw new Error(
        `Encrypted key path must be within attest-it config directory (${configDir}). ` +
          `Got: ${resolvedPath}`,
      )
    }

    this.encryptedKeyPath = resolvedPath
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
      // Actually test challenge-response instead of parsing output text.
      // This is more reliable across different ykman versions.
      // Uses 'ykman otp calculate -t' to perform the challenge-response with touch required.
      const testChallenge = Buffer.from('attest-it-test-challenge-12345')
      const args = ['otp', 'calculate', '-t', String(slot), testChallenge.toString('hex')]
      if (serial) {
        args.unshift('--device', serial)
      }
      await execCommand('ykman', args)
      return true
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
   *
   * **Important**: Always call the cleanup function when done to securely delete
   * the temporary key file. The cleanup is also registered for process exit handlers.
   *
   * @param keyRef - Path to encrypted key file
   * @throws Error if the key cannot be decrypted
   */
  async getPrivateKey(keyRef: string): Promise<KeyRetrievalResult> {
    // Install process handlers for cleanup on unexpected exit
    installProcessHandlers()

    // Check if encrypted key file exists
    if (!(await this.keyExists(keyRef))) {
      throw new Error(`Encrypted key file not found: ${keyRef}`)
    }

    // Read and parse the encrypted key file with validation
    const encryptedData = await fs.readFile(keyRef, 'utf8')
    let keyFile: EncryptedKeyFile
    try {
      const parsed: unknown = JSON.parse(encryptedData)
      keyFile = validateEncryptedKeyFile(parsed)
    } catch (err) {
      if (err instanceof z.ZodError) {
        throw new Error(
          `Invalid encrypted key file format: ${err.errors.map((e) => e.message).join(', ')}`,
        )
      }
      throw new Error(`Invalid encrypted key file: malformed JSON or structure`)
    }

    // Determine which serial to use (provider setting takes precedence, then key file)
    const expectedSerial = this.serial ?? keyFile.serial

    // Security warning if no serial verification
    if (!expectedSerial) {
      console.warn(
        'WARNING: No YubiKey serial number specified for key verification. ' +
          'Any YubiKey with the correct HMAC secret could decrypt this key. ' +
          'For better security, re-encrypt the key with a serial number specified.',
      )
    }

    // Verify YubiKey serial if specified
    if (expectedSerial) {
      const devices = await YubiKeyProvider.listDevices()
      const matchingDevice = devices.find((d) => d.serial === expectedSerial)
      if (!matchingDevice) {
        throw new Error(
          `Required YubiKey not found. Expected serial: ${expectedSerial}. ` +
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

      // Set AAD if present (for files created with AAD support)
      if (keyFile.aad) {
        decipher.setAAD(Buffer.from(keyFile.aad, 'base64'))
      }

      decipher.setAuthTag(authTag)
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
      privateKeyContent = decrypted.toString('utf8')
    } catch {
      // Sanitized error message - don't leak crypto details
      throw new Error(
        'Failed to decrypt private key. Verify you are using the correct YubiKey ' +
          'and the encrypted key file has not been corrupted or tampered with.',
      )
    }

    // Create a temporary file
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'attest-it-'))
    const tempKeyPath = path.join(tempDir, 'private.pem')

    // Create cleanup function with tracking
    const cleanup = async () => {
      activeCleanupHandlers.delete(cleanup)
      try {
        // Overwrite with random data before deleting (defense in depth)
        const keySize = Buffer.byteLength(privateKeyContent)
        await fs.writeFile(tempKeyPath, crypto.randomBytes(keySize))
        await fs.unlink(tempKeyPath)
        await fs.rmdir(tempDir)
      } catch {
        // Silently ignore cleanup errors - file may already be deleted
      }
    }

    try {
      // Write decrypted key to temp file
      await fs.writeFile(tempKeyPath, privateKeyContent, { mode: 0o600 })
      await setKeyPermissions(tempKeyPath)

      // Register cleanup for process exit
      activeCleanupHandlers.add(cleanup)

      return {
        keyPath: tempKeyPath,
        cleanup,
      }
    } catch (error) {
      // Clean up temp directory on error
      await cleanup()
      throw error
    }
  }

  /**
   * Generate a new keypair and store encrypted with YubiKey.
   * Public key is written to filesystem for repository commit.
   *
   * **Security Note**: Always specify a serial number to bind the key to a specific YubiKey.
   *
   * @param options - Key generation options
   */
  async generateKeyPair(options: KeygenProviderOptions): Promise<KeyGenerationResult> {
    const { publicKeyPath, force = false } = options

    // Check if challenge-response is configured (this also verifies YubiKey is connected)
    if (!(await YubiKeyProvider.isChallengeResponseConfigured(this.slot, this.serial))) {
      throw new Error(
        `YubiKey slot ${String(this.slot)} is not configured for HMAC challenge-response. ` +
          'Ensure your YubiKey is connected and use "ykman otp chalresp --generate 2" to configure it.',
      )
    }

    // Check if encrypted key file already exists
    if (!force && (await this.keyExists(this.encryptedKeyPath))) {
      throw new Error(
        `Encrypted key file already exists: ${this.encryptedKeyPath}. Use force: true to overwrite.`,
      )
    }

    // Get YubiKey serial for the encrypted file (required for security)
    let serial: string | undefined
    if (this.serial) {
      serial = this.serial
    } else {
      const devices = await YubiKeyProvider.listDevices()
      if (devices.length === 1 && devices[0]) {
        serial = devices[0].serial
      } else if (devices.length > 1) {
        console.warn(
          'WARNING: Multiple YubiKeys detected but no serial specified. ' +
            'Key will not be bound to a specific device. ' +
            'For better security, specify a serial number.',
        )
      }
    }

    try {
      // Generate Ed25519 keypair using Node.js crypto (in memory)
      const { publicKey: publicKeyBase64, privateKey: privateKeyPem } = ed25519GenerateKeyPair()

      // Ensure parent directory exists for public key
      const publicKeyDir = path.dirname(publicKeyPath)
      await fs.mkdir(publicKeyDir, { recursive: true })

      // Write public key as PEM file
      const publicKeyPemFile = `-----BEGIN PUBLIC KEY-----\n${publicKeyBase64}\n-----END PUBLIC KEY-----\n`
      await fs.writeFile(publicKeyPath, publicKeyPemFile, { mode: 0o644 })

      // The private key content in PEM format
      const privateKeyContent = privateKeyPem

      // Generate random challenge and salt
      const challenge = crypto.randomBytes(32)
      const salt = crypto.randomBytes(32)
      const iv = crypto.randomBytes(12) // 96 bits for GCM

      // Perform challenge-response
      const response = await performChallengeResponse(challenge, this.slot, this.serial)

      // Derive AES-256 key from response using HKDF
      const aesKey = deriveKey(response, salt)

      // Construct AAD to bind metadata to ciphertext
      const aad = constructAAD(1, this.slot, serial)

      // Encrypt the private key with AES-256-GCM
      const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv)
      cipher.setAAD(aad)
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
        aad: aad.toString('base64'),
        ...(serial && { serial }),
      }

      // Ensure parent directory exists
      await fs.mkdir(path.dirname(this.encryptedKeyPath), { recursive: true })

      // Write the encrypted key file
      await fs.writeFile(this.encryptedKeyPath, JSON.stringify(keyFile, null, 2), { mode: 0o600 })
      await setKeyPermissions(this.encryptedKeyPath)

      // Note: Private key was generated in memory, no temp file cleanup needed

      return {
        privateKeyRef: this.encryptedKeyPath,
        publicKeyPath,
        storageDescription: `YubiKey-encrypted: ${this.encryptedKeyPath}`,
      }
    } catch (error) {
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
   * **Security Note**: Always specify a serial number to bind the key to a specific YubiKey.
   * The serial provides defense-in-depth by ensuring only the intended YubiKey can decrypt.
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
    /** YubiKey serial number (recommended for security) */
    serial?: string
  }): Promise<{ encryptedKeyPath: string; storageDescription: string }> {
    const { privateKey, encryptedKeyPath, slot = 2, serial } = options

    // Validate path is within config directory
    const resolvedPath = path.resolve(encryptedKeyPath)
    const configDir = getIdentityConfigDir()
    if (!resolvedPath.startsWith(configDir)) {
      throw new Error(
        `Encrypted key path must be within attest-it config directory (${configDir}). ` +
          `Got: ${resolvedPath}`,
      )
    }

    // Security warning if no serial specified
    if (!serial) {
      console.warn(
        'WARNING: No YubiKey serial number specified. ' +
          'Key will not be bound to a specific device. ' +
          'For better security, specify a serial number.',
      )
    }

    // Check if challenge-response is configured (this also verifies YubiKey is connected)
    if (!(await YubiKeyProvider.isChallengeResponseConfigured(slot, serial))) {
      throw new Error(
        `YubiKey slot ${String(slot)} is not configured for HMAC challenge-response. ` +
          'Ensure your YubiKey is connected and use "ykman otp chalresp --generate 2" to configure it.',
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

    // Construct AAD to bind metadata to ciphertext
    const aad = constructAAD(1, slot, serial)

    // Encrypt the private key with AES-256-GCM
    const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv)
    cipher.setAAD(aad)
    const ciphertext = Buffer.concat([
      cipher.update(Buffer.from(privateKey, 'utf8')),
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
      slot,
      aad: aad.toString('base64'),
      ...(serial && { serial }),
    }

    // Ensure parent directory exists
    await fs.mkdir(path.dirname(resolvedPath), { recursive: true })

    // Write the encrypted key file
    await fs.writeFile(resolvedPath, JSON.stringify(keyFile, null, 2), { mode: 0o600 })
    await setKeyPermissions(resolvedPath)

    return {
      encryptedKeyPath: resolvedPath,
      storageDescription: `YubiKey-encrypted: ${resolvedPath}`,
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
  // Use 'ykman otp calculate -t' to perform challenge-response with touch required.
  // The -t flag ensures that a human must physically touch the YubiKey to complete
  // the operation, preventing automated/agent-initiated signing.
  const args = ['otp', 'calculate', '-t', String(slot), challenge.toString('hex')]
  if (serial) {
    args.unshift('--device', serial)
  }

  try {
    const output = await execCommand('ykman', args)
    // Response is hex-encoded
    return Buffer.from(output.trim(), 'hex')
  } catch {
    // Sanitized error - don't leak command details
    throw new Error(
      'YubiKey challenge-response failed. ' +
        'Verify your YubiKey is inserted, touch it when prompted, ' +
        'and ensure the slot is configured for challenge-response.',
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
