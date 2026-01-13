import { describe, it, expect } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { StatusBadge } from '../../src/components/StatusBadge.js'
import type { VerificationStatus } from '@attest-it/core'

describe('StatusBadge component', () => {
  describe('positive cases - valid statuses', () => {
    it('should render VALID status with checkmark', () => {
      const { lastFrame } = render(<StatusBadge status="VALID" />)
      const output = lastFrame() ?? ''

      expect(output).toContain('✓ VALID')
    })

    it('should render NEEDS_ATTESTATION as MISSING', () => {
      const { lastFrame } = render(<StatusBadge status="NEEDS_ATTESTATION" />)
      const output = lastFrame() ?? ''

      expect(output).toContain('MISSING')
      expect(output).not.toContain('NEEDS_ATTESTATION')
    })

    it('should render FINGERPRINT_CHANGED as CHANGED', () => {
      const { lastFrame } = render(<StatusBadge status="FINGERPRINT_CHANGED" />)
      const output = lastFrame() ?? ''

      expect(output).toContain('CHANGED')
      expect(output).not.toContain('FINGERPRINT_CHANGED')
    })

    it('should render EXPIRED as STALE', () => {
      const { lastFrame } = render(<StatusBadge status="EXPIRED" />)
      const output = lastFrame() ?? ''

      expect(output).toContain('STALE')
      expect(output).not.toContain('EXPIRED')
    })

    it('should render SIGNATURE_INVALID as INVALID', () => {
      const { lastFrame } = render(<StatusBadge status="SIGNATURE_INVALID" />)
      const output = lastFrame() ?? ''

      expect(output).toContain('INVALID')
      expect(output).not.toContain('SIGNATURE_INVALID')
    })

    it('should render INVALIDATED_BY_PARENT as INVALIDATED', () => {
      const { lastFrame } = render(<StatusBadge status="INVALIDATED_BY_PARENT" />)
      const output = lastFrame() ?? ''

      expect(output).toContain('INVALIDATED')
      expect(output).not.toContain('BY_PARENT')
    })
  })

  describe('status display mapping', () => {
    const testCases: Array<{ status: VerificationStatus; expectedText: string }> = [
      { status: 'VALID', expectedText: '✓ VALID' },
      { status: 'NEEDS_ATTESTATION', expectedText: 'MISSING' },
      { status: 'FINGERPRINT_CHANGED', expectedText: 'CHANGED' },
      { status: 'EXPIRED', expectedText: 'STALE' },
      { status: 'SIGNATURE_INVALID', expectedText: 'INVALID' },
      { status: 'INVALIDATED_BY_PARENT', expectedText: 'INVALIDATED' },
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
      rerender(<StatusBadge status="EXPIRED" />)

      expect(lastFrame()).toContain('STALE')
      expect(lastFrame()).not.toContain('✓ VALID')
    })

    it('should update from error to success status', () => {
      const { lastFrame, rerender } = render(<StatusBadge status="SIGNATURE_INVALID" />)

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
    it('should handle all verification statuses', () => {
      const statuses: VerificationStatus[] = [
        'VALID',
        'NEEDS_ATTESTATION',
        'FINGERPRINT_CHANGED',
        'EXPIRED',
        'INVALIDATED_BY_PARENT',
        'SIGNATURE_INVALID',
      ]

      // Should render without errors for all statuses
      statuses.forEach((status) => {
        expect(() => render(<StatusBadge status={status} />)).not.toThrow()
      })
    })
  })
})
