import { describe, it, expect } from 'vitest'
import * as React from 'react'
import { render } from 'ink-testing-library'
import { Header } from '../../src/components/Header.js'

describe('Header component', () => {
  describe('rendering', () => {
    it('should render header with pending count', () => {
      const { lastFrame } = render(<Header pendingCount={4} />)
      const output = lastFrame() ?? ''

      // Should contain the count
      expect(output).toContain('4')
      expect(output).toContain('suites')
      expect(output).toContain('need')
      expect(output).toContain('attestation')
    })

    it('should use border style', () => {
      const { lastFrame } = render(<Header pendingCount={1} />)
      const output = lastFrame() ?? ''

      // Should have box drawing characters (border)
      expect(output).toMatch(/[┌┐└┘─│]/)
    })
  })

  describe('singular vs plural', () => {
    it('should use singular form for 1 suite', () => {
      const { lastFrame } = render(<Header pendingCount={1} />)
      const output = lastFrame() ?? ''

      // Should say "1 suite needs" not "1 suites need"
      expect(output).toContain('1 suite needs')
      expect(output).not.toContain('suites')
    })

    it('should use plural form for 0 suites', () => {
      const { lastFrame } = render(<Header pendingCount={0} />)
      const output = lastFrame() ?? ''

      expect(output).toContain('0 suites need')
    })

    it('should use plural form for 2 suites', () => {
      const { lastFrame } = render(<Header pendingCount={2} />)
      const output = lastFrame() ?? ''

      expect(output).toContain('2 suites need')
    })

    it('should use plural form for many suites', () => {
      const { lastFrame } = render(<Header pendingCount={100} />)
      const output = lastFrame() ?? ''

      expect(output).toContain('100 suites need')
    })
  })

  describe('edge cases', () => {
    it('should handle zero count', () => {
      const { lastFrame } = render(<Header pendingCount={0} />)
      const output = lastFrame() ?? ''

      expect(output).toContain('0')
      expect(output).toContain('suites')
      expect(output).toContain('need')
    })

    it('should handle large numbers', () => {
      const { lastFrame } = render(<Header pendingCount={999} />)
      const output = lastFrame() ?? ''

      expect(output).toContain('999')
    })

    it('should handle very large numbers', () => {
      const { lastFrame } = render(<Header pendingCount={1000000} />)
      const output = lastFrame() ?? ''

      expect(output).toContain('1000000')
    })
  })

  describe('component lifecycle', () => {
    it('should update when pendingCount changes', () => {
      const { lastFrame, rerender } = render(<Header pendingCount={4} />)

      expect(lastFrame()).toContain('4 suites need')

      // Update the count
      rerender(<Header pendingCount={2} />)

      expect(lastFrame()).toContain('2 suites need')
      expect(lastFrame()).not.toContain('4')
    })

    it('should unmount without errors', () => {
      const { unmount } = render(<Header pendingCount={5} />)

      // Should not throw
      expect(() => {
        unmount()
      }).not.toThrow()
    })
  })
})
