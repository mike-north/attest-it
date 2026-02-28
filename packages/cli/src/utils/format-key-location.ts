/**
 * Shared utility for formatting key storage locations.
 */
import type { PrivateKeyRef } from '@attest-it/core'
import { getTheme } from './output.js'

/**
 * Format the private key storage location for display.
 */
export function formatKeyLocation(privateKey: PrivateKeyRef): string {
  const theme = getTheme()

  switch (privateKey.type) {
    case 'file':
      return `${theme.blue.bold()('VaultKeeper File')}: ${theme.muted(privateKey.id)}`
    case 'keychain':
      return `${theme.blue.bold()('macOS Keychain via VaultKeeper')}: ${theme.muted(privateKey.id)}`
    case '1password': {
      const location = privateKey.vault
        ? `${privateKey.vault}/${privateKey.id}`
        : privateKey.id
      return `${theme.blue.bold()('1Password via VaultKeeper')}: ${theme.muted(location)}`
    }
    case 'yubikey':
      return `${theme.blue.bold()('YubiKey via VaultKeeper')}: ${theme.muted(privateKey.id)}`
    case 'filesystem':
      return `${theme.blue.bold()('File (legacy)')}: ${theme.muted(privateKey.path)}`
    default:
      return 'Unknown storage'
  }
}
