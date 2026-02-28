/**
 * Tests for discovery functions.
 *
 * @remarks
 * Discovery functions call external CLI tools (op, security, ykman).
 * These tests mock child_process.spawn to verify the correct commands
 * are invoked and outputs are parsed correctly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'

// Track spawn calls for assertions
let spawnCalls: { command: string; args: string[] }[] = []
let mockSpawnResult: {
  stdout: string
  stderr: string
  exitCode: number
} = { stdout: '', stderr: '', exitCode: 0 }

// Mock child_process before importing the module under test
vi.mock('node:child_process', () => {
  return {
    spawn: (command: string, args: string[], _options: unknown) => {
      spawnCalls.push({ command, args })

      const proc = new EventEmitter()
      const stdoutEmitter = new EventEmitter()
      const stderrEmitter = new EventEmitter()

      Object.defineProperty(proc, 'stdout', { value: stdoutEmitter })
      Object.defineProperty(proc, 'stderr', { value: stderrEmitter })

      // Emit data and close asynchronously
      process.nextTick(() => {
        stdoutEmitter.emit('data', Buffer.from(mockSpawnResult.stdout))
        stderrEmitter.emit('data', Buffer.from(mockSpawnResult.stderr))
        proc.emit('close', mockSpawnResult.exitCode)
      })

      return proc
    },
  }
})

// Import after mock setup
const { isOnePasswordInstalled, isMacOSKeychainAvailable, isYubiKeyInstalled, isYubiKeyConnected } =
  await import('../../src/key-provider/discovery.js')

describe('discovery functions', () => {
  beforeEach(() => {
    spawnCalls = []
    mockSpawnResult = { stdout: '', stderr: '', exitCode: 0 }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('isOnePasswordInstalled', () => {
    it('should return true when op --version succeeds', async () => {
      mockSpawnResult = { stdout: '2.25.0', stderr: '', exitCode: 0 }

      const result = await isOnePasswordInstalled()

      expect(result).toBe(true)
      expect(spawnCalls[0]?.command).toBe('op')
      expect(spawnCalls[0]?.args).toEqual(['--version'])
    })

    it('should return false when op --version fails', async () => {
      mockSpawnResult = { stdout: '', stderr: 'command not found', exitCode: 127 }

      const result = await isOnePasswordInstalled()

      expect(result).toBe(false)
    })
  })

  describe('isMacOSKeychainAvailable', () => {
    it('should return a boolean based on platform', () => {
      const result = isMacOSKeychainAvailable()

      expect(typeof result).toBe('boolean')
      expect(result).toBe(process.platform === 'darwin')
    })
  })

  describe('isYubiKeyInstalled', () => {
    it('should return true when ykman --version succeeds', async () => {
      mockSpawnResult = {
        stdout: 'YubiKey Manager (ykman) version: 5.4.0',
        stderr: '',
        exitCode: 0,
      }

      const result = await isYubiKeyInstalled()

      expect(result).toBe(true)
      expect(spawnCalls[0]?.command).toBe('ykman')
      expect(spawnCalls[0]?.args).toEqual(['--version'])
    })

    it('should return false when ykman is not installed', async () => {
      mockSpawnResult = { stdout: '', stderr: 'command not found', exitCode: 127 }

      const result = await isYubiKeyInstalled()

      expect(result).toBe(false)
    })
  })

  describe('isYubiKeyConnected', () => {
    it('should return true when ykman list --serials returns output', async () => {
      mockSpawnResult = { stdout: '12345678\n', stderr: '', exitCode: 0 }

      const result = await isYubiKeyConnected()

      expect(result).toBe(true)
      expect(spawnCalls[0]?.command).toBe('ykman')
      expect(spawnCalls[0]?.args).toEqual(['list', '--serials'])
    })

    it('should return false when no YubiKeys are connected', async () => {
      mockSpawnResult = { stdout: '', stderr: '', exitCode: 0 }

      const result = await isYubiKeyConnected()

      expect(result).toBe(false)
    })

    it('should return false when ykman fails', async () => {
      mockSpawnResult = { stdout: '', stderr: 'error', exitCode: 1 }

      const result = await isYubiKeyConnected()

      expect(result).toBe(false)
    })
  })
})
