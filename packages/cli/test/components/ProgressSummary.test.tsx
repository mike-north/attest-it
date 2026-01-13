import { describe, it, expect } from 'vitest'
import * as React from 'react'
import { render } from 'ink-testing-library'
import { ProgressSummary } from '../../src/components/ProgressSummary.js'

describe('ProgressSummary component', () => {
  describe('rendering', () => {
    it('should render all progress metrics', () => {
      const { lastFrame } = render(
        <ProgressSummary completed={2} remaining={3} failed={1} skipped={0} />,
      )
      const output = lastFrame() ?? ''

      expect(output).toContain('Completed')
      expect(output).toContain('Remaining')
      expect(output).toContain('Failed')
      expect(output).toContain('Skipped')
    })

    it('should display correct values', () => {
      const { lastFrame } = render(
        <ProgressSummary completed={5} remaining={10} failed={2} skipped={3} />,
      )
      const output = lastFrame() ?? ''

      expect(output).toContain('5')
      expect(output).toContain('10')
      expect(output).toContain('2')
      expect(output).toContain('3')
    })

    it('should use border style', () => {
      const { lastFrame } = render(
        <ProgressSummary completed={0} remaining={0} failed={0} skipped={0} />,
      )
      const output = lastFrame() ?? ''

      // Should have box drawing characters (border)
      expect(output).toMatch(/[┌┐└┘─│]/)
    })
  })

  describe('zero values', () => {
    it('should handle all zeros', () => {
      const { lastFrame } = render(
        <ProgressSummary completed={0} remaining={0} failed={0} skipped={0} />,
      )
      const output = lastFrame() ?? ''

      expect(output).toContain('Completed: 0')
      expect(output).toContain('Remaining: 0')
      expect(output).toContain('Failed: 0')
      expect(output).toContain('Skipped: 0')
    })

    it('should handle some zeros', () => {
      const { lastFrame } = render(
        <ProgressSummary completed={5} remaining={0} failed={0} skipped={2} />,
      )
      const output = lastFrame() ?? ''

      expect(output).toContain('Completed: 5')
      expect(output).toContain('Remaining: 0')
      expect(output).toContain('Failed: 0')
      expect(output).toContain('Skipped: 2')
    })
  })

  describe('edge cases', () => {
    it('should handle large numbers', () => {
      const { lastFrame } = render(
        <ProgressSummary completed={999} remaining={1000} failed={50} skipped={25} />,
      )
      const output = lastFrame() ?? ''

      expect(output).toContain('999')
      expect(output).toContain('1000')
      expect(output).toContain('50')
      expect(output).toContain('25')
    })

    it('should handle very large numbers', () => {
      const { lastFrame } = render(
        <ProgressSummary completed={1000000} remaining={2000000} failed={100000} skipped={50000} />,
      )
      const output = lastFrame() ?? ''

      expect(output).toContain('1000000')
      expect(output).toContain('2000000')
      expect(output).toContain('100000')
      expect(output).toContain('50000')
    })
  })

  describe('typical scenarios', () => {
    it('should display progress in the middle of a run', () => {
      // Typical in-progress state
      const { lastFrame } = render(
        <ProgressSummary completed={3} remaining={5} failed={1} skipped={1} />,
      )
      const output = lastFrame() ?? ''

      expect(output).toContain('Completed: 3')
      expect(output).toContain('Remaining: 5')
      expect(output).toContain('Failed: 1')
      expect(output).toContain('Skipped: 1')
    })

    it('should display successful completion', () => {
      // All completed successfully
      const { lastFrame } = render(
        <ProgressSummary completed={10} remaining={0} failed={0} skipped={0} />,
      )
      const output = lastFrame() ?? ''

      expect(output).toContain('Completed: 10')
      expect(output).toContain('Remaining: 0')
      expect(output).toContain('Failed: 0')
    })

    it('should display state with failures', () => {
      // Run completed with some failures
      const { lastFrame } = render(
        <ProgressSummary completed={8} remaining={0} failed={2} skipped={0} />,
      )
      const output = lastFrame() ?? ''

      expect(output).toContain('Completed: 8')
      expect(output).toContain('Failed: 2')
    })

    it('should display state with skipped tests', () => {
      // User skipped some tests
      const { lastFrame } = render(
        <ProgressSummary completed={5} remaining={2} failed={0} skipped={3} />,
      )
      const output = lastFrame() ?? ''

      expect(output).toContain('Completed: 5')
      expect(output).toContain('Skipped: 3')
    })
  })

  describe('component lifecycle', () => {
    it('should update when values change', () => {
      const { lastFrame, rerender } = render(
        <ProgressSummary completed={1} remaining={9} failed={0} skipped={0} />,
      )

      expect(lastFrame()).toContain('Completed: 1')
      expect(lastFrame()).toContain('Remaining: 9')

      // Simulate progress
      rerender(<ProgressSummary completed={5} remaining={5} failed={0} skipped={0} />)

      expect(lastFrame()).toContain('Completed: 5')
      expect(lastFrame()).toContain('Remaining: 5')
    })

    it('should update when failures occur', () => {
      const { lastFrame, rerender } = render(
        <ProgressSummary completed={3} remaining={7} failed={0} skipped={0} />,
      )

      expect(lastFrame()).toContain('Failed: 0')

      // A test fails
      rerender(<ProgressSummary completed={3} remaining={6} failed={1} skipped={0} />)

      expect(lastFrame()).toContain('Failed: 1')
    })

    it('should unmount without errors', () => {
      const { unmount } = render(
        <ProgressSummary completed={5} remaining={5} failed={0} skipped={0} />,
      )

      // Should not throw
      expect(() => {
        unmount()
      }).not.toThrow()
    })
  })
})
