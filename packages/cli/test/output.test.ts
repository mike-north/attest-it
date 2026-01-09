import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  setOutputOptions,
  getOutputOptions,
  log,
  verbose,
  success,
  error,
  warn,
  info,
  formatTable,
  colorizeStatus,
  outputJson,
  type TableRow,
} from '../src/utils/output.js'

describe('output utilities', () => {
  // Mock console methods
  const originalLog = console.log
  const originalError = console.error
  const originalWarn = console.warn

  // Helper to get mock call arguments safely
  function getLogCalls(): unknown[][] {
    return vi.mocked(console.log).mock.calls
  }

  function getErrorCalls(): unknown[][] {
    return vi.mocked(console.error).mock.calls
  }

  function getWarnCalls(): unknown[][] {
    return vi.mocked(console.warn).mock.calls
  }

  beforeEach(() => {
    console.log = vi.fn()
    console.error = vi.fn()
    console.warn = vi.fn()
    // Reset output options before each test
    setOutputOptions({})
  })

  afterEach(() => {
    console.log = originalLog
    console.error = originalError
    console.warn = originalWarn
  })

  describe('setOutputOptions and getOutputOptions', () => {
    it('should set and get output options', () => {
      const options = { verbose: true, quiet: false, json: true }
      setOutputOptions(options)
      expect(getOutputOptions()).toEqual(options)
    })

    it('should handle empty options', () => {
      setOutputOptions({})
      expect(getOutputOptions()).toEqual({})
    })

    it('should overwrite previous options', () => {
      setOutputOptions({ verbose: true })
      setOutputOptions({ quiet: true })
      expect(getOutputOptions()).toEqual({ quiet: true })
    })
  })

  describe('log', () => {
    it('should log message when not quiet', () => {
      setOutputOptions({ quiet: false })
      log('test message')
      expect(console.log).toHaveBeenCalledWith('test message')
    })

    it('should not log when quiet is true', () => {
      setOutputOptions({ quiet: true })
      log('test message')
      expect(console.log).not.toHaveBeenCalled()
    })

    it('should log by default when no options set', () => {
      log('test message')
      expect(console.log).toHaveBeenCalledWith('test message')
    })
  })

  describe('verbose', () => {
    it('should log dimmed message when verbose is true and not quiet', () => {
      setOutputOptions({ verbose: true, quiet: false })
      verbose('verbose message')
      expect(console.log).toHaveBeenCalled()
      // Check that the message contains the text (it will be dimmed with ANSI codes)
      const calls = getLogCalls()
      expect(calls[0]?.[0]).toContain('verbose message')
    })

    it('should not log when verbose is false', () => {
      setOutputOptions({ verbose: false })
      verbose('verbose message')
      expect(console.log).not.toHaveBeenCalled()
    })

    it('should not log when quiet is true even if verbose is true', () => {
      setOutputOptions({ verbose: true, quiet: true })
      verbose('verbose message')
      expect(console.log).not.toHaveBeenCalled()
    })

    it('should not log by default when verbose option not set', () => {
      verbose('verbose message')
      expect(console.log).not.toHaveBeenCalled()
    })
  })

  describe('success', () => {
    it('should log success message with checkmark', () => {
      success('operation completed')
      expect(console.log).toHaveBeenCalled()
      const calls = getLogCalls()
      expect(calls[0]?.[0]).toContain('✓')
      expect(calls[0]?.[0]).toContain('operation completed')
    })

    it('should not log when quiet is true', () => {
      setOutputOptions({ quiet: true })
      success('operation completed')
      expect(console.log).not.toHaveBeenCalled()
    })
  })

  describe('error', () => {
    it('should always log error message with cross', () => {
      error('operation failed')
      expect(console.error).toHaveBeenCalled()
      const calls = getErrorCalls()
      expect(calls[0]?.[0]).toContain('✗')
      expect(calls[0]?.[0]).toContain('operation failed')
    })

    it('should log error even when quiet is true', () => {
      setOutputOptions({ quiet: true })
      error('operation failed')
      expect(console.error).toHaveBeenCalled()
    })
  })

  describe('warn', () => {
    it('should log warning message with warning symbol', () => {
      warn('warning message')
      expect(console.warn).toHaveBeenCalled()
      const calls = getWarnCalls()
      expect(calls[0]?.[0]).toContain('⚠')
      expect(calls[0]?.[0]).toContain('warning message')
    })

    it('should not log when quiet is true', () => {
      setOutputOptions({ quiet: true })
      warn('warning message')
      expect(console.warn).not.toHaveBeenCalled()
    })
  })

  describe('info', () => {
    it('should log info message with info symbol', () => {
      info('info message')
      expect(console.log).toHaveBeenCalled()
      const calls = getLogCalls()
      expect(calls[0]?.[0]).toContain('ℹ')
      expect(calls[0]?.[0]).toContain('info message')
    })

    it('should not log when quiet is true', () => {
      setOutputOptions({ quiet: true })
      info('info message')
      expect(console.log).not.toHaveBeenCalled()
    })
  })

  describe('formatTable', () => {
    it('should format table with correct columns and alignment', () => {
      const rows: TableRow[] = [
        {
          suite: 'auth',
          status: 'VALID',
          fingerprint: 'abc123',
          age: '2 days',
        },
        {
          suite: 'payments',
          status: 'EXPIRED',
          fingerprint: 'def456',
          age: '10 days',
        },
      ]

      const result = formatTable(rows)

      // Check header
      expect(result).toContain('Suite')
      expect(result).toContain('Status')
      expect(result).toContain('Fingerprint')
      expect(result).toContain('Age')

      // Check separator
      expect(result).toContain('─')
      expect(result).toContain('┼')

      // Check data rows
      expect(result).toContain('auth')
      expect(result).toContain('VALID')
      expect(result).toContain('abc123')
      expect(result).toContain('2 days')
      expect(result).toContain('payments')
      expect(result).toContain('EXPIRED')
      expect(result).toContain('def456')
      expect(result).toContain('10 days')
    })

    it('should handle empty rows', () => {
      const rows: TableRow[] = []
      const result = formatTable(rows)

      // Should still have headers and separator
      expect(result).toContain('Suite')
      expect(result).toContain('Status')
      expect(result).toContain('─')
    })

    it('should align columns correctly with varying lengths', () => {
      const rows: TableRow[] = [
        {
          suite: 'a',
          status: 'VALID',
          fingerprint: 'x',
          age: '1d',
        },
        {
          suite: 'very-long-suite-name',
          status: 'SIGNATURE_INVALID',
          fingerprint: 'very-long-fingerprint',
          age: '30 days',
        },
      ]

      const result = formatTable(rows)
      const lines = result.split('\n')

      // All lines should have the same width (accounting for separators)
      const headerWidth = lines[0]?.length ?? 0
      expect(headerWidth).toBeGreaterThan(0)

      // Check that columns are properly aligned by verifying separators align
      expect(lines[1]).toBeDefined()
      const separatorLine = lines[1] ?? ''
      const separatorIndices: number[] = []
      for (let i = 0; i < separatorLine.length; i++) {
        if (separatorLine[i] === '┼') {
          separatorIndices.push(i)
        }
      }

      // Verify data rows have separators at the same positions
      for (let i = 2; i < lines.length; i++) {
        const line = lines[i]
        if (!line) continue
        for (const idx of separatorIndices) {
          expect(line[idx]).toBe('│')
        }
      }
    })
  })

  describe('colorizeStatus', () => {
    it('should return string containing VALID status', () => {
      const result = colorizeStatus('VALID')
      expect(result).toContain('VALID')
      // The result should be a string
      expect(typeof result).toBe('string')
    })

    it('should return string containing NEEDS_ATTESTATION status', () => {
      const result = colorizeStatus('NEEDS_ATTESTATION')
      expect(result).toContain('NEEDS_ATTESTATION')
      expect(typeof result).toBe('string')
    })

    it('should return string containing FINGERPRINT_CHANGED status', () => {
      const result = colorizeStatus('FINGERPRINT_CHANGED')
      expect(result).toContain('FINGERPRINT_CHANGED')
      expect(typeof result).toBe('string')
    })

    it('should return string containing EXPIRED status', () => {
      const result = colorizeStatus('EXPIRED')
      expect(result).toContain('EXPIRED')
      expect(typeof result).toBe('string')
    })

    it('should return string containing INVALIDATED_BY_PARENT status', () => {
      const result = colorizeStatus('INVALIDATED_BY_PARENT')
      expect(result).toContain('INVALIDATED_BY_PARENT')
      expect(typeof result).toBe('string')
    })

    it('should return string containing SIGNATURE_INVALID status', () => {
      const result = colorizeStatus('SIGNATURE_INVALID')
      expect(result).toContain('SIGNATURE_INVALID')
      expect(typeof result).toBe('string')
    })

    it('should return unknown status unchanged', () => {
      const result = colorizeStatus('UNKNOWN_STATUS')
      expect(result).toBe('UNKNOWN_STATUS')
    })

    it('should handle empty string', () => {
      const result = colorizeStatus('')
      expect(result).toBe('')
    })
  })

  describe('outputJson', () => {
    it('should output formatted JSON', () => {
      const data = { foo: 'bar', baz: 42 }
      outputJson(data)
      expect(console.log).toHaveBeenCalledWith(JSON.stringify(data, null, 2))
    })

    it('should handle nested objects', () => {
      const data = {
        outer: {
          inner: {
            value: 'nested',
          },
        },
      }
      outputJson(data)
      const expected = JSON.stringify(data, null, 2)
      expect(console.log).toHaveBeenCalledWith(expected)
    })

    it('should handle arrays', () => {
      const data = [1, 2, 3]
      outputJson(data)
      expect(console.log).toHaveBeenCalledWith(JSON.stringify(data, null, 2))
    })

    it('should handle null', () => {
      outputJson(null)
      expect(console.log).toHaveBeenCalledWith('null')
    })

    it('should handle primitive types', () => {
      outputJson('string')
      expect(console.log).toHaveBeenCalledWith('"string"')

      outputJson(123)
      expect(console.log).toHaveBeenCalledWith('123')

      outputJson(true)
      expect(console.log).toHaveBeenCalledWith('true')
    })
  })
})
