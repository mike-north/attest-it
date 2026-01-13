import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  createSession,
  updateSessionAfterSuite,
  saveSession,
  loadSession,
  clearSession,
  getSessionPath,
  type Session,
} from '../src/session/session.js'
import * as fs from 'node:fs/promises'
import { join } from 'node:path'

// Mock the fs/promises module
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  unlink: vi.fn(),
  mkdir: vi.fn(),
}))

describe('session', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks()

    // Mock process.cwd to return a consistent value
    vi.spyOn(process, 'cwd').mockReturnValue('/test/project')
  })

  afterEach(() => {
    // Restore process.cwd
    vi.spyOn(process, 'cwd').mockRestore()
  })

  describe('getSessionPath', () => {
    it('should return correct session file path', () => {
      const path = getSessionPath()
      expect(path).toBe(join('/test/project', '.attest-it', 'session.json'))
    })

    it('should use current working directory', () => {
      vi.spyOn(process, 'cwd').mockReturnValue('/another/path')
      const path = getSessionPath()
      expect(path).toBe(join('/another/path', '.attest-it', 'session.json'))
    })
  })

  describe('createSession', () => {
    it('should create a new session with selected suites', () => {
      const selected = ['auth', 'payments', 'users']
      const session = createSession(selected)

      expect(session.selected).toEqual(selected)
      expect(session.completed).toEqual([])
      expect(session.failed).toEqual([])
      expect(session.remaining).toEqual(selected)
      expect(session.started).toBeTruthy()
      expect(typeof session.started).toBe('string')
    })

    it('should create valid ISO timestamp', () => {
      const session = createSession(['test'])
      const date = new Date(session.started)

      expect(date.toISOString()).toBe(session.started)
      expect(date.getTime()).toBeGreaterThan(0)
    })

    it('should handle empty suite list', () => {
      const session = createSession([])

      expect(session.selected).toEqual([])
      expect(session.completed).toEqual([])
      expect(session.failed).toEqual([])
      expect(session.remaining).toEqual([])
    })

    it('should create independent copies of selected array', () => {
      const selected = ['suite1', 'suite2']
      const session = createSession(selected)

      // Modify original array
      selected.push('suite3')

      // Session should not be affected
      expect(session.selected).toEqual(['suite1', 'suite2'])
      expect(session.remaining).toEqual(['suite1', 'suite2'])
    })
  })

  describe('updateSessionAfterSuite', () => {
    let session: Session

    beforeEach(() => {
      session = createSession(['suite1', 'suite2', 'suite3'])
    })

    it('should update session after successful suite completion', () => {
      const updated = updateSessionAfterSuite(session, 'suite1', true)

      expect(updated.completed).toEqual(['suite1'])
      expect(updated.failed).toEqual([])
      expect(updated.remaining).toEqual(['suite2', 'suite3'])
      expect(updated.selected).toEqual(['suite1', 'suite2', 'suite3'])
    })

    it('should update session after failed suite completion', () => {
      const updated = updateSessionAfterSuite(session, 'suite1', false)

      expect(updated.completed).toEqual([])
      expect(updated.failed).toEqual(['suite1'])
      expect(updated.remaining).toEqual(['suite2', 'suite3'])
      expect(updated.selected).toEqual(['suite1', 'suite2', 'suite3'])
    })

    it('should handle multiple successful completions', () => {
      let updated = updateSessionAfterSuite(session, 'suite1', true)
      updated = updateSessionAfterSuite(updated, 'suite2', true)

      expect(updated.completed).toEqual(['suite1', 'suite2'])
      expect(updated.failed).toEqual([])
      expect(updated.remaining).toEqual(['suite3'])
    })

    it('should handle mixed success and failure', () => {
      let updated = updateSessionAfterSuite(session, 'suite1', true)
      updated = updateSessionAfterSuite(updated, 'suite2', false)
      updated = updateSessionAfterSuite(updated, 'suite3', true)

      expect(updated.completed).toEqual(['suite1', 'suite3'])
      expect(updated.failed).toEqual(['suite2'])
      expect(updated.remaining).toEqual([])
    })

    it('should preserve started timestamp', () => {
      const updated = updateSessionAfterSuite(session, 'suite1', true)
      expect(updated.started).toBe(session.started)
    })

    it('should not modify original session', () => {
      const originalCompleted = [...session.completed]
      const originalFailed = [...session.failed]
      const originalRemaining = [...session.remaining]

      updateSessionAfterSuite(session, 'suite1', true)

      expect(session.completed).toEqual(originalCompleted)
      expect(session.failed).toEqual(originalFailed)
      expect(session.remaining).toEqual(originalRemaining)
    })

    it('should handle suite not in remaining list', () => {
      // This shouldn't happen in normal flow, but test defensive behavior
      const updated = updateSessionAfterSuite(session, 'nonexistent', true)

      expect(updated.completed).toEqual(['nonexistent'])
      expect(updated.remaining).toEqual(['suite1', 'suite2', 'suite3'])
    })
  })

  describe('saveSession', () => {
    it('should save session to correct file path', async () => {
      const session = createSession(['auth', 'payments'])

      await saveSession(session)

      expect(fs.mkdir).toHaveBeenCalledWith(join('/test/project', '.attest-it'), {
        recursive: true,
      })
      expect(fs.writeFile).toHaveBeenCalledWith(
        join('/test/project', '.attest-it', 'session.json'),
        JSON.stringify(session, null, 2),
        'utf-8',
      )
    })

    it('should create directory if it does not exist', async () => {
      const session = createSession(['test'])

      await saveSession(session)

      expect(fs.mkdir).toHaveBeenCalledWith(expect.stringContaining('.attest-it'), {
        recursive: true,
      })
    })

    it('should save session with pretty-printed JSON', async () => {
      const session = createSession(['suite1', 'suite2'])

      await saveSession(session)

      const expectedJson = JSON.stringify(session, null, 2)
      expect(fs.writeFile).toHaveBeenCalledWith(expect.any(String), expectedJson, 'utf-8')
    })
  })

  describe('loadSession', () => {
    it('should load valid session from file', async () => {
      const session = createSession(['auth', 'payments'])
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(session))

      const loaded = await loadSession()

      expect(loaded).toEqual(session)
      expect(fs.readFile).toHaveBeenCalledWith(
        join('/test/project', '.attest-it', 'session.json'),
        'utf-8',
      )
    })

    it('should return null if file does not exist', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT: no such file or directory'))

      const loaded = await loadSession()

      expect(loaded).toBeNull()
    })

    it('should return null if file is not valid JSON', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('invalid json {')

      const loaded = await loadSession()

      expect(loaded).toBeNull()
    })

    it('should return null if session structure is invalid - missing field', async () => {
      const invalidSession = {
        started: '2024-01-01T00:00:00.000Z',
        selected: ['auth'],
        // missing completed, failed, remaining
      }
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(invalidSession))

      const loaded = await loadSession()

      expect(loaded).toBeNull()
    })

    it('should return null if session structure is invalid - wrong type for started', async () => {
      const invalidSession = {
        started: 123, // should be string
        selected: ['auth'],
        completed: [],
        failed: [],
        remaining: ['auth'],
      }
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(invalidSession))

      const loaded = await loadSession()

      expect(loaded).toBeNull()
    })

    it('should return null if session structure is invalid - selected not array', async () => {
      const invalidSession = {
        started: '2024-01-01T00:00:00.000Z',
        selected: 'not-an-array',
        completed: [],
        failed: [],
        remaining: [],
      }
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(invalidSession))

      const loaded = await loadSession()

      expect(loaded).toBeNull()
    })

    it('should return null if session structure is invalid - array contains non-string', async () => {
      const invalidSession = {
        started: '2024-01-01T00:00:00.000Z',
        selected: ['auth', 123, 'payments'], // contains number
        completed: [],
        failed: [],
        remaining: ['auth', 'payments'],
      }
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(invalidSession))

      const loaded = await loadSession()

      expect(loaded).toBeNull()
    })

    it('should return null if session is null', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('null')

      const loaded = await loadSession()

      expect(loaded).toBeNull()
    })

    it('should return null if session is primitive type', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('"just a string"')

      const loaded = await loadSession()

      expect(loaded).toBeNull()
    })

    it('should return null if file read permission denied', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('EACCES: permission denied'))

      const loaded = await loadSession()

      expect(loaded).toBeNull()
    })
  })

  describe('clearSession', () => {
    it('should delete session file', async () => {
      vi.mocked(fs.unlink).mockResolvedValue(undefined)

      await clearSession()

      expect(fs.unlink).toHaveBeenCalledWith(join('/test/project', '.attest-it', 'session.json'))
    })

    it('should not throw if file does not exist', async () => {
      vi.mocked(fs.unlink).mockRejectedValue(new Error('ENOENT: no such file or directory'))

      await expect(clearSession()).resolves.toBeUndefined()
    })

    it('should not throw if permission denied', async () => {
      vi.mocked(fs.unlink).mockRejectedValue(new Error('EACCES: permission denied'))

      await expect(clearSession()).resolves.toBeUndefined()
    })
  })

  describe('integration scenarios', () => {
    it('should support save and load round-trip', async () => {
      const session = createSession(['suite1', 'suite2', 'suite3'])
      const updated = updateSessionAfterSuite(session, 'suite1', true)

      // Mock save
      let savedData = ''
      vi.mocked(fs.writeFile).mockImplementation((_path, data) => {
        // Type assertion needed because data can be string | Buffer
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        savedData = data as string
        return Promise.resolve()
      })

      await saveSession(updated)

      // Mock load
      vi.mocked(fs.readFile).mockResolvedValue(savedData)

      const loaded = await loadSession()

      expect(loaded).toEqual(updated)
    })

    it('should handle full session lifecycle', () => {
      // Create session
      const session = createSession(['auth', 'payments', 'users'])
      expect(session.remaining).toHaveLength(3)

      // Complete first suite successfully
      let current = updateSessionAfterSuite(session, 'auth', true)
      expect(current.completed).toEqual(['auth'])
      expect(current.remaining).toHaveLength(2)

      // Fail second suite
      current = updateSessionAfterSuite(current, 'payments', false)
      expect(current.failed).toEqual(['payments'])
      expect(current.remaining).toHaveLength(1)

      // Complete last suite successfully
      current = updateSessionAfterSuite(current, 'users', true)
      expect(current.completed).toEqual(['auth', 'users'])
      expect(current.failed).toEqual(['payments'])
      expect(current.remaining).toHaveLength(0)

      // Verify final state
      expect(current.selected).toEqual(['auth', 'payments', 'users'])
      expect(current.started).toBe(session.started)
    })
  })
})
