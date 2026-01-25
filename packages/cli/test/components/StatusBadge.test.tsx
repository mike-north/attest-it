import { describe, it, expect } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { StatusBadge } from '../../src/components/StatusBadge.js'
import type { VerificationState } from '@attest-it/core'

describe('StatusBadge component', () => {
  describe('positive cases - valid statuses', () => {
    it('should render VALID status with checkmark', () => {
      const { lastFrame } = render(<StatusBadge status="VALID" />)
      const output = lastFrame() ?? ''

      expect(output).toContain('✓ VALID')
    })

    it('should render MISSING status', () => {
      const { lastFrame } = render(<StatusBadge status="MISSING" />)
      const output = lastFrame() ?? ''

      expect(output).toContain('MISSING')
    })

    it('should render FINGERPRINT_MISMATCH as CHANGED', () => {
      const { lastFrame } = render(<StatusBadge status="FINGERPRINT_MISMATCH" />)
      const output = lastFrame() ?? ''

      expect(output).toContain('CHANGED')
      expect(output).not.toContain('FINGERPRINT_MISMATCH')
    })

    it('should render STALE status', () => {
      const { lastFrame } = render(<StatusBadge status="STALE" />)
      const output = lastFrame() ?? ''

      expect(output).toContain('STALE')
    })

    it('should render INVALID_SIGNATURE as INVALID', () => {
      const { lastFrame } = render(<StatusBadge status="INVALID_SIGNATURE" />)
      const output = lastFrame() ?? ''

      expect(output).toContain('INVALID')
      expect(output).not.toContain('SIGNATURE')
    })

    it('should render UNKNOWN_SIGNER as UNAUTHORIZED', () => {
      const { lastFrame } = render(<StatusBadge status="UNKNOWN_SIGNER" />)
      const output = lastFrame() ?? ''

      expect(output).toContain('UNAUTHORIZED')
      expect(output).not.toContain('UNKNOWN_SIGNER')
    })
  })

  describe('status display mapping', () => {
    const testCases: Array<{ status: VerificationState; expectedText: string }> = [
      { status: 'VALID', expectedText: '✓ VALID' },
      { status: 'MISSING', expectedText: 'MISSING' },
      { status: 'FINGERPRINT_MISMATCH', expectedText: 'CHANGED' },
      { status: 'STALE', expectedText: 'STALE' },
      { status: 'INVALID_SIGNATURE', expectedText: 'INVALID' },
      { status: 'UNKNOWN_SIGNER', expectedText: 'UNAUTHORIZED' },
    ]

    testCases.forEach(({ status, expectedText }) => {
      it(`should map ${status} to "${expectedText}"`, () => {
        const { lastFrame } = render(<StatusBadge status={status} />)
        const output = lastFrame() ?? ''

        expect(output).toContain(expectedText)
      })
    })
  })

  describe('component lifecycle', () => {
    it('should update when status changes', () => {
      const { lastFrame, rerender } = render(<StatusBadge status="VALID" />)

      expect(lastFrame()).toContain('✓ VALID')

      // Update to different status
      rerender(<StatusBadge status="STALE" />)

      expect(lastFrame()).toContain('STALE')
      expect(lastFrame()).not.toContain('✓ VALID')
    })

    it('should update from error to success status', () => {
      const { lastFrame, rerender } = render(<StatusBadge status="INVALID_SIGNATURE" />)

      expect(lastFrame()).toContain('INVALID')

      // Update to valid
      rerender(<StatusBadge status="VALID" />)

      expect(lastFrame()).toContain('✓ VALID')
      expect(lastFrame()).not.toContain('INVALID')
    })

    it('should unmount without errors', () => {
      const { unmount } = render(<StatusBadge status="VALID" />)

      // Should not throw
      expect(() => unmount()).not.toThrow()
    })
  })

  describe('all status values', () => {
    it('should handle all verification states', () => {
      const statuses: VerificationState[] = [
        'VALID',
        'MISSING',
        'FINGERPRINT_MISMATCH',
        'STALE',
        'INVALID_SIGNATURE',
        'UNKNOWN_SIGNER',
      ]

      // Should render without errors for all statuses
      statuses.forEach((status) => {
        expect(() => render(<StatusBadge status={status} />)).not.toThrow()
      })
    })
  })
})
