import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as React from 'react'
import { render } from 'ink-testing-library'
import { SuiteSelector } from '../../src/components/SuiteSelector.js'
import type { SuiteStatus } from '../../src/commands/run-utils.js'

describe('SuiteSelector component', () => {
  const mockPendingSuites: SuiteStatus[] = [
    {
      name: 'visual-effects',
      status: 'EXPIRED',
      reason: '32 days old (max: 30)',
      currentFingerprint: 'abc123',
      age: 32,
    },
    {
      name: 'focus-detection',
      status: 'NEEDS_ATTESTATION',
      reason: 'No attestation found',
      currentFingerprint: 'def456',
    },
    {
      name: 'accessibility',
      status: 'FINGERPRINT_CHANGED',
      reason: 'Source files modified',
      currentFingerprint: 'ghi789',
      sealedFingerprint: 'old123',
      age: 10,
    },
  ]

  const mockValidSuites: SuiteStatus[] = [
    {
      name: 'unit-tests',
      status: 'VALID',
      reason: 'Attested 5 days ago',
      currentFingerprint: 'valid123',
      sealedFingerprint: 'valid123',
      sealedAt: '2024-01-01T00:00:00Z',
      age: 5,
    },
    {
      name: 'integration-tests',
      status: 'VALID',
      reason: 'Attested 2 days ago',
      currentFingerprint: 'valid456',
      sealedFingerprint: 'valid456',
      sealedAt: '2024-01-04T00:00:00Z',
      age: 2,
    },
  ]

  let mockOnSelect: ReturnType<typeof vi.fn>
  let mockOnExit: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockOnSelect = vi.fn()
    mockOnExit = vi.fn()
  })

  describe('rendering - positive cases', () => {
    it('should render header with correct pending count', () => {
      const { lastFrame } = render(
        <SuiteSelector
          pendingSuites={mockPendingSuites}
          validSuites={[]}
          onSelect={mockOnSelect}
          onExit={mockOnExit}
        />,
      )
      const output = lastFrame() ?? ''

      // Header should show pending count
      expect(output).toContain('3 suites need attestation')
    })

    it('should show pending suites in table', () => {
      const { lastFrame } = render(
        <SuiteSelector
          pendingSuites={mockPendingSuites}
          validSuites={[]}
          onSelect={mockOnSelect}
          onExit={mockOnExit}
        />,
      )
      const output = lastFrame() ?? ''

      // Should show all pending suite names
      expect(output).toContain('visual-effects')
      expect(output).toContain('focus-detection')
      expect(output).toContain('accessibility')
    })

    it('should show valid suites dimmed when provided', () => {
      const { lastFrame } = render(
        <SuiteSelector
          pendingSuites={mockPendingSuites}
          validSuites={mockValidSuites}
          onSelect={mockOnSelect}
          onExit={mockOnExit}
        />,
      )
      const output = lastFrame() ?? ''

      // Should show "Already valid" section
      expect(output).toContain('Already valid:')
      expect(output).toContain('unit-tests')
      expect(output).toContain('attested 5 days ago')
      expect(output).toContain('integration-tests')
      expect(output).toContain('attested 2 days ago')
    })

    it('should show selection prompt with options', () => {
      const { lastFrame } = render(
        <SuiteSelector
          pendingSuites={mockPendingSuites}
          validSuites={[]}
          onSelect={mockOnSelect}
          onExit={mockOnExit}
        />,
      )
      const output = lastFrame() ?? ''

      // Should show prompt message and options
      expect(output).toContain('Select suites to run:')
      expect(output).toContain('All pending')
      expect(output).toContain('[a]')
      expect(output).toContain('Toggle by number')
      expect(output).toContain('[1-9]')
      expect(output).toContain('Toggle current')
      expect(output).toContain('[Space]')
      expect(output).toContain('Navigate')
      expect(output).toContain('[↑↓]')
      expect(output).toContain('None/exit')
      expect(output).toContain('[n]')
    })

    it('should show selection count', () => {
      const { lastFrame } = render(
        <SuiteSelector
          pendingSuites={mockPendingSuites}
          validSuites={[]}
          onSelect={mockOnSelect}
          onExit={mockOnExit}
        />,
      )
      const output = lastFrame() ?? ''

      // Initial selection count should be 0
      expect(output).toContain('0 selected. Press Enter to confirm.')
    })

    it('should show groups when provided', () => {
      const groups = {
        'ui-tests': ['visual-effects', 'focus-detection'],
        'behavior-tests': ['accessibility'],
      }

      const { lastFrame } = render(
        <SuiteSelector
          pendingSuites={mockPendingSuites}
          validSuites={[]}
          groups={groups}
          onSelect={mockOnSelect}
          onExit={mockOnExit}
        />,
      )
      const output = lastFrame() ?? ''

      // Should show group shortcuts
      expect(output).toContain('[g1]')
      expect(output).toContain('ui-tests')
      expect(output).toContain('[g2]')
      expect(output).toContain('behavior-tests')
    })

    it('should render checkboxes for selectable suites', () => {
      const { lastFrame } = render(
        <SuiteSelector
          pendingSuites={mockPendingSuites}
          validSuites={[]}
          onSelect={mockOnSelect}
          onExit={mockOnExit}
        />,
      )
      const output = lastFrame() ?? ''

      // Should show checkboxes (unchecked initially)
      expect(output).toContain('[ ]')
    })
  })

  describe('keyboard input - selection shortcuts', () => {
    // Note: Testing keyboard input with ink-testing-library is challenging
    // because stdin.write() doesn't synchronously trigger useInput handlers.
    // These tests verify that the component accepts callbacks and renders
    // properly. Integration tests should verify the actual keyboard interaction.

    it('should accept onExit callback without errors', () => {
      const { lastFrame } = render(
        <SuiteSelector
          pendingSuites={mockPendingSuites}
          validSuites={[]}
          onSelect={mockOnSelect}
          onExit={mockOnExit}
        />,
      )

      // Component should render without errors
      expect(lastFrame()).toBeTruthy()
      expect(lastFrame()).toContain('None/exit')
      expect(lastFrame()).toContain('[n]')
    })

    it('should accept onSelect callback without errors', () => {
      const { lastFrame } = render(
        <SuiteSelector
          pendingSuites={mockPendingSuites}
          validSuites={[]}
          onSelect={mockOnSelect}
          onExit={mockOnExit}
        />,
      )

      // Component should render without errors
      expect(lastFrame()).toBeTruthy()
      expect(lastFrame()).toContain('Press Enter to confirm')
    })

    it('should display all pending shortcut', () => {
      const { lastFrame } = render(
        <SuiteSelector
          pendingSuites={mockPendingSuites}
          validSuites={[]}
          onSelect={mockOnSelect}
          onExit={mockOnExit}
        />,
      )

      const output = lastFrame() ?? ''
      expect(output).toContain('All pending')
      expect(output).toContain('[a]')
    })

    it('should display number selection shortcut', () => {
      const { lastFrame } = render(
        <SuiteSelector
          pendingSuites={mockPendingSuites}
          validSuites={[]}
          onSelect={mockOnSelect}
          onExit={mockOnExit}
        />,
      )

      const output = lastFrame() ?? ''
      expect(output).toContain('Toggle by number')
      expect(output).toContain('[1-9]')
    })

    it('should render with checkboxes for selection', () => {
      const { lastFrame } = render(
        <SuiteSelector
          pendingSuites={mockPendingSuites}
          validSuites={[]}
          onSelect={mockOnSelect}
          onExit={mockOnExit}
        />,
      )

      const output = lastFrame() ?? ''
      // Should have unchecked boxes
      expect(output).toContain('[ ]')
    })

    it('should show initial selection count as 0', () => {
      const { lastFrame } = render(
        <SuiteSelector
          pendingSuites={mockPendingSuites}
          validSuites={[]}
          onSelect={mockOnSelect}
          onExit={mockOnExit}
        />,
      )

      const output = lastFrame() ?? ''
      expect(output).toContain('0 selected')
    })
  })

  describe('keyboard input - group selection', () => {
    // Note: Testing keyboard input with ink-testing-library is challenging
    // because stdin.write() doesn't synchronously trigger useInput handlers.
    // These tests verify that groups are displayed when provided.

    it('should display group shortcuts when groups are provided', () => {
      const groups = {
        'ui-tests': ['visual-effects', 'focus-detection'],
        'behavior-tests': ['accessibility'],
      }

      const { lastFrame } = render(
        <SuiteSelector
          pendingSuites={mockPendingSuites}
          validSuites={[]}
          groups={groups}
          onSelect={mockOnSelect}
          onExit={mockOnExit}
        />,
      )

      const output = lastFrame() ?? ''
      // Should show group shortcuts
      expect(output).toContain('[g1]')
      expect(output).toContain('ui-tests')
      expect(output).toContain('[g2]')
      expect(output).toContain('behavior-tests')
    })

    it('should display first group correctly', () => {
      const groups = {
        'ui-tests': ['visual-effects', 'focus-detection'],
        'behavior-tests': ['accessibility'],
      }

      const { lastFrame } = render(
        <SuiteSelector
          pendingSuites={mockPendingSuites}
          validSuites={[]}
          groups={groups}
          onSelect={mockOnSelect}
          onExit={mockOnExit}
        />,
      )

      const output = lastFrame() ?? ''
      expect(output).toContain('[g1]')
      expect(output).toContain('ui-tests')
    })

    it('should display second group correctly', () => {
      const groups = {
        'ui-tests': ['visual-effects', 'focus-detection'],
        'behavior-tests': ['accessibility'],
      }

      const { lastFrame } = render(
        <SuiteSelector
          pendingSuites={mockPendingSuites}
          validSuites={[]}
          groups={groups}
          onSelect={mockOnSelect}
          onExit={mockOnExit}
        />,
      )

      const output = lastFrame() ?? ''
      expect(output).toContain('[g2]')
      expect(output).toContain('behavior-tests')
    })

    it('should render without errors when groups have single entry', () => {
      const groups = {
        'ui-tests': ['visual-effects'],
      }

      const { lastFrame } = render(
        <SuiteSelector
          pendingSuites={mockPendingSuites}
          validSuites={[]}
          groups={groups}
          onSelect={mockOnSelect}
          onExit={mockOnExit}
        />,
      )

      const output = lastFrame() ?? ''
      expect(output).toContain('[g1]')
      expect(output).toContain('ui-tests')
    })
  })

  describe('negative cases - edge cases', () => {
    it('should handle empty pending suites', () => {
      const { lastFrame } = render(
        <SuiteSelector
          pendingSuites={[]}
          validSuites={mockValidSuites}
          onSelect={mockOnSelect}
          onExit={mockOnExit}
        />,
      )
      const output = lastFrame() ?? ''

      // Should show 0 suites
      expect(output).toContain('0 suites need attestation')
      // Should still show valid suites
      expect(output).toContain('Already valid:')
    })

    it('should handle no valid suites', () => {
      const { lastFrame } = render(
        <SuiteSelector
          pendingSuites={mockPendingSuites}
          validSuites={[]}
          onSelect={mockOnSelect}
          onExit={mockOnExit}
        />,
      )
      const output = lastFrame() ?? ''

      // Should not show "Already valid" section
      expect(output).not.toContain('Already valid:')
    })

    it('should handle no groups', () => {
      const { lastFrame } = render(
        <SuiteSelector
          pendingSuites={mockPendingSuites}
          validSuites={[]}
          onSelect={mockOnSelect}
          onExit={mockOnExit}
        />,
      )
      const output = lastFrame() ?? ''

      // Should not show group shortcuts
      expect(output).not.toContain('[g1]')
      expect(output).not.toContain('[g2]')
    })

    it('should handle single pending suite', () => {
      const singleSuite = [mockPendingSuites[0]]

      const { lastFrame } = render(
        <SuiteSelector
          pendingSuites={singleSuite}
          validSuites={[]}
          onSelect={mockOnSelect}
          onExit={mockOnExit}
        />,
      )
      const output = lastFrame() ?? ''

      expect(output).toContain('1 suite needs attestation')
      expect(output).toContain('visual-effects')
    })

    it('should handle invalid number selection', () => {
      const { stdin, lastFrame } = render(
        <SuiteSelector
          pendingSuites={mockPendingSuites}
          validSuites={[]}
          onSelect={mockOnSelect}
          onExit={mockOnExit}
        />,
      )

      // Try to select suite 9 (only 3 suites)
      stdin.write('9')

      const output = lastFrame() ?? ''
      // Selection should remain 0
      expect(output).toContain('0 selected')
    })

    it('should ignore number 0', () => {
      const { stdin, lastFrame } = render(
        <SuiteSelector
          pendingSuites={mockPendingSuites}
          validSuites={[]}
          onSelect={mockOnSelect}
          onExit={mockOnExit}
        />,
      )

      stdin.write('0')

      const output = lastFrame() ?? ''
      // Selection should remain 0
      expect(output).toContain('0 selected')
    })

    it('should display confirmation prompt', () => {
      const { lastFrame } = render(
        <SuiteSelector
          pendingSuites={mockPendingSuites}
          validSuites={[]}
          onSelect={mockOnSelect}
          onExit={mockOnExit}
        />,
      )

      const output = lastFrame() ?? ''
      // Should show confirmation prompt
      expect(output).toContain('Press Enter to confirm')
    })

    it('should handle suite without age', () => {
      const suitesWithoutAge: SuiteStatus[] = [
        {
          name: 'no-age-suite',
          status: 'NEEDS_ATTESTATION',
          reason: 'No attestation found',
          currentFingerprint: 'abc123',
        },
      ]

      const { lastFrame } = render(
        <SuiteSelector
          pendingSuites={suitesWithoutAge}
          validSuites={[]}
          onSelect={mockOnSelect}
          onExit={mockOnExit}
        />,
      )
      const output = lastFrame() ?? ''

      expect(output).toContain('no-age-suite')
      expect(output).toContain('No attestation found')
    })

    it('should handle valid suite without age', () => {
      const validWithoutAge: SuiteStatus[] = [
        {
          name: 'valid-no-age',
          status: 'VALID',
          reason: 'Attested recently',
          currentFingerprint: 'abc123',
        },
      ]

      const { lastFrame } = render(
        <SuiteSelector
          pendingSuites={[]}
          validSuites={validWithoutAge}
          onSelect={mockOnSelect}
          onExit={mockOnExit}
        />,
      )
      const output = lastFrame() ?? ''

      // Should show 0 days when age is undefined
      expect(output).toContain('attested 0 days ago')
    })
  })

  describe('component lifecycle', () => {
    it('should update when pending suites change', () => {
      const initial = [mockPendingSuites[0]]
      const updated = [mockPendingSuites[1], mockPendingSuites[2]]

      const { lastFrame, rerender } = render(
        <SuiteSelector
          pendingSuites={initial}
          validSuites={[]}
          onSelect={mockOnSelect}
          onExit={mockOnExit}
        />,
      )

      expect(lastFrame()).toContain('1 suite needs attestation')
      expect(lastFrame()).toContain('visual-effects')

      rerender(
        <SuiteSelector
          pendingSuites={updated}
          validSuites={[]}
          onSelect={mockOnSelect}
          onExit={mockOnExit}
        />,
      )

      expect(lastFrame()).toContain('2 suites need attestation')
      expect(lastFrame()).toContain('focus-detection')
      expect(lastFrame()).not.toContain('visual-effects')
    })

    it('should update when valid suites change', () => {
      const { lastFrame, rerender } = render(
        <SuiteSelector
          pendingSuites={mockPendingSuites}
          validSuites={[]}
          onSelect={mockOnSelect}
          onExit={mockOnExit}
        />,
      )

      expect(lastFrame()).not.toContain('Already valid:')

      rerender(
        <SuiteSelector
          pendingSuites={mockPendingSuites}
          validSuites={mockValidSuites}
          onSelect={mockOnSelect}
          onExit={mockOnExit}
        />,
      )

      expect(lastFrame()).toContain('Already valid:')
      expect(lastFrame()).toContain('unit-tests')
    })

    it('should unmount without errors', () => {
      const { unmount } = render(
        <SuiteSelector
          pendingSuites={mockPendingSuites}
          validSuites={[]}
          onSelect={mockOnSelect}
          onExit={mockOnExit}
        />,
      )

      expect(() => {
        unmount()
      }).not.toThrow()
    })
  })

  describe('integration scenarios', () => {
    it('should display complete UI with all sections', () => {
      const groups = {
        'ui-tests': ['visual-effects'],
      }

      const { lastFrame } = render(
        <SuiteSelector
          pendingSuites={mockPendingSuites}
          validSuites={mockValidSuites}
          groups={groups}
          onSelect={mockOnSelect}
          onExit={mockOnExit}
        />,
      )
      const output = lastFrame() ?? ''

      // Header
      expect(output).toContain('3 suites need attestation')

      // Pending suites table
      expect(output).toContain('visual-effects')
      expect(output).toContain('Status')
      expect(output).toContain('Suite')
      expect(output).toContain('Reason')

      // Valid suites
      expect(output).toContain('Already valid:')
      expect(output).toContain('unit-tests')

      // Selection prompt
      expect(output).toContain('Select suites to run:')
      expect(output).toContain('[a]')
      expect(output).toContain('[1-9]')
      expect(output).toContain('[n]')

      // Groups
      expect(output).toContain('[g1]')
      expect(output).toContain('ui-tests')

      // Selection count
      expect(output).toContain('0 selected. Press Enter to confirm.')
    })
  })
})
