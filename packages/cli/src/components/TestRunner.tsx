import * as React from 'react'
import { Box, Text, useInput } from 'ink'
import { ProgressSummary } from './ProgressSummary.js'

type RunPhase = 'running' | 'confirming' | 'complete'

export interface TestRunnerProps {
  /** Suites to run in order */
  suites: string[]
  /** Execute a test command and return success/failure */
  executeTest: (suite: string) => Promise<boolean>
  /** Create attestation for a suite */
  createAttestation: (suite: string) => Promise<void>
  /** Called when all suites complete */
  onComplete: (results: RunResults) => void
}

export interface RunResults {
  completed: string[]
  failed: string[]
  skipped: string[]
}

/**
 * Test runner component that executes suites and manages attestations.
 *
 * Flow for each suite:
 * 1. Show "Running suite-name..."
 * 2. Execute test command
 * 3. If passed, prompt "Create attestation? [Y/n]"
 * 4. If user confirms, create attestation
 * 5. Move to next suite
 *
 * If a test fails, it moves to the next suite without prompting for attestation.
 */
export function TestRunner({
  suites,
  executeTest,
  createAttestation,
  onComplete,
}: TestRunnerProps): React.ReactElement {
  const [currentIndex, setCurrentIndex] = React.useState(0)
  const [phase, setPhase] = React.useState<RunPhase>('running')
  const [results, setResults] = React.useState<RunResults>({
    completed: [],
    failed: [],
    skipped: [],
  })
  const [_testPassed, setTestPassed] = React.useState(false)

  // Use a ref to store the latest results for the completion callback
  const resultsRef = React.useRef(results)
  React.useEffect(() => {
    resultsRef.current = results
  }, [results])

  // Effect to run tests
  React.useEffect(() => {
    if (phase !== 'running') return

    // eslint-disable-next-line security/detect-object-injection -- Safe array access with numeric index
    const currentSuite = suites[currentIndex]
    if (!currentSuite) {
      // All done - use ref to avoid stale closure
      onComplete(resultsRef.current)
      setPhase('complete')
      return
    }

    // Execute the test
    let cancelled = false
    executeTest(currentSuite)
      .then((passed) => {
        if (cancelled) return

        setTestPassed(passed)
        if (passed) {
          setPhase('confirming')
        } else {
          // Test failed, move to next
          setResults((prev) => ({
            ...prev,
            failed: [...prev.failed, currentSuite],
          }))
          setCurrentIndex((prev) => prev + 1)
        }
      })
      .catch(() => {
        if (cancelled) return

        // Execution error, treat as failed
        setResults((prev) => ({
          ...prev,
          failed: [...prev.failed, currentSuite],
        }))
        setCurrentIndex((prev) => prev + 1)
      })

    return () => {
      cancelled = true
    }
  }, [currentIndex, phase, suites, executeTest, onComplete])

  // Handle attestation confirmation
  useInput(
    (input, key) => {
      if (phase !== 'confirming') return

      // eslint-disable-next-line security/detect-object-injection -- Safe array access with numeric index
      const currentSuite = suites[currentIndex]
      if (!currentSuite) return

      // Y or Enter = create attestation
      if (input.toLowerCase() === 'y' || key.return) {
        createAttestation(currentSuite)
          .then(() => {
            setResults((prev) => ({
              ...prev,
              completed: [...prev.completed, currentSuite],
            }))
            setCurrentIndex((prev) => prev + 1)
            setPhase('running')
          })
          .catch(() => {
            // If attestation fails, still move on but mark as skipped
            setResults((prev) => ({
              ...prev,
              skipped: [...prev.skipped, currentSuite],
            }))
            setCurrentIndex((prev) => prev + 1)
            setPhase('running')
          })
      }

      // N = skip attestation
      if (input.toLowerCase() === 'n') {
        setResults((prev) => ({
          ...prev,
          skipped: [...prev.skipped, currentSuite],
        }))
        setCurrentIndex((prev) => prev + 1)
        setPhase('running')
      }
    },
    { isActive: phase === 'confirming' },
  )

  // eslint-disable-next-line security/detect-object-injection -- Safe array access with numeric index
  const currentSuite = suites[currentIndex]

  return (
    <Box flexDirection="column">
      {/* Progress summary */}
      <ProgressSummary
        completed={results.completed.length}
        failed={results.failed.length}
        remaining={suites.length - currentIndex}
        skipped={results.skipped.length}
      />

      <Box marginY={1}>
        {phase === 'running' && currentSuite && (
          <Box>
            <SimpleSpinner />
            <Text> Running {currentSuite}...</Text>
          </Box>
        )}

        {phase === 'confirming' && currentSuite && (
          <Box flexDirection="column">
            <Text color="green">✓ Tests passed!</Text>
            <Text>Create attestation for {currentSuite}? [Y/n]: </Text>
          </Box>
        )}

        {phase === 'complete' && (
          <Box flexDirection="column">
            <Text color="green">✓ All suites processed</Text>
            <Text>
              Completed: {results.completed.length}, Failed: {results.failed.length}, Skipped:{' '}
              {results.skipped.length}
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  )
}

/**
 * Simple spinner component using ASCII animation frames.
 * Fallback for when no dedicated spinner library is available.
 */
function SimpleSpinner(): React.ReactElement {
  const [frame, setFrame] = React.useState(0)
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

  React.useEffect(() => {
    const timer = setInterval(() => {
      setFrame((f) => (f + 1) % frames.length)
    }, 80)
    return () => {
      clearInterval(timer)
    }
  }, [])

  // eslint-disable-next-line security/detect-object-injection -- Safe array access with numeric index
  return <Text color="cyan">{frames[frame]}</Text>
}
