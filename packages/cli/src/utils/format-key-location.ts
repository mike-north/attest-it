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
      return `${theme.blue.bold()('File')}: ${theme.muted(privateKey.path)}`
    case 'keychain': {
      let keychainName = 'default'
      if (privateKey.keychain) {
        const filename = privateKey.keychain.split('/').pop() ?? privateKey.keychain
        keychainName = filename.replace(/\.keychain(-db)?$/, '')
      }
      return `${theme.blue.bold()('macOS Keychain')}: ${theme.muted(`${keychainName}/${privateKey.service}`)}`
    }
    case '1password': {
      const parts = [privateKey.vault, privateKey.item]
      if (privateKey.account) {
        parts.unshift(privateKey.account)
      }
      return `${theme.blue.bold()('1Password')}: ${theme.muted(parts.join('/'))}`
    }
    default:
      return 'Unknown storage'
  }
}
