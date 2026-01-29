import * as React from 'react'
import { Box, Text, useApp } from 'ink'
import { SuiteSelector } from './SuiteSelector.js'
import { TestRunner } from './TestRunner.js'
import { ProgressSummary } from './ProgressSummary.js'
import type { SuiteStatus } from '../commands/run-utils.js'
import type { AttestItConfig } from '@attest-it/core'

/**
 * Current phase of the interactive run.
 */
type Phase = 'selecting' | 'running' | 'complete'

/**
 * Props for the InteractiveRun component.
 */
export interface InteractiveRunProps {
  /** All suite statuses */
  allSuites: SuiteStatus[]
  /** Config for groups and settings */
  config: AttestItConfig
  /** Execute test for a suite */
  executeTest: (suite: string) => Promise<boolean>
  /** Create attestation for a suite */
  createAttestation: (suite: string) => Promise<void>
  /** Save session state */
  saveSession: (completed: string[], failed: string[], remaining: string[]) => Promise<void>
  /** Optional: pre-selected suites from --continue */
  preSelected?: string[]
}

/**
 * Results from a test run.
 */
export interface RunResults {
  /** Suite names that completed successfully */
  completed: string[]
  /** Suite names that failed */
  failed: string[]
  /** Suite names that were skipped */
  skipped: string[]
}

/**
 * Main interactive run orchestrator.
 *
 * Phases:
 * 1. selecting - User selects which suites to run
 * 2. running - Tests executing, attestations being created
 * 3. complete - All done, show summary
 */
export function InteractiveRun({
  allSuites,
  config,
  executeTest,
  createAttestation,
  saveSession,
  preSelected,
}: InteractiveRunProps): React.ReactElement {
  const { exit } = useApp()

  const [phase, setPhase] = React.useState<Phase>(preSelected ? 'running' : 'selecting')
  const [selectedSuites, setSelectedSuites] = React.useState<string[]>(preSelected ?? [])
  const [results, setResults] = React.useState<RunResults>({
    completed: [],
    failed: [],
    skipped: [],
  })

  // Compute pending suites (not VALID)
  const pendingSuites = React.useMemo(
    () => allSuites.filter((s) => s.status !== 'VALID'),
    [allSuites],
  )

  // Compute valid suites (already attested)
  const validSuites = React.useMemo(
    () => allSuites.filter((s) => s.status === 'VALID'),
    [allSuites],
  )

  // Handle selection completion
  const handleSelect = React.useCallback(
    (selected: string[]) => {
      if (selected.length === 0) {
        exit()
        return
      }
      setSelectedSuites(selected)
      setPhase('running')
    },
    [exit],
  )

  // Handle run completion (wrapped to avoid promise return in void context)
  const handleRunComplete = React.useCallback(
    (runResults: RunResults) => {
      void (async () => {
        setResults(runResults)

        // Save final session state (clear if all done successfully)
        if (runResults.failed.length === 0 && runResults.skipped.length === 0) {
          // All completed - clear session
          await saveSession([], [], [])
        } else {
          // Some remaining - save for --continue
          await saveSession(runResults.completed, runResults.failed, [])
        }

        setPhase('complete')
      })()
    },
    [saveSession],
  )

  // Handle case where there are no pending suites
  if (pendingSuites.length === 0) {
    return (
      <Box flexDirection="column">
        <Text color="green">✓ All suites are valid. Nothing to run.</Text>
        {validSuites.length > 0 && (
          <Text dimColor>{validSuites.length} suite(s) already attested.</Text>
        )}
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      {phase === 'selecting' && (
        <SuiteSelector
          pendingSuites={pendingSuites}
          validSuites={validSuites}
          groups={config.groups}
          onSelect={handleSelect}
          onExit={() => {
            exit()
          }}
        />
      )}

      {phase === 'running' && (
        <TestRunner
          suites={selectedSuites}
          executeTest={executeTest}
          createAttestation={createAttestation}
          onComplete={handleRunComplete}
        />
      )}

      {phase === 'complete' && (
        <Box flexDirection="column">
          <ProgressSummary
            completed={results.completed.length}
            failed={results.failed.length}
            remaining={0}
            skipped={results.skipped.length}
          />

          <Box marginY={1}>
            {results.failed.length === 0 && results.skipped.length === 0 ? (
              <Text color="green">✓ All suites attested successfully!</Text>
            ) : (
              <Box flexDirection="column">
                {results.failed.length > 0 && (
                  <Text color="red">
                    ✗ {results.failed.length} suite(s) failed: {results.failed.join(', ')}
                  </Text>
                )}
                <Text>Run `attest-it run` again to continue with remaining suites.</Text>
              </Box>
            )}
          </Box>
        </Box>
      )}
    </Box>
  )
}
