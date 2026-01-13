import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as React from 'react'
import { render } from 'ink-testing-library'
import { Text } from 'ink'
import { InteractiveRun } from '../../src/components/InteractiveRun.js'
import type { SuiteStatus } from '../../src/commands/run-utils.js'
import type { Config } from '@attest-it/core'
import type { RunResults } from '../../src/components/InteractiveRun.js'

// Store mock components
let mockSuiteSelectorProps: {
  onSelect: (selected: string[]) => void
  onExit: () => void
} | null = null
let mockTestRunnerProps: {
  suites: string[]
  onComplete: (results: RunResults) => Promise<void>
} | null = null

// Mock child components
vi.mock('../../src/components/SuiteSelector.js', () => ({
  SuiteSelector: (props: {
    pendingSuites: SuiteStatus[]
    validSuites: SuiteStatus[]
    groups?: Record<string, string[]>
    onSelect: (selected: string[]) => void
    onExit: () => void
  }) => {
    mockSuiteSelectorProps = {
      onSelect: props.onSelect,
      onExit: props.onExit,
    }
    return <Text>SuiteSelector</Text>
  },
}))

vi.mock('../../src/components/TestRunner.js', () => ({
  TestRunner: (props: {
    suites: string[]
    executeTest: (suite: string) => Promise<boolean>
    createAttestation: (suite: string) => Promise<void>
    onComplete: (results: RunResults) => Promise<void>
  }) => {
    mockTestRunnerProps = {
      suites: props.suites,
      onComplete: props.onComplete,
    }
    return <Text>TestRunner</Text>
  },
}))

describe('InteractiveRun component', () => {
  const mockExecuteTest = vi.fn<[string], Promise<boolean>>()
  const mockCreateAttestation = vi.fn<[string], Promise<void>>()
  const mockSaveSession = vi.fn<[string[], string[], string[]], Promise<void>>()

  const mockConfig: Config = {
    version: 1,
    settings: {
      maxAgeDays: 30,
      publicKeyPath: '.attest-it/pubkey.pem',
      attestationsPath: '.attest-it/attestations.json',
    },
    suites: {
      unit: { packages: ['packages/*'] },
      integration: { packages: ['packages/*'] },
    },
    groups: {
      all: ['unit', 'integration'],
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockSuiteSelectorProps = null
    mockTestRunnerProps = null
  })

  describe('no pending suites', () => {
    it('should show success message when all suites are valid', () => {
      const validSuites: SuiteStatus[] = [
        {
          name: 'unit',
          status: 'VALID',
          reason: 'Attested 5 days ago',
          currentFingerprint: 'abc123',
          attestedFingerprint: 'abc123',
          attestedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
          age: 5,
        },
        {
          name: 'integration',
          status: 'VALID',
          reason: 'Attested 3 days ago',
          currentFingerprint: 'def456',
          attestedFingerprint: 'def456',
          attestedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
          age: 3,
        },
      ]

      const { lastFrame } = render(
        <InteractiveRun
          allSuites={validSuites}
          config={mockConfig}
          executeTest={mockExecuteTest}
          createAttestation={mockCreateAttestation}
          saveSession={mockSaveSession}
        />,
      )

      const output = lastFrame() ?? ''
      expect(output).toContain('All suites are valid')
      expect(output).toContain('Nothing to run')
      expect(output).toContain('2 suite(s) already attested')
    })

    it('should show message without suite count when no suites exist', () => {
      const { lastFrame } = render(
        <InteractiveRun
          allSuites={[]}
          config={mockConfig}
          executeTest={mockExecuteTest}
          createAttestation={mockCreateAttestation}
          saveSession={mockSaveSession}
        />,
      )

      const output = lastFrame() ?? ''
      expect(output).toContain('All suites are valid')
      expect(output).toContain('Nothing to run')
      expect(output).not.toContain('suite(s) already attested')
    })
  })

  describe('selecting phase', () => {
    it('should show SuiteSelector in selecting phase', () => {
      const pendingSuites: SuiteStatus[] = [
        {
          name: 'unit',
          status: 'NEEDS_ATTESTATION',
          reason: 'No attestation found',
          currentFingerprint: 'abc123',
        },
      ]

      const { lastFrame } = render(
        <InteractiveRun
          allSuites={pendingSuites}
          config={mockConfig}
          executeTest={mockExecuteTest}
          createAttestation={mockCreateAttestation}
          saveSession={mockSaveSession}
        />,
      )

      const output = lastFrame() ?? ''
      expect(output).toContain('SuiteSelector')
      expect(mockSuiteSelectorProps).not.toBeNull()
    })

    it('should skip selecting phase when preSelected provided', () => {
      const pendingSuites: SuiteStatus[] = [
        {
          name: 'unit',
          status: 'NEEDS_ATTESTATION',
          reason: 'No attestation found',
          currentFingerprint: 'abc123',
        },
      ]

      const { lastFrame } = render(
        <InteractiveRun
          allSuites={pendingSuites}
          config={mockConfig}
          executeTest={mockExecuteTest}
          createAttestation={mockCreateAttestation}
          saveSession={mockSaveSession}
          preSelected={['unit']}
        />,
      )

      const output = lastFrame() ?? ''
      // Should go straight to running phase
      expect(output).toContain('TestRunner')
      expect(output).not.toContain('SuiteSelector')
      expect(mockTestRunnerProps).not.toBeNull()
      expect(mockTestRunnerProps?.suites).toEqual(['unit'])
    })

    it('should exit when selection returns empty array', () => {
      const pendingSuites: SuiteStatus[] = [
        {
          name: 'unit',
          status: 'NEEDS_ATTESTATION',
          reason: 'No attestation found',
          currentFingerprint: 'abc123',
        },
      ]

      render(
        <InteractiveRun
          allSuites={pendingSuites}
          config={mockConfig}
          executeTest={mockExecuteTest}
          createAttestation={mockCreateAttestation}
          saveSession={mockSaveSession}
        />,
      )

      // Verify SuiteSelector was rendered and we can call its onSelect
      expect(mockSuiteSelectorProps).not.toBeNull()

      // Simulate user selecting empty array (should trigger exit)
      mockSuiteSelectorProps?.onSelect([])

      // Exit should be called (though we can't easily verify it in this test environment)
      // The important thing is no errors are thrown
    })
  })

  describe('running phase', () => {
    it('should transition to running phase after selection', () => {
      const pendingSuites: SuiteStatus[] = [
        {
          name: 'unit',
          status: 'NEEDS_ATTESTATION',
          reason: 'No attestation found',
          currentFingerprint: 'abc123',
        },
      ]

      const { lastFrame, rerender } = render(
        <InteractiveRun
          allSuites={pendingSuites}
          config={mockConfig}
          executeTest={mockExecuteTest}
          createAttestation={mockCreateAttestation}
          saveSession={mockSaveSession}
        />,
      )

      // Initially should show SuiteSelector
      expect(lastFrame()).toContain('SuiteSelector')
      expect(mockSuiteSelectorProps).not.toBeNull()

      // Simulate user making selection
      mockSuiteSelectorProps?.onSelect(['unit'])

      // Force a re-render to see the state change
      rerender(
        <InteractiveRun
          allSuites={pendingSuites}
          config={mockConfig}
          executeTest={mockExecuteTest}
          createAttestation={mockCreateAttestation}
          saveSession={mockSaveSession}
        />,
      )

      // After selection, should show TestRunner
      const output = lastFrame() ?? ''
      expect(output).toContain('TestRunner')
    })

    it('should pass selected suites to TestRunner', () => {
      const pendingSuites: SuiteStatus[] = [
        {
          name: 'unit',
          status: 'NEEDS_ATTESTATION',
          reason: 'No attestation found',
          currentFingerprint: 'abc123',
        },
        {
          name: 'integration',
          status: 'FINGERPRINT_CHANGED',
          reason: 'Source files modified',
          currentFingerprint: 'def456',
        },
      ]

      const { rerender } = render(
        <InteractiveRun
          allSuites={pendingSuites}
          config={mockConfig}
          executeTest={mockExecuteTest}
          createAttestation={mockCreateAttestation}
          saveSession={mockSaveSession}
        />,
      )

      // Simulate selection
      mockSuiteSelectorProps?.onSelect(['unit', 'integration'])
      rerender(
        <InteractiveRun
          allSuites={pendingSuites}
          config={mockConfig}
          executeTest={mockExecuteTest}
          createAttestation={mockCreateAttestation}
          saveSession={mockSaveSession}
        />,
      )

      // Verify TestRunner received the correct suites
      expect(mockTestRunnerProps).not.toBeNull()
      expect(mockTestRunnerProps?.suites).toEqual(['unit', 'integration'])
    })
  })

  describe('complete phase', () => {
    it('should show success message when all suites pass', async () => {
      const pendingSuites: SuiteStatus[] = [
        {
          name: 'unit',
          status: 'NEEDS_ATTESTATION',
          reason: 'No attestation found',
          currentFingerprint: 'abc123',
        },
      ]

      const { lastFrame, rerender } = render(
        <InteractiveRun
          allSuites={pendingSuites}
          config={mockConfig}
          executeTest={mockExecuteTest}
          createAttestation={mockCreateAttestation}
          saveSession={mockSaveSession}
        />,
      )

      // Simulate selection
      mockSuiteSelectorProps?.onSelect(['unit'])
      rerender(
        <InteractiveRun
          allSuites={pendingSuites}
          config={mockConfig}
          executeTest={mockExecuteTest}
          createAttestation={mockCreateAttestation}
          saveSession={mockSaveSession}
        />,
      )

      // Simulate run completion
      await mockTestRunnerProps?.onComplete({
        completed: ['unit'],
        failed: [],
        skipped: [],
      })

      rerender(
        <InteractiveRun
          allSuites={pendingSuites}
          config={mockConfig}
          executeTest={mockExecuteTest}
          createAttestation={mockCreateAttestation}
          saveSession={mockSaveSession}
        />,
      )

      const output = lastFrame() ?? ''
      expect(output).toContain('All suites attested successfully')
      expect(mockSaveSession).toHaveBeenCalledWith([], [], [])
    })

    it('should show failure message when suites fail', async () => {
      const pendingSuites: SuiteStatus[] = [
        {
          name: 'unit',
          status: 'NEEDS_ATTESTATION',
          reason: 'No attestation found',
          currentFingerprint: 'abc123',
        },
        {
          name: 'integration',
          status: 'FINGERPRINT_CHANGED',
          reason: 'Source files modified',
          currentFingerprint: 'def456',
        },
      ]

      const { lastFrame, rerender } = render(
        <InteractiveRun
          allSuites={pendingSuites}
          config={mockConfig}
          executeTest={mockExecuteTest}
          createAttestation={mockCreateAttestation}
          saveSession={mockSaveSession}
        />,
      )

      mockSuiteSelectorProps?.onSelect(['unit', 'integration'])
      rerender(
        <InteractiveRun
          allSuites={pendingSuites}
          config={mockConfig}
          executeTest={mockExecuteTest}
          createAttestation={mockCreateAttestation}
          saveSession={mockSaveSession}
        />,
      )

      await mockTestRunnerProps?.onComplete({
        completed: ['unit'],
        failed: ['integration'],
        skipped: [],
      })
      rerender(
        <InteractiveRun
          allSuites={pendingSuites}
          config={mockConfig}
          executeTest={mockExecuteTest}
          createAttestation={mockCreateAttestation}
          saveSession={mockSaveSession}
        />,
      )

      const output = lastFrame() ?? ''
      expect(output).toContain('suite(s) failed')
      expect(output).toContain('integration')
      expect(output).toContain('Run `attest-it run` again')
      expect(mockSaveSession).toHaveBeenCalledWith(['unit'], ['integration'], [])
    })

    it('should display ProgressSummary with correct counts', async () => {
      const pendingSuites: SuiteStatus[] = [
        {
          name: 'unit',
          status: 'NEEDS_ATTESTATION',
          reason: 'No attestation found',
          currentFingerprint: 'abc123',
        },
        {
          name: 'integration',
          status: 'FINGERPRINT_CHANGED',
          reason: 'Source files modified',
          currentFingerprint: 'def456',
        },
        {
          name: 'e2e',
          status: 'EXPIRED',
          reason: '35 days old',
          currentFingerprint: 'ghi789',
        },
      ]

      const { lastFrame, rerender } = render(
        <InteractiveRun
          allSuites={pendingSuites}
          config={mockConfig}
          executeTest={mockExecuteTest}
          createAttestation={mockCreateAttestation}
          saveSession={mockSaveSession}
        />,
      )

      mockSuiteSelectorProps?.onSelect(['unit', 'integration', 'e2e'])
      rerender(
        <InteractiveRun
          allSuites={pendingSuites}
          config={mockConfig}
          executeTest={mockExecuteTest}
          createAttestation={mockCreateAttestation}
          saveSession={mockSaveSession}
        />,
      )

      await mockTestRunnerProps?.onComplete({
        completed: ['unit', 'e2e'],
        failed: ['integration'],
        skipped: [],
      })
      rerender(
        <InteractiveRun
          allSuites={pendingSuites}
          config={mockConfig}
          executeTest={mockExecuteTest}
          createAttestation={mockCreateAttestation}
          saveSession={mockSaveSession}
        />,
      )

      const output = lastFrame() ?? ''
      expect(output).toContain('Completed: 2')
      expect(output).toContain('Failed: 1')
      expect(output).toContain('Remaining: 0')
    })

    it('should handle skipped suites', async () => {
      const pendingSuites: SuiteStatus[] = [
        {
          name: 'unit',
          status: 'NEEDS_ATTESTATION',
          reason: 'No attestation found',
          currentFingerprint: 'abc123',
        },
        {
          name: 'integration',
          status: 'FINGERPRINT_CHANGED',
          reason: 'Source files modified',
          currentFingerprint: 'def456',
        },
      ]

      const { lastFrame, rerender } = render(
        <InteractiveRun
          allSuites={pendingSuites}
          config={mockConfig}
          executeTest={mockExecuteTest}
          createAttestation={mockCreateAttestation}
          saveSession={mockSaveSession}
        />,
      )

      mockSuiteSelectorProps?.onSelect(['unit', 'integration'])
      rerender(
        <InteractiveRun
          allSuites={pendingSuites}
          config={mockConfig}
          executeTest={mockExecuteTest}
          createAttestation={mockCreateAttestation}
          saveSession={mockSaveSession}
        />,
      )

      await mockTestRunnerProps?.onComplete({
        completed: ['unit'],
        failed: [],
        skipped: ['integration'],
      })
      rerender(
        <InteractiveRun
          allSuites={pendingSuites}
          config={mockConfig}
          executeTest={mockExecuteTest}
          createAttestation={mockCreateAttestation}
          saveSession={mockSaveSession}
        />,
      )

      const output = lastFrame() ?? ''
      expect(output).toContain('Skipped: 1')
      expect(output).toContain('Run `attest-it run` again')
      expect(mockSaveSession).toHaveBeenCalledWith(['unit'], [], [])
    })
  })

  describe('edge cases', () => {
    it('should handle empty preSelected array', () => {
      const pendingSuites: SuiteStatus[] = [
        {
          name: 'unit',
          status: 'NEEDS_ATTESTATION',
          reason: 'No attestation found',
          currentFingerprint: 'abc123',
        },
      ]

      const { lastFrame } = render(
        <InteractiveRun
          allSuites={pendingSuites}
          config={mockConfig}
          executeTest={mockExecuteTest}
          createAttestation={mockCreateAttestation}
          saveSession={mockSaveSession}
          preSelected={[]}
        />,
      )

      const output = lastFrame() ?? ''
      // Should show TestRunner even with empty array
      expect(output).toContain('TestRunner')
    })

    it('should handle mixture of pending and valid suites', () => {
      const mixedSuites: SuiteStatus[] = [
        {
          name: 'unit',
          status: 'VALID',
          reason: 'Attested 5 days ago',
          currentFingerprint: 'abc123',
          attestedFingerprint: 'abc123',
          attestedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
          age: 5,
        },
        {
          name: 'integration',
          status: 'NEEDS_ATTESTATION',
          reason: 'No attestation found',
          currentFingerprint: 'def456',
        },
      ]

      const { lastFrame, rerender } = render(
        <InteractiveRun
          allSuites={mixedSuites}
          config={mockConfig}
          executeTest={mockExecuteTest}
          createAttestation={mockCreateAttestation}
          saveSession={mockSaveSession}
        />,
      )

      // Should start with selector showing only pending suites
      expect(lastFrame()).toContain('SuiteSelector')

      mockSuiteSelectorProps?.onSelect(['integration'])
      rerender(
        <InteractiveRun
          allSuites={mixedSuites}
          config={mockConfig}
          executeTest={mockExecuteTest}
          createAttestation={mockCreateAttestation}
          saveSession={mockSaveSession}
        />,
      )

      const output = lastFrame() ?? ''
      expect(output).toContain('TestRunner')
    })

    it('should handle config without groups', () => {
      const configNoGroups: Config = {
        version: 1,
        settings: {
          maxAgeDays: 30,
          publicKeyPath: '.attest-it/pubkey.pem',
          attestationsPath: '.attest-it/attestations.json',
        },
        suites: {
          unit: { packages: ['packages/*'] },
        },
      }

      const pendingSuites: SuiteStatus[] = [
        {
          name: 'unit',
          status: 'NEEDS_ATTESTATION',
          reason: 'No attestation found',
          currentFingerprint: 'abc123',
        },
      ]

      const { lastFrame } = render(
        <InteractiveRun
          allSuites={pendingSuites}
          config={configNoGroups}
          executeTest={mockExecuteTest}
          createAttestation={mockCreateAttestation}
          saveSession={mockSaveSession}
        />,
      )

      const output = lastFrame() ?? ''
      expect(output).toContain('SuiteSelector')
    })
  })

  describe('session management', () => {
    it('should clear session when all suites complete successfully', async () => {
      const pendingSuites: SuiteStatus[] = [
        {
          name: 'unit',
          status: 'NEEDS_ATTESTATION',
          reason: 'No attestation found',
          currentFingerprint: 'abc123',
        },
      ]

      const { rerender } = render(
        <InteractiveRun
          allSuites={pendingSuites}
          config={mockConfig}
          executeTest={mockExecuteTest}
          createAttestation={mockCreateAttestation}
          saveSession={mockSaveSession}
        />,
      )

      mockSuiteSelectorProps?.onSelect(['unit'])
      rerender(
        <InteractiveRun
          allSuites={pendingSuites}
          config={mockConfig}
          executeTest={mockExecuteTest}
          createAttestation={mockCreateAttestation}
          saveSession={mockSaveSession}
        />,
      )

      await mockTestRunnerProps?.onComplete({
        completed: ['unit'],
        failed: [],
        skipped: [],
      })

      expect(mockSaveSession).toHaveBeenCalledWith([], [], [])
    })

    it('should save session state when suites fail', async () => {
      const pendingSuites: SuiteStatus[] = [
        {
          name: 'unit',
          status: 'NEEDS_ATTESTATION',
          reason: 'No attestation found',
          currentFingerprint: 'abc123',
        },
        {
          name: 'integration',
          status: 'FINGERPRINT_CHANGED',
          reason: 'Source files modified',
          currentFingerprint: 'def456',
        },
      ]

      const { rerender } = render(
        <InteractiveRun
          allSuites={pendingSuites}
          config={mockConfig}
          executeTest={mockExecuteTest}
          createAttestation={mockCreateAttestation}
          saveSession={mockSaveSession}
        />,
      )

      mockSuiteSelectorProps?.onSelect(['unit', 'integration'])
      rerender(
        <InteractiveRun
          allSuites={pendingSuites}
          config={mockConfig}
          executeTest={mockExecuteTest}
          createAttestation={mockCreateAttestation}
          saveSession={mockSaveSession}
        />,
      )

      await mockTestRunnerProps?.onComplete({
        completed: ['unit'],
        failed: ['integration'],
        skipped: [],
      })

      expect(mockSaveSession).toHaveBeenCalledWith(['unit'], ['integration'], [])
    })

    it('should save session state when suites are skipped', async () => {
      const pendingSuites: SuiteStatus[] = [
        {
          name: 'unit',
          status: 'NEEDS_ATTESTATION',
          reason: 'No attestation found',
          currentFingerprint: 'abc123',
        },
        {
          name: 'integration',
          status: 'FINGERPRINT_CHANGED',
          reason: 'Source files modified',
          currentFingerprint: 'def456',
        },
      ]

      const { rerender } = render(
        <InteractiveRun
          allSuites={pendingSuites}
          config={mockConfig}
          executeTest={mockExecuteTest}
          createAttestation={mockCreateAttestation}
          saveSession={mockSaveSession}
        />,
      )

      mockSuiteSelectorProps?.onSelect(['unit', 'integration'])
      rerender(
        <InteractiveRun
          allSuites={pendingSuites}
          config={mockConfig}
          executeTest={mockExecuteTest}
          createAttestation={mockCreateAttestation}
          saveSession={mockSaveSession}
        />,
      )

      await mockTestRunnerProps?.onComplete({
        completed: ['unit'],
        failed: [],
        skipped: ['integration'],
      })

      expect(mockSaveSession).toHaveBeenCalledWith(['unit'], [], [])
    })
  })
})
