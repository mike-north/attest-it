/**
 * Passphrase-protected key provider implementation.
 *
 * @remarks
 * This provider stores private keys encrypted with a user-provided passphrase.
 * Each time the key is needed for signing, the user must enter their passphrase
 * to decrypt the key. Uses scrypt for key derivation and AES-256-GCM for encryption.
 *
 * @packageDocumentation
 */

import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import * as readline from 'node:readline'
import { generateKeyPair as cryptoGenerateKeyPair, setKeyPermissions } from '../crypto.js'
import type {
  KeyProvider,
  KeyProviderConfig,
  KeyRetrievalResult,
  KeyGenerationResult,
  KeygenProviderOptions,
} from './types.js'

/**
 * Options for creating a PassphraseKeyProvider.
 * @public
 */
export interface PassphraseKeyProviderOptions {
  /** Path to the encrypted key file */
  encryptedKeyPath: string
  /**
   * Function to prompt user for passphrase.
   * If not provided, uses stdin prompt.
   */
  promptPassphrase?: (message: string) => Promise<string>
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
  /** Salt used for PBKDF2 key derivation (base64) */
  salt: string
  /** Encrypted private key (base64) */
  ciphertext: string
  /** PBKDF2 iterations */
  iterations: number
}

/**
 * Default PBKDF2 iterations - balances security and performance.
 * @internal
 */
const DEFAULT_PBKDF2_ITERATIONS = 100000

/**
 * Key provider that encrypts private keys with a user passphrase.
 *
 * @remarks
 * This provider uses PBKDF2 for key derivation and AES-256-GCM for
 * authenticated encryption. Each signing operation requires the user
 * to enter their passphrase.
 *
 * Security features:
 * - PBKDF2-SHA256 key derivation (100,000 iterations)
 * - Random 256-bit salt per key
 * - AES-256-GCM authenticated encryption
 * - Temporary decrypted key is securely deleted after use
 *
 * @public
 */
export class PassphraseKeyProvider implements KeyProvider {
  readonly type = 'passphrase'
  readonly displayName = 'Passphrase-protected'

  private readonly encryptedKeyPath: string
  private readonly promptPassphrase: (message: string) => Promise<string>

  /**
   * Create a new PassphraseKeyProvider.
   * @param options - Provider options
   */
  constructor(options: PassphraseKeyProviderOptions) {
    this.encryptedKeyPath = options.encryptedKeyPath
    this.promptPassphrase = options.promptPassphrase ?? defaultPromptPassphrase
  }

  /**
   * Check if this provider is available.
   * Always available since it only requires Node.js crypto.
   */
  static isAvailable(): boolean {
    return true
  }

  /**
   * Check if this provider is available on the current system.
   */
  isAvailable(): Promise<boolean> {
    return Promise.resolve(PassphraseKeyProvider.isAvailable())
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
   * Get the private key by decrypting with user passphrase.
   * Downloads to a temporary file and returns a cleanup function.
   * @param keyRef - Path to encrypted key file
   * @throws Error if the key cannot be decrypted
   */
  async getPrivateKey(keyRef: string): Promise<KeyRetrievalResult> {
    // Check if encrypted key file exists
    if (!(await this.keyExists(keyRef))) {
      throw new Error(`Encrypted key file not found: ${keyRef}`)
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

    // Prompt user for passphrase
    const passphrase = await this.promptPassphrase('Enter passphrase to unlock signing key: ')

    if (!passphrase) {
      throw new Error('Passphrase is required to decrypt the key')
    }

    // Derive key from passphrase using PBKDF2
    const salt = Buffer.from(keyFile.salt, 'base64')
    const iterations = keyFile.iterations
    const derivedKey = await deriveKey(passphrase, salt, iterations)

    // Decrypt the private key
    const iv = Buffer.from(keyFile.iv, 'base64')
    const authTag = Buffer.from(keyFile.authTag, 'base64')
    const ciphertext = Buffer.from(keyFile.ciphertext, 'base64')

    let privateKeyContent: string
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', derivedKey, iv)
      decipher.setAuthTag(authTag)
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
      privateKeyContent = decrypted.toString('utf8')
    } catch (err) {
      throw new Error(
        'Failed to decrypt private key. Incorrect passphrase or corrupted key file. ' +
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
   * Generate a new keypair and store encrypted with passphrase.
   * Public key is written to filesystem for repository commit.
   * @param options - Key generation options
   */
  async generateKeyPair(options: KeygenProviderOptions): Promise<KeyGenerationResult> {
    const { publicKeyPath, force = false } = options

    // Check if encrypted key file already exists
    if (!force && (await this.keyExists(this.encryptedKeyPath))) {
      throw new Error(
        `Encrypted key file already exists: ${this.encryptedKeyPath}. Use force: true to overwrite.`,
      )
    }

    // Prompt for passphrase (twice for confirmation)
    const passphrase = await this.promptPassphrase('Enter passphrase for new signing key: ')

    if (!passphrase) {
      throw new Error('Passphrase is required')
    }

    if (passphrase.length < 8) {
      throw new Error('Passphrase must be at least 8 characters long')
    }

    const confirmPassphrase = await this.promptPassphrase('Confirm passphrase: ')

    if (passphrase !== confirmPassphrase) {
      throw new Error('Passphrases do not match')
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

      // Generate random salt and IV
      const salt = crypto.randomBytes(32)
      const iv = crypto.randomBytes(12) // 96 bits for GCM

      // Derive key from passphrase using PBKDF2
      const iterations = DEFAULT_PBKDF2_ITERATIONS
      const derivedKey = await deriveKey(passphrase, salt, iterations)

      // Encrypt the private key with AES-256-GCM
      const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey, iv)
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
        ciphertext: ciphertext.toString('base64'),
        iterations,
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
        storageDescription: `Passphrase-protected: ${this.encryptedKeyPath}`,
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
   * Get the configuration for this provider.
   */
  getConfig(): KeyProviderConfig {
    return {
      type: this.type,
      options: {
        encryptedKeyPath: this.encryptedKeyPath,
      },
    }
  }
}

/**
 * Derive an AES-256 key from passphrase using PBKDF2.
 * @param passphrase - User passphrase
 * @param salt - Random salt
 * @param iterations - Number of PBKDF2 iterations
 * @returns 32-byte AES-256 key
 * @internal
 */
async function deriveKey(
  passphrase: string,
  salt: Buffer,
  iterations: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(passphrase, salt, iterations, 32, 'sha256', (err, derivedKey) => {
      if (err) {
        reject(new Error(`Key derivation failed: ${err.message}`))
      } else {
        resolve(derivedKey)
      }
    })
  })
}

/**
 * Default passphrase prompt using readline.
 * Hides input from terminal.
 * @param message - Prompt message
 * @returns User input
 * @internal
 */
async function defaultPromptPassphrase(message: string): Promise<string> {
  // Check if we're in an interactive terminal
  if (!process.stdin.isTTY) {
    throw new Error(
      'Cannot prompt for passphrase: not running in an interactive terminal. ' +
        'Use a custom promptPassphrase function or run in a terminal.',
    )
  }

  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    })

    // Hide input by disabling echo
    const stdin = process.stdin
    const wasRaw = stdin.isRaw
    if (stdin.setRawMode) {
      stdin.setRawMode(true)
    }

    let input = ''

    process.stdout.write(message)

    const onData = (char: Buffer): void => {
      const charStr = char.toString('utf8')

      if (charStr === '\n' || charStr === '\r' || charStr === '\u0004') {
        // Enter or Ctrl+D - done
        stdin.removeListener('data', onData)
        if (stdin.setRawMode) {
          stdin.setRawMode(wasRaw ?? false)
        }
        process.stdout.write('\n')
        rl.close()
        resolve(input)
      } else if (charStr === '\u0003') {
        // Ctrl+C - cancel
        stdin.removeListener('data', onData)
        if (stdin.setRawMode) {
          stdin.setRawMode(wasRaw ?? false)
        }
        process.stdout.write('\n')
        rl.close()
        reject(new Error('Passphrase entry cancelled'))
      } else if (charStr === '\u007F' || charStr === '\b') {
        // Backspace
        if (input.length > 0) {
          input = input.slice(0, -1)
        }
      } else if (charStr.charCodeAt(0) >= 32) {
        // Regular character
        input += charStr
      }
    }

    stdin.on('data', onData)
  })
}

/**
 * Encrypt a private key with a passphrase.
 * Utility function for programmatic key encryption.
 * @param privateKeyContent - PEM-encoded private key content
 * @param passphrase - User passphrase
 * @returns Encrypted key file content as JSON string
 * @public
 */
export async function encryptPrivateKeyWithPassphrase(
  privateKeyContent: string,
  passphrase: string,
): Promise<string> {
  if (passphrase.length < 8) {
    throw new Error('Passphrase must be at least 8 characters long')
  }

  // Generate random salt and IV
  const salt = crypto.randomBytes(32)
  const iv = crypto.randomBytes(12)

  // Derive key from passphrase using PBKDF2
  const iterations = DEFAULT_PBKDF2_ITERATIONS
  const derivedKey = await deriveKey(passphrase, salt, iterations)

  // Encrypt the private key with AES-256-GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey, iv)
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
    ciphertext: ciphertext.toString('base64'),
    iterations,
  }

  return JSON.stringify(keyFile, null, 2)
}

/**
 * Decrypt a private key with a passphrase.
 * Utility function for programmatic key decryption.
 * @param encryptedKeyContent - JSON content of encrypted key file
 * @param passphrase - User passphrase
 * @returns PEM-encoded private key content
 * @public
 */
export async function decryptPrivateKeyWithPassphrase(
  encryptedKeyContent: string,
  passphrase: string,
): Promise<string> {
  let keyFile: EncryptedKeyFile
  try {
    keyFile = JSON.parse(encryptedKeyContent) as EncryptedKeyFile
  } catch {
    throw new Error('Invalid encrypted key file format')
  }

  if (keyFile.version !== 1) {
    throw new Error(`Unsupported encrypted key format version: ${String(keyFile.version)}`)
  }

  // Derive key from passphrase using PBKDF2
  const salt = Buffer.from(keyFile.salt, 'base64')
  const iterations = keyFile.iterations
  const derivedKey = await deriveKey(passphrase, salt, iterations)

  // Decrypt the private key
  const iv = Buffer.from(keyFile.iv, 'base64')
  const authTag = Buffer.from(keyFile.authTag, 'base64')
  const ciphertext = Buffer.from(keyFile.ciphertext, 'base64')

  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', derivedKey, iv)
    decipher.setAuthTag(authTag)
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    return decrypted.toString('utf8')
  } catch (err) {
    throw new Error(
      'Failed to decrypt private key. Incorrect passphrase or corrupted key file. ' +
        `Details: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}
