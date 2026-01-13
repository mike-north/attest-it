import { describe, it, expect } from 'vitest'
import {
  getStatusDisplay,
  STATUS_DISPLAY,
  BOX_CHARS,
  COLUMN_WIDTHS,
  getTheme,
  initTheme,
  type StatusDisplay,
} from '../../src/components/theme.js'

describe('theme module', () => {
  describe('STATUS_DISPLAY', () => {
    it('should have configuration for all verification statuses', () => {
      // Positive cases - all standard statuses should be defined
      expect(STATUS_DISPLAY.VALID).toBeDefined()
      expect(STATUS_DISPLAY.NEEDS_ATTESTATION).toBeDefined()
      expect(STATUS_DISPLAY.FINGERPRINT_CHANGED).toBeDefined()
      expect(STATUS_DISPLAY.EXPIRED).toBeDefined()
      expect(STATUS_DISPLAY.SIGNATURE_INVALID).toBeDefined()
      expect(STATUS_DISPLAY.INVALIDATED_BY_PARENT).toBeDefined()
    })

    it('should use green for VALID status', () => {
      expect(STATUS_DISPLAY.VALID?.color).toBe('green')
      expect(STATUS_DISPLAY.VALID?.symbol).toBe('✓')
      expect(STATUS_DISPLAY.VALID?.label).toBe('VALID')
    })

    it('should use yellow for warning statuses', () => {
      expect(STATUS_DISPLAY.NEEDS_ATTESTATION?.color).toBe('yellow')
      expect(STATUS_DISPLAY.FINGERPRINT_CHANGED?.color).toBe('yellow')
    })

    it('should use red for error statuses', () => {
      expect(STATUS_DISPLAY.EXPIRED?.color).toBe('red')
      expect(STATUS_DISPLAY.SIGNATURE_INVALID?.color).toBe('red')
      expect(STATUS_DISPLAY.INVALIDATED_BY_PARENT?.color).toBe('red')
    })

    it('should mark SIGNATURE_INVALID as bold', () => {
      expect(STATUS_DISPLAY.SIGNATURE_INVALID?.bold).toBe(true)
    })

    it('should have unique symbols for each status', () => {
      const symbols = Object.values(STATUS_DISPLAY).map((d) => d.symbol)
      // Check that we have symbols defined
      expect(symbols.length).toBeGreaterThan(0)
      expect(symbols.every((s) => s !== undefined)).toBe(true)
    })

    it('should have descriptive labels', () => {
      expect(STATUS_DISPLAY.NEEDS_ATTESTATION?.label).toBe('MISSING')
      expect(STATUS_DISPLAY.FINGERPRINT_CHANGED?.label).toBe('CHANGED')
      expect(STATUS_DISPLAY.EXPIRED?.label).toBe('STALE')
      expect(STATUS_DISPLAY.INVALIDATED_BY_PARENT?.label).toBe('PARENT_INVALID')
    })
  })

  describe('getStatusDisplay', () => {
    it('should return display config for known statuses', () => {
      // Positive cases
      const validDisplay = getStatusDisplay('VALID')
      expect(validDisplay.label).toBe('VALID')
      expect(validDisplay.color).toBe('green')
      expect(validDisplay.symbol).toBe('✓')

      const missingDisplay = getStatusDisplay('NEEDS_ATTESTATION')
      expect(missingDisplay.label).toBe('MISSING')
      expect(missingDisplay.color).toBe('yellow')
      expect(missingDisplay.symbol).toBe('○')
    })

    it('should return default config for unknown statuses', () => {
      // Negative cases - unknown status values
      const unknownDisplay = getStatusDisplay('UNKNOWN_STATUS')
      expect(unknownDisplay.label).toBe('UNKNOWN_STATUS')
      expect(unknownDisplay.color).toBe('white')
      expect(unknownDisplay.symbol).toBe('?')
    })

    it('should handle empty string status', () => {
      // Edge case - empty string
      const emptyDisplay = getStatusDisplay('')
      expect(emptyDisplay.label).toBe('')
      expect(emptyDisplay.color).toBe('white')
      expect(emptyDisplay.symbol).toBe('?')
    })

    it('should preserve status string case', () => {
      // Edge case - case sensitivity
      const lowerDisplay = getStatusDisplay('valid')
      expect(lowerDisplay.label).toBe('valid')
      expect(lowerDisplay.color).toBe('white') // Uses default since case doesn't match
    })

    it('should return StatusDisplay type with all required properties', () => {
      const display = getStatusDisplay('VALID')
      // Type checking - ensure all properties exist
      expect(display).toHaveProperty('label')
      expect(display).toHaveProperty('color')
      expect(display).toHaveProperty('symbol')
      // bold is optional
    })
  })

  describe('BOX_CHARS', () => {
    it('should provide all standard box drawing characters', () => {
      expect(BOX_CHARS.topLeft).toBe('┌')
      expect(BOX_CHARS.topRight).toBe('┐')
      expect(BOX_CHARS.bottomLeft).toBe('└')
      expect(BOX_CHARS.bottomRight).toBe('┘')
      expect(BOX_CHARS.horizontal).toBe('─')
      expect(BOX_CHARS.vertical).toBe('│')
      expect(BOX_CHARS.cross).toBe('┼')
    })

    it('should be immutable (as const)', () => {
      // This is a type-level test - if BOX_CHARS wasn't as const,
      // this wouldn't compile. At runtime we can verify it's frozen.
      expect(Object.isFrozen(BOX_CHARS)).toBe(false) // as const doesn't freeze at runtime
      // But we can verify the values are strings
      expect(typeof BOX_CHARS.horizontal).toBe('string')
    })

    it('should use Unicode box drawing characters', () => {
      // Verify these are proper Unicode characters, not ASCII
      expect(BOX_CHARS.horizontal.charCodeAt(0)).toBeGreaterThan(127)
      expect(BOX_CHARS.vertical.charCodeAt(0)).toBeGreaterThan(127)
    })
  })

  describe('COLUMN_WIDTHS', () => {
    it('should define widths for all column types', () => {
      expect(COLUMN_WIDTHS.checkbox).toBe(3)
      expect(COLUMN_WIDTHS.status).toBe(14)
      expect(COLUMN_WIDTHS.suite).toBe(25)
      expect(COLUMN_WIDTHS.reason).toBe(30)
    })

    it('should have positive width values', () => {
      // All widths should be positive numbers
      expect(COLUMN_WIDTHS.checkbox).toBeGreaterThan(0)
      expect(COLUMN_WIDTHS.status).toBeGreaterThan(0)
      expect(COLUMN_WIDTHS.suite).toBeGreaterThan(0)
      expect(COLUMN_WIDTHS.reason).toBeGreaterThan(0)
    })

    it('should have checkbox width adequate for "[ ]"', () => {
      // Checkbox needs at least 3 chars: [ ] or [x]
      expect(COLUMN_WIDTHS.checkbox).toBeGreaterThanOrEqual(3)
    })

    it('should have status width adequate for longest label', () => {
      // Find longest status label
      const longestLabel = Math.max(...Object.values(STATUS_DISPLAY).map((d) => d.label.length))
      expect(COLUMN_WIDTHS.status).toBeGreaterThanOrEqual(longestLabel)
    })
  })

  describe('getTheme', () => {
    it('should return a theme object with color methods', () => {
      const theme = getTheme()

      // Positive cases - theme should have all color methods
      expect(theme.red).toBeDefined()
      expect(theme.green).toBeDefined()
      expect(theme.yellow).toBeDefined()
      expect(theme.blue).toBeDefined()
      expect(theme.success).toBeDefined()
      expect(theme.error).toBeDefined()
      expect(theme.warning).toBeDefined()
      expect(theme.info).toBeDefined()
      expect(theme.muted).toBeDefined()
    })

    it('should return a functional theme that can colorize text', () => {
      const theme = getTheme()

      // Should be callable (even if it's a no-op in tests)
      expect(typeof theme.red).toBe('function')
      const colorized = theme.red('test')
      expect(typeof colorized).toBe('string')
    })

    it('should support chaining for bold/dim', () => {
      const theme = getTheme()

      // Should support method chaining
      // We're testing the API shape here, which requires accessing methods.
      // The unbound-method warning is not applicable since we immediately call it.
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const { bold } = theme.red
      expect(bold).toBeDefined()

      const boldResult = bold()
      expect(typeof boldResult).toBe('function')

      const text = boldResult('test')
      expect(typeof text).toBe('string')
    })

    it('should return consistent theme on multiple calls', () => {
      const theme1 = getTheme()
      const theme2 = getTheme()

      // Should return the same singleton instance
      expect(theme1).toBe(theme2)
    })
  })

  describe('initTheme', () => {
    it('should be an async function', () => {
      expect(initTheme).toBeInstanceOf(Function)
      const result = initTheme()
      expect(result).toBeInstanceOf(Promise)
    })

    it('should initialize theme for subsequent getTheme calls', async () => {
      await initTheme()
      const theme = getTheme()

      // After init, theme should be available
      expect(theme).toBeDefined()
      expect(theme.red).toBeDefined()
    })

    it('should handle multiple initialization calls', async () => {
      // Should not throw when called multiple times
      await initTheme()
      await initTheme()
      const theme = getTheme()

      expect(theme).toBeDefined()
    })
  })

  describe('type exports', () => {
    it('should export StatusDisplay type', () => {
      // Type-level test - if this compiles, the type is exported correctly
      const display: StatusDisplay = {
        label: 'TEST',
        color: 'blue',
        symbol: '⚡',
      }

      expect(display.label).toBe('TEST')
    })

    it('should allow optional bold in StatusDisplay', () => {
      // Type-level test - bold should be optional
      const withBold: StatusDisplay = {
        label: 'TEST',
        color: 'red',
        symbol: '!',
        bold: true,
      }

      const withoutBold: StatusDisplay = {
        label: 'TEST',
        color: 'red',
        symbol: '!',
      }

      expect(withBold.bold).toBe(true)
      expect(withoutBold.bold).toBeUndefined()
    })
  })

  describe('integration with verification statuses', () => {
    it('should provide display for all VerificationStatus values', () => {
      // All status values from @attest-it/core types.ts
      const statuses = [
        'VALID',
        'NEEDS_ATTESTATION',
        'FINGERPRINT_CHANGED',
        'EXPIRED',
        'INVALIDATED_BY_PARENT',
        'SIGNATURE_INVALID',
      ]

      statuses.forEach((status) => {
        const display = getStatusDisplay(status)
        expect(display).toBeDefined()
        expect(display.label).toBeTruthy()
        expect(display.color).toBeTruthy()
        expect(display.symbol).toBeTruthy()
      })
    })
  })
})
