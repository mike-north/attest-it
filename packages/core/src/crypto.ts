/**
 * Cryptographic utilities for key generation, signing, and verification.
 *
 * @remarks
 * This module provides cryptographic operations using OpenSSL for key management
 * and signature verification. It uses RSA-2048 with SHA-256 for signatures,
 * which is universally supported across all OpenSSL and LibreSSL versions.
 *
 * @packageDocumentation
 */

import { spawn } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'

/**
 * Paths to a generated keypair.
 * @public
 */
export interface KeyPaths {
  /** Path to the private key file */
  privatePath: string
  /** Path to the public key file */
  publicPath: string
}

/**
 * Options for key generation.
 * @public
 */
export interface KeygenOptions {
  /** Path for private key (default: OS-specific config dir) */
  privatePath?: string
  /** Path for public key (default: repo root) */
  publicPath?: string
  /** Overwrite existing keys (default: false) */
  force?: boolean
}

/**
 * Options for signing data.
 * @public
 */
export interface SignOptions {
  /** Path to the private key file (legacy) */
  privateKeyPath?: string
  /** Key provider to use for retrieving the private key */
  keyProvider?: import('./key-provider/types.js').KeyProvider
  /** Key reference for the provider */
  keyRef?: string
  /** Data to sign (string or Buffer) */
  data: string | Buffer
}

/**
 * Options for verifying signatures.
 * @public
 */
export interface VerifyOptions {
  /** Path to the public key file */
  publicKeyPath: string
  /** Original data that was signed */
  data: string | Buffer
  /** Base64-encoded signature to verify */
  signature: string
}

/**
 * Result from spawning an OpenSSL process.
 * @internal
 */
interface SpawnResult {
  /** Process exit code */
  exitCode: number
  /** Standard output as Buffer */
  stdout: Buffer
  /** Standard error as string */
  stderr: string
}

/**
 * Run OpenSSL with the given arguments.
 * @param args - Command-line arguments for OpenSSL
 * @param stdin - Optional data to write to stdin
 * @returns Process result with exit code and outputs
 * @internal
 */
async function runOpenSSL(args: string[], stdin?: Buffer): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('openssl', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const stdoutChunks: Buffer[] = []
    let stderr = ''

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk)
    })

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    child.on('error', (err) => {
      reject(new Error(`Failed to spawn OpenSSL: ${err.message}`))
    })

    child.on('close', (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdoutChunks),
        stderr,
      })
    })

    if (stdin) {
      child.stdin.write(stdin)
    }
    child.stdin.end()
  })
}

/**
 * Check if OpenSSL is available and get version info.
 * @returns OpenSSL version string
 * @throws Error if OpenSSL is not available
 * @public
 */
export async function checkOpenSSL(): Promise<string> {
  const result = await runOpenSSL(['version'])

  if (result.exitCode !== 0) {
    throw new Error(`OpenSSL check failed: ${result.stderr}`)
  }

  return result.stdout.toString().trim()
}

/**
 * Cached result of OpenSSL availability check.
 * @internal
 */
let openSSLChecked = false

/**
 * Ensure OpenSSL is available before performing cryptographic operations.
 * @throws Error with installation instructions if OpenSSL is not available
 * @internal
 */
async function ensureOpenSSLAvailable(): Promise<void> {
  if (openSSLChecked) {
    return
  }

  try {
    await checkOpenSSL()
    openSSLChecked = true
  } catch {
    throw new Error(
      'OpenSSL is not installed or not in PATH. ' +
        'Please install OpenSSL to use attest-it. ' +
        'On macOS: brew install openssl. ' +
        'On Ubuntu: apt-get install openssl',
    )
  }
}

/**
 * Get the default private key path based on OS.
 * - macOS/Linux: ~/.config/attest-it/private.pem
 * - Windows: %APPDATA%\attest-it\private.pem
 * @public
 */
export function getDefaultPrivateKeyPath(): string {
  const homeDir = os.homedir()

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA ?? path.join(homeDir, 'AppData', 'Roaming')
    return path.join(appData, 'attest-it', 'private.pem')
  }

  return path.join(homeDir, '.config', 'attest-it', 'private.pem')
}

/**
 * Get the default public key path (in repo).
 * @public
 */
export function getDefaultPublicKeyPath(): string {
  return path.join(process.cwd(), 'attest-it-public.pem')
}

/**
 * Ensure a directory exists, creating it and parent directories if needed.
 * @param dirPath - Directory path to create
 * @internal
 */
async function ensureDir(dirPath: string): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive: true })
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code !== 'EEXIST') {
      throw err
    }
  }
}

/**
 * Check if a file exists.
 * @param filePath - File path to check
 * @returns true if file exists
 * @internal
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * Clean up one or more files, ignoring errors if files don't exist.
 * @param paths - File paths to delete
 * @internal
 */
async function cleanupFiles(...paths: string[]): Promise<void> {
  for (const filePath of paths) {
    try {
      await fs.unlink(filePath)
    } catch {
      // Ignore cleanup errors - file may not exist
    }
  }
}

/**
 * Generate a new RSA-2048 keypair using OpenSSL.
 *
 * RSA-2048 with SHA-256 is used because it's universally supported across
 * all OpenSSL and LibreSSL versions, including older macOS systems.
 *
 * @param options - Generation options
 * @returns Paths to generated keys
 * @throws Error if OpenSSL fails or keys exist without force
 * @public
 */
export async function generateKeyPair(options: KeygenOptions = {}): Promise<KeyPaths> {
  // Ensure OpenSSL is available before proceeding
  await ensureOpenSSLAvailable()

  const {
    privatePath = getDefaultPrivateKeyPath(),
    publicPath = getDefaultPublicKeyPath(),
    force = false,
  } = options

  // Check if keys already exist
  const privateExists = await fileExists(privatePath)
  const publicExists = await fileExists(publicPath)

  if ((privateExists || publicExists) && !force) {
    const existing = [privateExists ? privatePath : null, publicExists ? publicPath : null].filter(
      Boolean,
    )
    throw new Error(
      `Key files already exist: ${existing.join(', ')}. Use force: true to overwrite.`,
    )
  }

  // Ensure parent directories exist
  await ensureDir(path.dirname(privatePath))
  await ensureDir(path.dirname(publicPath))

  try {
    // Generate RSA-2048 private key
    const genArgs = [
      'genpkey',
      '-algorithm',
      'RSA',
      '-pkeyopt',
      'rsa_keygen_bits:2048',
      '-out',
      privatePath,
    ]

    const genResult = await runOpenSSL(genArgs)
    if (genResult.exitCode !== 0) {
      throw new Error(`Failed to generate private key: ${genResult.stderr}`)
    }

    // Set restrictive permissions on private key
    await setKeyPermissions(privatePath)

    // Extract public key
    const pubResult = await runOpenSSL(['pkey', '-in', privatePath, '-pubout', '-out', publicPath])

    if (pubResult.exitCode !== 0) {
      throw new Error(`Failed to extract public key: ${pubResult.stderr}`)
    }

    return {
      privatePath,
      publicPath,
    }
  } catch (err) {
    // Clean up both key files on any failure
    await cleanupFiles(privatePath, publicPath)
    throw err
  }
}

/**
 * Sign data using an RSA private key with SHA-256.
 *
 * Uses `openssl dgst -sha256 -sign` which is universally supported across
 * all OpenSSL and LibreSSL versions.
 *
 * @param options - Signing options
 * @returns Base64-encoded signature
 * @throws Error if signing fails
 * @public
 */
export async function sign(options: SignOptions): Promise<string> {
  // Ensure OpenSSL is available before proceeding
  await ensureOpenSSLAvailable()

  const { privateKeyPath, keyProvider, keyRef, data } = options

  // Determine which key path to use
  let effectiveKeyPath: string
  let cleanup: (() => Promise<void>) | undefined

  if (keyProvider && keyRef) {
    // Use key provider to retrieve the key
    const result = await keyProvider.getPrivateKey(keyRef)
    effectiveKeyPath = result.keyPath
    cleanup = result.cleanup
  } else if (privateKeyPath) {
    // Legacy path: use privateKeyPath directly
    effectiveKeyPath = privateKeyPath
  } else {
    throw new Error(
      'Either privateKeyPath or both keyProvider and keyRef must be provided for signing',
    )
  }

  try {
    // Check if private key exists
    if (!(await fileExists(effectiveKeyPath))) {
      throw new Error(`Private key not found: ${effectiveKeyPath}`)
    }

    // Convert data to Buffer
    const dataBuffer = typeof data === 'string' ? Buffer.from(data, 'utf8') : data

    // OpenSSL dgst cannot handle empty files, so we need to add a single byte
    // for empty data and document this limitation
    const processBuffer = dataBuffer.length === 0 ? Buffer.from([0x00]) : dataBuffer

    // Create temporary directory with OS-level uniqueness guarantees
    // This prevents TOCTOU race conditions that Math.random() would allow
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'attest-it-'))
    const dataFile = path.join(tmpDir, 'data.bin')
    const sigFile = path.join(tmpDir, 'sig.bin')

    try {
      // Write data to temp file
      await fs.writeFile(dataFile, processBuffer)

      // Sign using openssl dgst -sha256 (cross-platform compatible)
      const signArgs = ['dgst', '-sha256', '-sign', effectiveKeyPath, '-out', sigFile, dataFile]
      const result = await runOpenSSL(signArgs)

      if (result.exitCode !== 0) {
        throw new Error(`Failed to sign data: ${result.stderr}`)
      }

      // Read the signature
      const sigBuffer = await fs.readFile(sigFile)
      return sigBuffer.toString('base64')
    } finally {
      // Clean up temp directory and all files within it
      try {
        await fs.rm(tmpDir, { recursive: true, force: true })
      } catch {
        // Ignore cleanup errors - OS will eventually clean tmpdir
      }
    }
  } finally {
    // Always call cleanup function if provided
    if (cleanup) {
      await cleanup()
    }
  }
}

/**
 * Verify a signature using an RSA public key with SHA-256.
 *
 * Uses `openssl dgst -sha256 -verify` which is universally supported across
 * all OpenSSL and LibreSSL versions.
 *
 * @param options - Verification options
 * @returns true if signature is valid
 * @throws Error if verification fails (not just invalid signature)
 * @public
 */
export async function verify(options: VerifyOptions): Promise<boolean> {
  // Ensure OpenSSL is available before proceeding
  await ensureOpenSSLAvailable()

  const { publicKeyPath, data, signature } = options

  // Check if public key exists
  if (!(await fileExists(publicKeyPath))) {
    throw new Error(`Public key not found: ${publicKeyPath}`)
  }

  // Convert data to Buffer
  const dataBuffer = typeof data === 'string' ? Buffer.from(data, 'utf8') : data

  // OpenSSL dgst cannot handle empty files, so we use the same workaround
  // as in sign() - add a single byte for empty data
  const processBuffer = dataBuffer.length === 0 ? Buffer.from([0x00]) : dataBuffer

  // Decode signature from base64
  const sigBuffer = Buffer.from(signature, 'base64')

  // Create temporary directory with OS-level uniqueness guarantees
  // This prevents TOCTOU race conditions that Math.random() would allow
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'attest-it-'))
  const dataFile = path.join(tmpDir, 'data.bin')
  const sigFile = path.join(tmpDir, 'sig.bin')

  try {
    // Write data and signature to temp files
    await fs.writeFile(dataFile, processBuffer)
    await fs.writeFile(sigFile, sigBuffer)

    // Verify using openssl dgst -sha256 (cross-platform compatible)
    const verifyArgs = [
      'dgst',
      '-sha256',
      '-verify',
      publicKeyPath,
      '-signature',
      sigFile,
      dataFile,
    ]
    const result = await runOpenSSL(verifyArgs)

    // dgst -verify: Exit code 0 means valid, non-0 means invalid
    // Output contains "Verified OK" on success
    return result.exitCode === 0 && result.stdout.toString().includes('Verified OK')
  } finally {
    // Clean up temp directory and all files within it
    try {
      await fs.rm(tmpDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors - OS will eventually clean tmpdir
    }
  }
}

/**
 * Set restrictive permissions on a private key file.
 * @param keyPath - Path to the private key
 * @public
 */
export async function setKeyPermissions(keyPath: string): Promise<void> {
  // On Windows, use fs.chmod which has limited effect
  // On Unix, set to 0o600 (read/write for owner only)
  if (process.platform === 'win32') {
    // Windows doesn't support Unix-style permissions in the same way
    // But we still call chmod for consistency
    await fs.chmod(keyPath, 0o600)
  } else {
    await fs.chmod(keyPath, 0o600)
  }
}
