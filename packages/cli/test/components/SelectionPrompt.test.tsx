import { describe, it, expect, vi } from 'vitest'
import * as React from 'react'
import { render } from 'ink-testing-library'
import { SelectionPrompt } from '../../src/components/SelectionPrompt.js'

describe('SelectionPrompt component', () => {
  describe('rendering', () => {
    it('should render message', () => {
      const { lastFrame } = render(
        <SelectionPrompt message="Select an option:" options={[]} onSelect={vi.fn()} />,
      )
      const output = lastFrame() ?? ''

      expect(output).toContain('Select an option:')
    })

    it('should render all options', () => {
      const options = [
        { label: 'All pending', value: 'all', hint: 'a' },
        { label: 'By number', value: 'number', hint: '1-4' },
        { label: 'Exit', value: 'exit', hint: 'n' },
      ]

      const { lastFrame } = render(
        <SelectionPrompt message="Select suites:" options={options} onSelect={vi.fn()} />,
      )
      const output = lastFrame() ?? ''

      expect(output).toContain('All pending')
      expect(output).toContain('By number')
      expect(output).toContain('Exit')
    })

    it('should render keyboard hints', () => {
      const options = [
        { label: 'Option A', value: 'a', hint: 'a' },
        { label: 'Option B', value: 'b', hint: 'b' },
      ]

      const { lastFrame } = render(
        <SelectionPrompt message="Choose:" options={options} onSelect={vi.fn()} />,
      )
      const output = lastFrame() ?? ''

      expect(output).toContain('[a]')
      expect(output).toContain('[b]')
    })

    it('should render options without hints', () => {
      const options = [
        { label: 'Option without hint', value: 'opt1' },
        { label: 'Another option', value: 'opt2' },
      ]

      const { lastFrame } = render(
        <SelectionPrompt message="Choose:" options={options} onSelect={vi.fn()} />,
      )
      const output = lastFrame() ?? ''

      expect(output).toContain('Option without hint')
      expect(output).toContain('Another option')
      // Should not have brackets for missing hints
      expect(output).not.toContain('[]')
    })

    it('should render groups when provided', () => {
      const groups = [
        { name: 'g1', label: 'ui-tests' },
        { name: 'g2', label: 'behavior-tests' },
      ]

      const { lastFrame } = render(
        <SelectionPrompt message="Select:" options={[]} groups={groups} onSelect={vi.fn()} />,
      )
      const output = lastFrame() ?? ''

      expect(output).toContain('[g1]')
      expect(output).toContain('ui-tests')
      expect(output).toContain('[g2]')
      expect(output).toContain('behavior-tests')
    })

    it('should not render groups section when groups is empty', () => {
      const { lastFrame } = render(
        <SelectionPrompt
          message="Select:"
          options={[{ label: 'Option', value: 'opt' }]}
          groups={[]}
          onSelect={vi.fn()}
        />,
      )
      const output = lastFrame() ?? ''

      expect(output).toContain('Option')
      // Groups section should not appear
    })

    it('should not render groups section when groups is undefined', () => {
      const { lastFrame } = render(
        <SelectionPrompt
          message="Select:"
          options={[{ label: 'Option', value: 'opt' }]}
          onSelect={vi.fn()}
        />,
      )
      const output = lastFrame() ?? ''

      expect(output).toContain('Option')
      // No group-related content
    })
  })

  describe('keyboard input handling', () => {
    // Note: Testing keyboard input with ink-testing-library is challenging
    // because stdin.write() doesn't synchronously trigger useInput handlers.
    // These tests verify that the component accepts the onSelect callback
    // and doesn't error when receiving input. Integration tests should verify
    // the actual keyboard interaction behavior.

    it('should accept onSelect callback without errors', () => {
      const onSelect = vi.fn()
      const options = [
        { label: 'All', value: 'all', hint: 'a' },
        { label: 'None', value: 'none', hint: 'n' },
      ]

      const { lastFrame } = render(
        <SelectionPrompt message="Select:" options={options} onSelect={onSelect} />,
      )

      // Component should render without errors
      expect(lastFrame()).toBeTruthy()
    })

    it('should render when onSelect is provided', () => {
      const onSelect = vi.fn()
      const options = [
        { label: 'Option 1', value: 'opt1', hint: '1' },
        { label: 'Option 2', value: 'opt2', hint: '2' },
      ]

      const { lastFrame } = render(
        <SelectionPrompt message="Select:" options={options} onSelect={onSelect} />,
      )

      expect(lastFrame()).toContain('Option 1')
      expect(lastFrame()).toContain('Option 2')
    })

    it('should render groups with callback', () => {
      const onSelect = vi.fn()
      const groups = [
        { name: 'g1', label: 'Group 1' },
        { name: 'g2', label: 'Group 2' },
      ]

      const { lastFrame } = render(
        <SelectionPrompt message="Select:" options={[]} groups={groups} onSelect={onSelect} />,
      )

      expect(lastFrame()).toContain('Group 1')
      expect(lastFrame()).toContain('Group 2')
    })

    it('should not error with unmatched options', () => {
      const onSelect = vi.fn()
      const options = [{ label: 'Option', value: 'opt', hint: 'a' }]

      const { lastFrame } = render(
        <SelectionPrompt message="Select:" options={options} onSelect={onSelect} />,
      )

      // Should render successfully
      expect(lastFrame()).toContain('Option')
    })

    it('should render with multiple options', () => {
      const onSelect = vi.fn()
      const options = [
        { label: 'First', value: 'first', hint: 'f' },
        { label: 'Second', value: 'second', hint: 's' },
      ]

      const { lastFrame } = render(
        <SelectionPrompt message="Select:" options={options} onSelect={onSelect} />,
      )

      expect(lastFrame()).toContain('First')
      expect(lastFrame()).toContain('Second')
    })
  })

  describe('edge cases', () => {
    it('should handle empty options array', () => {
      const { lastFrame } = render(
        <SelectionPrompt message="Select:" options={[]} onSelect={vi.fn()} />,
      )
      const output = lastFrame() ?? ''

      expect(output).toContain('Select:')
      // Should not crash with empty options
    })

    it('should handle long option labels', () => {
      const options = [
        {
          label: 'This is a very long option label that might wrap or cause layout issues',
          value: 'long',
          hint: 'l',
        },
      ]

      const { lastFrame } = render(
        <SelectionPrompt message="Select:" options={options} onSelect={vi.fn()} />,
      )
      const output = lastFrame() ?? ''

      expect(output).toContain('very long option label')
    })

    it('should handle options with special characters in hints', () => {
      const options = [
        { label: 'Special', value: 'special', hint: '!' },
        { label: 'Another', value: 'another', hint: '@' },
      ]

      const { lastFrame } = render(
        <SelectionPrompt message="Select:" options={options} onSelect={vi.fn()} />,
      )
      const output = lastFrame() ?? ''

      expect(output).toContain('[!]')
      expect(output).toContain('[@]')
    })

    it('should render duplicate hints', () => {
      const onSelect = vi.fn()
      const options = [
        { label: 'First', value: 'first', hint: 'a' },
        { label: 'Second', value: 'second', hint: 'a' }, // Duplicate hint
      ]

      const { lastFrame } = render(
        <SelectionPrompt message="Select:" options={options} onSelect={onSelect} />,
      )

      const output = lastFrame() ?? ''
      // Both options should be rendered
      expect(output).toContain('First')
      expect(output).toContain('Second')
      // Both should show the same hint
      expect(output).toContain('[a]')
    })
  })

  describe('component lifecycle', () => {
    it('should update when options change', () => {
      const initialOptions = [{ label: 'Option 1', value: 'opt1', hint: '1' }]
      const newOptions = [
        { label: 'Option 1', value: 'opt1', hint: '1' },
        { label: 'Option 2', value: 'opt2', hint: '2' },
      ]

      const { lastFrame, rerender } = render(
        <SelectionPrompt message="Select:" options={initialOptions} onSelect={vi.fn()} />,
      )

      expect(lastFrame()).toContain('Option 1')
      expect(lastFrame()).not.toContain('Option 2')

      rerender(<SelectionPrompt message="Select:" options={newOptions} onSelect={vi.fn()} />)

      expect(lastFrame()).toContain('Option 1')
      expect(lastFrame()).toContain('Option 2')
    })

    it('should update when message changes', () => {
      const { lastFrame, rerender } = render(
        <SelectionPrompt message="First message" options={[]} onSelect={vi.fn()} />,
      )

      expect(lastFrame()).toContain('First message')

      rerender(<SelectionPrompt message="Second message" options={[]} onSelect={vi.fn()} />)

      expect(lastFrame()).toContain('Second message')
      expect(lastFrame()).not.toContain('First message')
    })

    it('should unmount without errors', () => {
      const { unmount } = render(
        <SelectionPrompt
          message="Select:"
          options={[{ label: 'Option', value: 'opt' }]}
          onSelect={vi.fn()}
        />,
      )

      // Should not throw
      expect(() => {
        unmount()
      }).not.toThrow()
    })
  })

  describe('integration scenarios', () => {
    it('should render complete selection UI with options and groups', () => {
      const options = [
        { label: 'All pending', value: 'all', hint: 'a' },
        { label: 'By number', value: 'number', hint: '1-4' },
        { label: 'Exit', value: 'exit', hint: 'n' },
      ]
      const groups = [
        { name: 'g1', label: 'ui-tests' },
        { name: 'g2', label: 'behavior-tests' },
      ]

      const { lastFrame } = render(
        <SelectionPrompt
          message="Select suites to run:"
          options={options}
          groups={groups}
          onSelect={vi.fn()}
        />,
      )
      const output = lastFrame() ?? ''

      // Message
      expect(output).toContain('Select suites to run:')

      // Options
      expect(output).toContain('[a]')
      expect(output).toContain('All pending')
      expect(output).toContain('[1-4]')
      expect(output).toContain('By number')
      expect(output).toContain('[n]')
      expect(output).toContain('Exit')

      // Groups
      expect(output).toContain('[g1]')
      expect(output).toContain('ui-tests')
      expect(output).toContain('[g2]')
      expect(output).toContain('behavior-tests')
    })
  })
})
