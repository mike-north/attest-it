/**
 * Discovery functions for key provider backends.
 *
 * @remarks
 * These standalone functions check availability and enumerate resources
 * for each backend (1Password accounts/vaults, macOS keychains, YubiKey devices).
 * They are separated from the storage-oriented KeyProvider implementations so
 * that CLI tooling can discover available backends without instantiating a provider.
 *
 * @packageDocumentation
 */

import { spawn } from 'node:child_process'
import type {
  OnePasswordAccount,
  InaccessibleAccount,
  ListAccountsResult,
  OnePasswordVault,
} from './one-password-provider.js'
import type { MacOSKeychain } from './macos-keychain-provider.js'
import type { YubiKeyInfo } from './yubikey-provider.js'

// ─── 1Password ───────────────────────────────────────────────────────

/**
 * Check if the 1Password CLI (`op`) is installed.
 * @returns True if the `op` command is available
 * @public
 */
export async function isOnePasswordInstalled(): Promise<boolean> {
  try {
    await execCommand('op', ['--version'])
    return true
  } catch {
    return false
  }
}

/**
 * List all 1Password accounts, including inaccessible ones with reasons.
 *
 * @remarks
 * Accounts are fetched sequentially with a small delay to avoid race
 * conditions in the `op` CLI.
 *
 * @returns Object containing accessible accounts and inaccessible accounts with reasons
 * @public
 */
export async function listOnePasswordAccounts(): Promise<ListAccountsResult> {
  const output = await execCommand('op', ['account', 'list', '--format=json'])
  const parsed: unknown = JSON.parse(output)
  if (!Array.isArray(parsed)) {
    throw new Error('Unexpected response from 1Password: account list is not an array')
  }
  // Type assertion needed: We validate it's an array, but can't validate structure
  // at runtime without a full validation library. The op CLI output format is trusted.
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const basicAccounts = parsed as OnePasswordAccount[]

  type AccountResult =
    | { success: true; account: OnePasswordAccount & { name: string } }
    | { success: false; email: string; url: string; reason: string }

  const accountResults: AccountResult[] = []
  const RETRY_DELAY_MS = 500
  const MAX_RETRIES = 2

  for (const account of basicAccounts) {
    if (!account.account_uuid) {
      accountResults.push({
        success: false as const,
        email: account.email,
        url: account.url,
        reason: 'Account missing account_uuid field',
      })
      continue
    }

    let lastError: string | undefined
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0 || accountResults.length > 0) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
      }

      try {
        const detailOutput = await execCommand('op', [
          'account',
          'get',
          '--account',
          account.account_uuid,
          '--format=json',
        ])
        const details: unknown = JSON.parse(detailOutput)
        if (
          details !== null &&
          typeof details === 'object' &&
          'name' in details &&
          typeof details.name === 'string'
        ) {
          accountResults.push({
            success: true as const,
            account: { ...account, name: details.name },
          })
          lastError = undefined
          break
        }
        lastError = 'Account details response missing name field'
        break
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
      }
    }

    if (lastError !== undefined) {
      accountResults.push({
        success: false as const,
        email: account.email,
        url: account.url,
        reason: lastError,
      })
    }
  }

  const accounts: (OnePasswordAccount & { name: string })[] = []
  const inaccessible: InaccessibleAccount[] = []

  for (const result of accountResults) {
    if (result.success) {
      accounts.push(result.account)
    } else {
      inaccessible.push({
        email: result.email,
        url: result.url,
        reason: result.reason,
      })
    }
  }

  if (accounts.length === 0 && basicAccounts.length > 0) {
    const reasons = inaccessible.map((a) => `  - ${a.email}: ${a.reason}`).join('\n')
    throw new Error(
      `Could not access any 1Password accounts. All ${String(basicAccounts.length)} account(s) failed:\n${reasons}`,
    )
  }

  return { accounts, inaccessible }
}

/**
 * List vaults in a specific 1Password account.
 * @param accountUuid - Account UUID from listOnePasswordAccounts() (optional if only one account)
 * @returns Array of vault information
 * @public
 */
export async function listOnePasswordVaults(accountUuid?: string): Promise<OnePasswordVault[]> {
  const args = ['vault', 'list', '--format=json']
  if (accountUuid) {
    args.push('--account', accountUuid)
  }

  let output: string
  try {
    output = await execCommand('op', args)
  } catch (error) {
    throw new Error(
      `Failed to list 1Password vaults${accountUuid ? ` for account ${accountUuid}` : ''}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  const parsed: unknown = JSON.parse(output)
  if (!Array.isArray(parsed)) {
    throw new Error('Unexpected response from 1Password: vault list is not an array')
  }
  // Type assertion needed: same rationale as listOnePasswordAccounts
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return parsed as OnePasswordVault[]
}

// ─── macOS Keychain ──────────────────────────────────────────────────

/**
 * Check if macOS Keychain is available on the current platform.
 * @returns True if running on macOS
 * @public
 */
export function isMacOSKeychainAvailable(): boolean {
  return process.platform === 'darwin'
}

/**
 * List available keychains on the system.
 * @returns Array of keychain information (empty array if not on macOS)
 * @public
 */
export async function listMacOSKeychains(): Promise<MacOSKeychain[]> {
  if (!isMacOSKeychainAvailable()) {
    return []
  }

  try {
    const output = await execCommand('security', ['list-keychains'])
    const keychains: MacOSKeychain[] = []
    const lines = output.split('\n')
    for (const line of lines) {
      const match = /"(.+)"/.exec(line.trim())
      if (match?.[1]) {
        const fullPath = match[1]
        const filename = fullPath.split('/').pop() ?? fullPath
        const name = filename.replace(/\.keychain(-db)?$/, '')
        keychains.push({ path: fullPath, name })
      }
    }
    return keychains
  } catch {
    return []
  }
}

// ─── YubiKey ─────────────────────────────────────────────────────────

/**
 * Check if the YubiKey Manager CLI (`ykman`) is installed.
 * @returns True if `ykman` is available
 * @public
 */
export async function isYubiKeyInstalled(): Promise<boolean> {
  try {
    await execCommand('ykman', ['--version'])
    return true
  } catch {
    return false
  }
}

/**
 * Check if any YubiKey is connected to the system.
 * @returns True if at least one YubiKey is connected
 * @public
 */
export async function isYubiKeyConnected(): Promise<boolean> {
  try {
    const output = await execCommand('ykman', ['list', '--serials'])
    return output.trim().length > 0
  } catch {
    return false
  }
}

/**
 * List connected YubiKey devices with serial, type, and firmware info.
 * @returns Array of YubiKey device information
 * @public
 */
export async function listYubiKeyDevices(): Promise<YubiKeyInfo[]> {
  if (!(await isYubiKeyInstalled())) {
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
        const typeMatch = /Device type:\s+(.+)/i.exec(infoOutput)
        const fwMatch = /Firmware version:\s+(.+)/i.exec(infoOutput)

        devices.push({
          serial,
          type: typeMatch?.[1]?.trim() ?? 'YubiKey',
          firmware: fwMatch?.[1]?.trim() ?? 'Unknown',
        })
      } catch {
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
 * Check if HMAC challenge-response is configured on a YubiKey slot.
 * @param slot - Slot number (1 or 2), defaults to 2
 * @param serial - Optional YubiKey serial number
 * @returns True if challenge-response is configured on the slot
 * @public
 */
export async function isYubiKeyChallengeResponseConfigured(
  slot: 1 | 2 = 2,
  serial?: string,
): Promise<boolean> {
  try {
    const testChallenge = Buffer.from('attest-it-test-challenge-12345')
    const args = ['otp', 'calculate', String(slot), testChallenge.toString('hex')]
    if (serial) {
      args.unshift('--device', serial)
    }
    await execInteractiveCommand('ykman', args)
    return true
  } catch {
    return false
  }
}

// ─── Internal helpers ────────────────────────────────────────────────

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
 * Execute an interactive command that shows stderr to user (for prompts).
 * @internal
 */
async function execInteractiveCommand(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: ['inherit', 'pipe', 'inherit'] })
    let stdout = ''

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim())
      } else {
        reject(new Error(`Command failed with exit code ${String(code)}`))
      }
    })

    proc.on('error', (error) => {
      reject(error)
    })
  })
}
