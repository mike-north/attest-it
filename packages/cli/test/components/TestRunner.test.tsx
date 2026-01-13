import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as React from 'react'
import { render, type RenderOptions } from 'ink-testing-library'
import { TestRunner, type RunResults } from '../../src/components/TestRunner.js'

describe('TestRunner component', () => {
  let executeTest: ReturnType<typeof vi.fn>
  let createAttestation: ReturnType<typeof vi.fn>
  let onComplete: ReturnType<typeof vi.fn>

  beforeEach(() => {
    executeTest = vi.fn()
    createAttestation = vi.fn()
    onComplete = vi.fn()
  })

  describe('initial rendering', () => {
    it('should show spinner while running first test', async () => {
      executeTest.mockReturnValue(new Promise(() => {})) // Never resolves

      const { lastFrame } = render(
        <TestRunner
          suites={['test-suite-1']}
          executeTest={executeTest}
          createAttestation={createAttestation}
          onComplete={onComplete}
        />,
      )

      // Wait for effect to run
      await new Promise((resolve) => setTimeout(resolve, 0))

      const output = lastFrame() ?? ''
      expect(output).toContain('Running test-suite-1')
      expect(executeTest).toHaveBeenCalledWith('test-suite-1')
    })

    it('should display progress summary on start', () => {
      executeTest.mockReturnValue(new Promise(() => {}))

      const { lastFrame } = render(
        <TestRunner
          suites={['suite-1', 'suite-2', 'suite-3']}
          executeTest={executeTest}
          createAttestation={createAttestation}
          onComplete={onComplete}
        />,
      )

      const output = lastFrame() ?? ''
      expect(output).toContain('Completed: 0')
      expect(output).toContain('Remaining: 3')
      expect(output).toContain('Failed: 0')
      expect(output).toContain('Skipped: 0')
    })
  })

  describe('test execution', () => {
    it('should execute test when component mounts', async () => {
      executeTest.mockResolvedValue(true)

      render(
        <TestRunner
          suites={['test-suite-1']}
          executeTest={executeTest}
          createAttestation={createAttestation}
          onComplete={onComplete}
        />,
      )

      // Wait for next tick
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(executeTest).toHaveBeenCalledWith('test-suite-1')
      expect(executeTest).toHaveBeenCalledTimes(1)
    })

    it('should show confirmation prompt after test passes', async () => {
      executeTest.mockResolvedValue(true)

      const { lastFrame } = render(
        <TestRunner
          suites={['test-suite-1']}
          executeTest={executeTest}
          createAttestation={createAttestation}
          onComplete={onComplete}
        />,
      )

      // Wait for test to complete
      await new Promise((resolve) => setTimeout(resolve, 10))

      const output = lastFrame() ?? ''
      expect(output).toContain('Tests passed')
      expect(output).toContain('Create attestation for test-suite-1')
      expect(output).toContain('[Y/n]')
    })

    it('should move to next suite after test failure', async () => {
      executeTest.mockResolvedValueOnce(false).mockResolvedValueOnce(true)

      const { lastFrame } = render(
        <TestRunner
          suites={['failing-suite', 'passing-suite']}
          executeTest={executeTest}
          createAttestation={createAttestation}
          onComplete={onComplete}
        />,
      )

      // Wait for first test to complete and second to start
      await new Promise((resolve) => setTimeout(resolve, 20))

      expect(executeTest).toHaveBeenCalledWith('failing-suite')
      expect(executeTest).toHaveBeenCalledWith('passing-suite')

      const output = lastFrame() ?? ''
      expect(output).toContain('passing-suite')
    })

    it('should handle execution errors gracefully', async () => {
      executeTest
        .mockRejectedValueOnce(new Error('Test execution failed'))
        .mockResolvedValueOnce(true)

      const { lastFrame } = render(
        <TestRunner
          suites={['error-suite', 'success-suite']}
          executeTest={executeTest}
          createAttestation={createAttestation}
          onComplete={onComplete}
        />,
      )

      // Wait for error handling and next test
      await new Promise((resolve) => setTimeout(resolve, 20))

      expect(executeTest).toHaveBeenCalledWith('error-suite')
      expect(executeTest).toHaveBeenCalledWith('success-suite')

      const output = lastFrame() ?? ''
      expect(output).toContain('success-suite')
    })
  })

  describe('attestation confirmation', () => {
    it('should create attestation when user presses Y', async () => {
      executeTest.mockResolvedValue(true)
      createAttestation.mockResolvedValue(undefined)

      const { stdin, lastFrame } = render(
        <TestRunner
          suites={['suite-1']}
          executeTest={executeTest}
          createAttestation={createAttestation}
          onComplete={onComplete}
        />,
      )

      // Wait for confirmation prompt
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Simulate user pressing 'y'
      stdin.write('y')

      // Wait for attestation
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(createAttestation).toHaveBeenCalledWith('suite-1')
      expect(createAttestation).toHaveBeenCalledTimes(1)
    })

    it('should create attestation when user presses Y (case insensitive)', async () => {
      executeTest.mockResolvedValue(true)
      createAttestation.mockResolvedValue(undefined)

      const { stdin } = render(
        <TestRunner
          suites={['suite-1']}
          executeTest={executeTest}
          createAttestation={createAttestation}
          onComplete={onComplete}
        />,
      )

      await new Promise((resolve) => setTimeout(resolve, 10))

      // Simulate user pressing uppercase Y (should work due to toLowerCase)
      stdin.write('Y')

      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(createAttestation).toHaveBeenCalledWith('suite-1')
    })

    it('should skip attestation when user presses N', async () => {
      executeTest.mockResolvedValueOnce(true).mockResolvedValueOnce(true)
      createAttestation.mockResolvedValue(undefined)

      const { stdin } = render(
        <TestRunner
          suites={['suite-1', 'suite-2']}
          executeTest={executeTest}
          createAttestation={createAttestation}
          onComplete={onComplete}
        />,
      )

      await new Promise((resolve) => setTimeout(resolve, 10))

      // Skip attestation
      stdin.write('n')

      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(createAttestation).not.toHaveBeenCalledWith('suite-1')
      expect(executeTest).toHaveBeenCalledWith('suite-2')
    })

    it('should handle attestation creation failures', async () => {
      executeTest.mockResolvedValueOnce(true).mockResolvedValueOnce(true)
      createAttestation.mockRejectedValueOnce(new Error('Attestation failed'))

      const { stdin } = render(
        <TestRunner
          suites={['suite-1', 'suite-2']}
          executeTest={executeTest}
          createAttestation={createAttestation}
          onComplete={onComplete}
        />,
      )

      await new Promise((resolve) => setTimeout(resolve, 10))

      stdin.write('y')

      await new Promise((resolve) => setTimeout(resolve, 20))

      // Should move to next suite even though attestation failed
      expect(executeTest).toHaveBeenCalledWith('suite-2')
    })

    it('should ignore input when not in confirming phase', async () => {
      executeTest.mockReturnValue(new Promise(() => {})) // Never resolves

      const { stdin } = render(
        <TestRunner
          suites={['suite-1']}
          executeTest={executeTest}
          createAttestation={createAttestation}
          onComplete={onComplete}
        />,
      )

      // Try to send input while running
      stdin.write('y')

      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(createAttestation).not.toHaveBeenCalled()
    })
  })

  describe('progress tracking', () => {
    it('should track completed suites correctly', async () => {
      executeTest.mockResolvedValue(true)
      createAttestation.mockResolvedValue(undefined)

      const { stdin, lastFrame } = render(
        <TestRunner
          suites={['suite-1', 'suite-2']}
          executeTest={executeTest}
          createAttestation={createAttestation}
          onComplete={onComplete}
        />,
      )

      // Complete first suite
      await new Promise((resolve) => setTimeout(resolve, 10))
      stdin.write('y')

      await new Promise((resolve) => setTimeout(resolve, 10))

      const output = lastFrame() ?? ''
      expect(output).toContain('Completed: 1')
      expect(output).toContain('Remaining: 1')
    })

    it('should track failed suites correctly', async () => {
      executeTest
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true)

      const { lastFrame } = render(
        <TestRunner
          suites={['suite-1', 'suite-2', 'suite-3']}
          executeTest={executeTest}
          createAttestation={createAttestation}
          onComplete={onComplete}
        />,
      )

      await new Promise((resolve) => setTimeout(resolve, 30))

      const output = lastFrame() ?? ''
      expect(output).toContain('Failed: 2')
    })

    it('should track skipped suites correctly', async () => {
      executeTest.mockResolvedValue(true)

      const { stdin, lastFrame } = render(
        <TestRunner
          suites={['suite-1', 'suite-2']}
          executeTest={executeTest}
          createAttestation={createAttestation}
          onComplete={onComplete}
        />,
      )

      // Skip first
      await new Promise((resolve) => setTimeout(resolve, 10))
      stdin.write('n')

      await new Promise((resolve) => setTimeout(resolve, 10))

      const output = lastFrame() ?? ''
      expect(output).toContain('Skipped: 1')
    })

    it('should update remaining count as tests progress', async () => {
      executeTest.mockResolvedValue(true)
      createAttestation.mockResolvedValue(undefined)

      const { stdin, lastFrame } = render(
        <TestRunner
          suites={['suite-1', 'suite-2', 'suite-3']}
          executeTest={executeTest}
          createAttestation={createAttestation}
          onComplete={onComplete}
        />,
      )

      // Initially 3 remaining
      expect(lastFrame()).toContain('Remaining: 3')

      // Complete first
      await new Promise((resolve) => setTimeout(resolve, 10))
      stdin.write('y')

      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(lastFrame()).toContain('Remaining: 2')

      // Complete second
      await new Promise((resolve) => setTimeout(resolve, 10))
      stdin.write('y')

      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(lastFrame()).toContain('Remaining: 1')
    })
  })

  describe('completion', () => {
    it('should call onComplete when all suites processed', async () => {
      executeTest.mockResolvedValue(true)
      createAttestation.mockResolvedValue(undefined)

      const { stdin } = render(
        <TestRunner
          suites={['suite-1', 'suite-2']}
          executeTest={executeTest}
          createAttestation={createAttestation}
          onComplete={onComplete}
        />,
      )

      // Complete both suites
      await new Promise((resolve) => setTimeout(resolve, 10))
      stdin.write('y')

      await new Promise((resolve) => setTimeout(resolve, 10))
      stdin.write('y')

      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(onComplete).toHaveBeenCalledTimes(1)
    })

    it('should pass correct results to onComplete', async () => {
      executeTest
        .mockResolvedValueOnce(true) // suite-1 passes
        .mockResolvedValueOnce(false) // suite-2 fails
        .mockResolvedValueOnce(true) // suite-3 passes
      createAttestation.mockResolvedValue(undefined)

      const { stdin } = render(
        <TestRunner
          suites={['suite-1', 'suite-2', 'suite-3']}
          executeTest={executeTest}
          createAttestation={createAttestation}
          onComplete={onComplete}
        />,
      )

      // Complete suite-1
      await new Promise((resolve) => setTimeout(resolve, 10))
      stdin.write('y')

      // suite-2 fails automatically, suite-3 starts
      await new Promise((resolve) => setTimeout(resolve, 20))

      // Skip suite-3
      stdin.write('n')

      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(onComplete).toHaveBeenCalledWith({
        completed: ['suite-1'],
        failed: ['suite-2'],
        skipped: ['suite-3'],
      })
    })

    it('should show completion message', async () => {
      executeTest.mockResolvedValue(true)
      createAttestation.mockResolvedValue(undefined)

      const { stdin, lastFrame } = render(
        <TestRunner
          suites={['suite-1']}
          executeTest={executeTest}
          createAttestation={createAttestation}
          onComplete={onComplete}
        />,
      )

      await new Promise((resolve) => setTimeout(resolve, 10))
      stdin.write('y')

      await new Promise((resolve) => setTimeout(resolve, 10))

      const output = lastFrame() ?? ''
      expect(output).toContain('All suites processed')
      expect(output).toContain('Completed: 1')
      expect(output).toContain('Failed: 0')
      expect(output).toContain('Skipped: 0')
    })
  })

  describe('empty suite list', () => {
    it('should complete immediately with empty suites', async () => {
      const { lastFrame } = render(
        <TestRunner
          suites={[]}
          executeTest={executeTest}
          createAttestation={createAttestation}
          onComplete={onComplete}
        />,
      )

      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(onComplete).toHaveBeenCalledWith({
        completed: [],
        failed: [],
        skipped: [],
      })

      const output = lastFrame() ?? ''
      expect(output).toContain('All suites processed')
    })

    it('should not execute tests with empty suites', async () => {
      render(
        <TestRunner
          suites={[]}
          executeTest={executeTest}
          createAttestation={createAttestation}
          onComplete={onComplete}
        />,
      )

      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(executeTest).not.toHaveBeenCalled()
      expect(createAttestation).not.toHaveBeenCalled()
    })
  })

  describe('edge cases', () => {
    it('should handle single suite', async () => {
      executeTest.mockResolvedValue(true)
      createAttestation.mockResolvedValue(undefined)

      const { stdin } = render(
        <TestRunner
          suites={['only-suite']}
          executeTest={executeTest}
          createAttestation={createAttestation}
          onComplete={onComplete}
        />,
      )

      await new Promise((resolve) => setTimeout(resolve, 10))
      stdin.write('y')

      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(onComplete).toHaveBeenCalledWith({
        completed: ['only-suite'],
        failed: [],
        skipped: [],
      })
    })

    it('should handle all tests failing', async () => {
      executeTest.mockResolvedValue(false)

      render(
        <TestRunner
          suites={['suite-1', 'suite-2', 'suite-3']}
          executeTest={executeTest}
          createAttestation={createAttestation}
          onComplete={onComplete}
        />,
      )

      await new Promise((resolve) => setTimeout(resolve, 30))

      expect(onComplete).toHaveBeenCalledWith({
        completed: [],
        failed: ['suite-1', 'suite-2', 'suite-3'],
        skipped: [],
      })
    })

    it('should handle all tests being skipped', async () => {
      executeTest.mockResolvedValue(true)

      const { stdin } = render(
        <TestRunner
          suites={['suite-1', 'suite-2']}
          executeTest={executeTest}
          createAttestation={createAttestation}
          onComplete={onComplete}
        />,
      )

      await new Promise((resolve) => setTimeout(resolve, 10))
      stdin.write('n')

      await new Promise((resolve) => setTimeout(resolve, 10))
      stdin.write('n')

      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(onComplete).toHaveBeenCalledWith({
        completed: [],
        failed: [],
        skipped: ['suite-1', 'suite-2'],
      })
    })

    it('should handle mixed results', async () => {
      executeTest
        .mockResolvedValueOnce(true) // Pass
        .mockResolvedValueOnce(false) // Fail
        .mockResolvedValueOnce(true) // Pass
        .mockResolvedValueOnce(true) // Pass
      createAttestation.mockResolvedValue(undefined)

      const { stdin } = render(
        <TestRunner
          suites={['suite-1', 'suite-2', 'suite-3', 'suite-4']}
          executeTest={executeTest}
          createAttestation={createAttestation}
          onComplete={onComplete}
        />,
      )

      // Complete suite-1
      await new Promise((resolve) => setTimeout(resolve, 10))
      stdin.write('y')

      // suite-2 fails, suite-3 starts
      await new Promise((resolve) => setTimeout(resolve, 20))

      // Skip suite-3
      stdin.write('n')

      // suite-4 starts
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Complete suite-4
      stdin.write('y')

      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(onComplete).toHaveBeenCalledWith({
        completed: ['suite-1', 'suite-4'],
        failed: ['suite-2'],
        skipped: ['suite-3'],
      })
    })
  })

  describe('component lifecycle', () => {
    it('should cancel pending execution on unmount', async () => {
      executeTest.mockReturnValue(new Promise(() => {})) // Never resolves

      const { unmount } = render(
        <TestRunner
          suites={['suite-1']}
          executeTest={executeTest}
          createAttestation={createAttestation}
          onComplete={onComplete}
        />,
      )

      expect(() => {
        unmount()
      }).not.toThrow()

      // onComplete should not be called
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(onComplete).not.toHaveBeenCalled()
    })

    it('should not update state after unmount', async () => {
      executeTest.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve(true), 20)
          }),
      )

      const { unmount } = render(
        <TestRunner
          suites={['suite-1']}
          executeTest={executeTest}
          createAttestation={createAttestation}
          onComplete={onComplete}
        />,
      )

      // Unmount before test completes
      unmount()

      // Wait for test to complete
      await new Promise((resolve) => setTimeout(resolve, 30))

      // Should not throw or update state
      expect(onComplete).not.toHaveBeenCalled()
    })
  })
})
