/**
 * Key file management utilities.
 *
 * @remarks
 * These utilities handle key file paths and permissions.
 * They are not tied to any specific cryptographic algorithm.
 *
 * @packageDocumentation
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'

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
 * Get the default YubiKey encrypted key path based on OS.
 * - macOS/Linux: ~/.config/attest-it/yubikey-private.enc
 * - Windows: %APPDATA%\attest-it\yubikey-private.enc
 * @public
 */
export function getDefaultYubiKeyEncryptedKeyPath(): string {
  const homeDir = os.homedir()

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA ?? path.join(homeDir, 'AppData', 'Roaming')
    return path.join(appData, 'attest-it', 'yubikey-private.enc')
  }

  return path.join(homeDir, '.config', 'attest-it', 'yubikey-private.enc')
}

/**
 * Set restrictive permissions on a private key file.
 * @param keyPath - Path to the private key
 * @public
 */
export async function setKeyPermissions(keyPath: string): Promise<void> {
  await fs.chmod(keyPath, 0o600)
}
