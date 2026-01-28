import { describe, it, expect } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { SuiteTable, type SuiteInfo } from '../../src/components/SuiteTable.js'

describe('SuiteTable component', () => {
  const mockSuites: SuiteInfo[] = [
    {
      name: 'visual-effects',
      status: 'STALE',
      reason: '32 days old (max: 30)',
      age: 32,
    },
    {
      name: 'focus-detection',
      status: 'MISSING',
      reason: 'No attestation found',
    },
    {
      name: 'unit-tests',
      status: 'VALID',
      reason: 'All checks passed',
      age: 5,
    },
  ]

  describe('positive cases - basic rendering', () => {
    it('should render table with all suites', () => {
      const { lastFrame } = render(<SuiteTable suites={mockSuites} />)
      const output = lastFrame() ?? ''

      // Should contain all suite names
      expect(output).toContain('visual-effects')
      expect(output).toContain('focus-detection')
      expect(output).toContain('unit-tests')
    })

    it('should render table headers', () => {
      const { lastFrame } = render(<SuiteTable suites={mockSuites} />)
      const output = lastFrame() ?? ''

      // Should contain column headers
      expect(output).toContain('Status')
      expect(output).toContain('Suite')
      expect(output).toContain('Reason')
    })

    it('should render status badges for each suite', () => {
      const { lastFrame } = render(<SuiteTable suites={mockSuites} />)
      const output = lastFrame() ?? ''

      // Should contain status text
      expect(output).toContain('STALE')
      expect(output).toContain('MISSING')
      expect(output).toContain('✓ VALID')
    })

    it('should render reasons for each suite', () => {
      const { lastFrame } = render(<SuiteTable suites={mockSuites} />)
      const output = lastFrame() ?? ''

      // Should contain all reason texts
      expect(output).toContain('32 days old (max: 30)')
      expect(output).toContain('No attestation found')
      expect(output).toContain('All checks passed')
    })

    it('should render separator line', () => {
      const { lastFrame } = render(<SuiteTable suites={mockSuites} />)
      const output = lastFrame() ?? ''

      // Should have separator with horizontal line characters
      expect(output).toMatch(/─+/)
    })
  })

  describe('negative cases - edge cases', () => {
    it('should handle empty suite list', () => {
      const { lastFrame } = render(<SuiteTable suites={[]} />)
      const output = lastFrame() ?? ''

      // Should still render headers
      expect(output).toContain('Status')
      expect(output).toContain('Suite')
      expect(output).toContain('Reason')

      // Should still have separator
      expect(output).toMatch(/─+/)
    })

    it('should handle single suite', () => {
      const singleSuite: SuiteInfo[] = [
        {
          name: 'only-suite',
          status: 'VALID',
          reason: 'Test reason',
          age: 1,
        },
      ]

      const { lastFrame } = render(<SuiteTable suites={singleSuite} />)
      const output = lastFrame() ?? ''

      expect(output).toContain('only-suite')
      expect(output).toContain('✓ VALID')
      expect(output).toContain('Test reason')
    })

    it('should handle suite with very long name', () => {
      const longNameSuite: SuiteInfo[] = [
        {
          name: 'this-is-a-very-long-suite-name-that-might-cause-layout-issues',
          status: 'VALID',
          reason: 'Test',
        },
      ]

      const { lastFrame } = render(<SuiteTable suites={longNameSuite} />)
      const output = lastFrame() ?? ''

      // Should contain the full name
      expect(output).toContain('this-is-a-very-long-suite-name-that-might-cause-layout-issues')
    })

    it('should handle suite with very long reason', () => {
      const longReasonSuite: SuiteInfo[] = [
        {
          name: 'test-suite',
          status: 'FINGERPRINT_MISMATCH',
          reason:
            'Fingerprint changed from sha256:abcdef1234567890 to sha256:1234567890abcdef due to modifications in multiple files',
        },
      ]

      const { lastFrame } = render(<SuiteTable suites={longReasonSuite} />)
      const output = lastFrame() ?? ''

      // Should contain the full reason
      expect(output).toContain('Fingerprint changed from sha256:abcdef1234567890')
    })

    it('should handle suite without age', () => {
      const noAgeSuite: SuiteInfo[] = [
        {
          name: 'no-age',
          status: 'MISSING',
          reason: 'Never attested',
        },
      ]

      const { lastFrame } = render(<SuiteTable suites={noAgeSuite} />)
      const output = lastFrame() ?? ''

      expect(output).toContain('no-age')
      expect(output).toContain('MISSING')
      expect(output).toContain('Never attested')
    })
  })

  describe('selectable mode', () => {
    it('should render checkboxes when selectable is true', () => {
      const { lastFrame } = render(
        <SuiteTable suites={mockSuites} selectable={true} selected={new Set()} />,
      )
      const output = lastFrame() ?? ''

      // Should contain unchecked boxes
      expect(output).toContain('[ ]')
    })

    it('should show checked boxes for selected suites', () => {
      const selected = new Set(['visual-effects', 'unit-tests'])
      const { lastFrame } = render(
        <SuiteTable suites={mockSuites} selectable={true} selected={selected} />,
      )
      const output = lastFrame() ?? ''

      // Should contain checked boxes
      expect(output).toContain('[✓]')
      // Should also contain unchecked for the non-selected suite
      expect(output).toContain('[ ]')
    })

    it('should show all checked when all are selected', () => {
      const selected = new Set(['visual-effects', 'focus-detection', 'unit-tests'])
      const { lastFrame } = render(
        <SuiteTable suites={mockSuites} selectable={true} selected={selected} />,
      )
      const output = lastFrame() ?? ''

      // Should contain checked boxes
      expect(output).toContain('[✓]')
      // Count the checked boxes - should be 3
      const checkedCount = (output.match(/\[✓\]/g) ?? []).length
      expect(checkedCount).toBe(3)
    })

    it('should not render checkboxes when selectable is false', () => {
      const { lastFrame } = render(
        <SuiteTable suites={mockSuites} selectable={false} selected={new Set()} />,
      )
      const output = lastFrame() ?? ''

      // Should not contain checkbox characters
      expect(output).not.toContain('[ ]')
      expect(output).not.toContain('[✓]')
    })

    it('should not render checkboxes by default', () => {
      const { lastFrame } = render(<SuiteTable suites={mockSuites} />)
      const output = lastFrame() ?? ''

      // Should not contain checkbox characters
      expect(output).not.toContain('[ ]')
      expect(output).not.toContain('[✓]')
    })
  })

  describe('all verification statuses', () => {
    it('should render all status types correctly', () => {
      const allStatusSuites: SuiteInfo[] = [
        { name: 'valid-suite', status: 'VALID', reason: 'Valid' },
        { name: 'missing-suite', status: 'MISSING', reason: 'Missing' },
        { name: 'changed-suite', status: 'FINGERPRINT_MISMATCH', reason: 'Changed' },
        { name: 'stale-suite', status: 'STALE', reason: 'Stale' },
        { name: 'invalid-suite', status: 'INVALID_SIGNATURE', reason: 'Invalid' },
        { name: 'unauthorized-suite', status: 'UNKNOWN_SIGNER', reason: 'Unauthorized' },
      ]

      const { lastFrame } = render(<SuiteTable suites={allStatusSuites} />)
      const output = lastFrame() ?? ''

      // Check all suite names are present
      expect(output).toContain('valid-suite')
      expect(output).toContain('missing-suite')
      expect(output).toContain('changed-suite')
      expect(output).toContain('stale-suite')
      expect(output).toContain('invalid-suite')
      expect(output).toContain('unauthorized-suite')

      // Check all status displays are present
      expect(output).toContain('✓ VALID')
      expect(output).toContain('MISSING')
      expect(output).toContain('CHANGED')
      expect(output).toContain('STALE')
      expect(output).toContain('INVALID')
      expect(output).toContain('UNAUTHORIZED')
    })
  })

  describe('component lifecycle', () => {
    it('should update when suites change', () => {
      const initial: SuiteInfo[] = [{ name: 'initial-suite', status: 'VALID', reason: 'Initial' }]
      const updated: SuiteInfo[] = [{ name: 'updated-suite', status: 'STALE', reason: 'Updated' }]

      const { lastFrame, rerender } = render(<SuiteTable suites={initial} />)

      expect(lastFrame()).toContain('initial-suite')

      // Update suites
      rerender(<SuiteTable suites={updated} />)

      expect(lastFrame()).toContain('updated-suite')
      expect(lastFrame()).not.toContain('initial-suite')
    })

    it('should update when selection changes', () => {
      const { lastFrame, rerender } = render(
        <SuiteTable suites={mockSuites} selectable={true} selected={new Set()} />,
      )

      // Initially no checked boxes
      expect(lastFrame()).not.toContain('[✓]')

      // Update selection
      rerender(
        <SuiteTable suites={mockSuites} selectable={true} selected={new Set(['visual-effects'])} />,
      )

      // Should now have checked box
      expect(lastFrame()).toContain('[✓]')
    })

    it('should unmount without errors', () => {
      const { unmount } = render(<SuiteTable suites={mockSuites} />)

      // Should not throw
      expect(() => unmount()).not.toThrow()
    })
  })
})
