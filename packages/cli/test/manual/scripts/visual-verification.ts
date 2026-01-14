#!/usr/bin/env tsx
/**
 * Visual verification test wrapper.
 *
 * This script wraps the manual-test-runner.ts to provide a structured
 * testing workflow with pre-flight and post-verification checklists.
 *
 * It runs the visual test scenarios and prompts the user to confirm
 * that all visual aspects passed inspection.
 *
 * Exit codes:
 *   0 = User confirmed all tests passed
 *   1 = User indicated tests failed or script error
 */

import { confirm } from '@inquirer/prompts'
import { execa } from 'execa'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/**
 * Pre-flight checklist items to verify before running tests.
 */
const PREFLIGHT_CHECKLIST = [
  'Terminal has sufficient width (at least 80 columns recommended)',
  'Terminal supports color output',
  'You have time to complete the visual verification (approximately 10-15 minutes)',
  'You are familiar with the expected CLI behavior',
]

/**
 * Post-verification checklist items the user should confirm.
 */
const POST_VERIFICATION_CHECKLIST = [
  'Status badges display correctly (VALID, MISSING, EXPIRED, CHANGED)',
  'Colors render properly (green for valid, yellow for warnings, red for errors)',
  'No visual artifacts or rendering glitches',
  'Interactive keyboard controls work (arrow keys, space, enter)',
  'Suite selection UI is clear and functional',
  'Progress indicators display properly',
  'Error messages are readable and well-formatted',
  'All test scenarios completed without crashes',
]

/**
 * Display the pre-flight checklist.
 *
 * Shows items the user should verify before starting the test run.
 */
function displayPreflightChecklist(): void {
  console.log('\n' + '='.repeat(80))
  console.log('Visual Verification Test - Pre-Flight Checklist')
  console.log('='.repeat(80))
  console.log('\nBefore running the visual verification, please ensure:\n')

  PREFLIGHT_CHECKLIST.forEach((item, index) => {
    console.log(`  ${String(index + 1)}. ${item}`)
  })

  console.log('\n' + '='.repeat(80))
}

/**
 * Display the post-verification checklist.
 *
 * Shows items the user should have verified during the test run.
 */
function displayPostVerificationChecklist(): void {
  console.log('\n' + '='.repeat(80))
  console.log('Visual Verification Test - Post-Verification Checklist')
  console.log('='.repeat(80))
  console.log('\nPlease confirm that you verified the following:\n')

  POST_VERIFICATION_CHECKLIST.forEach((item, index) => {
    console.log(`  ${String(index + 1)}. ${item}`)
  })

  console.log('\n' + '='.repeat(80))
}

/**
 * Run the manual test runner with the specified scenario.
 *
 * Executes the manual-test-runner.ts script and inherits stdio
 * so the user can interact with the test scenarios.
 *
 * @param scenario - Scenario name to run
 * @returns Promise resolving to the exit code
 */
async function runManualTestRunner(scenario: string): Promise<number> {
  const testRunnerPath = join(__dirname, '../../manual-test-runner.ts')

  console.log('\n' + '='.repeat(80))
  console.log('Running Visual Test Scenarios')
  console.log('='.repeat(80))
  console.log(`\nScenario: ${scenario}`)
  console.log('Follow the on-screen prompts to test each command.\n')

  try {
    const result = await execa('tsx', [testRunnerPath, scenario], {
      stdio: 'inherit',
      reject: false,
    })

    return result.exitCode
  } catch (error) {
    console.error('Error running manual test runner:', error)
    return 1
  }
}

/**
 * Parse command line arguments.
 *
 * Supports scenario name as positional argument.
 * Defaults to 'multi-suite' if not specified.
 *
 * @returns Parsed scenario name
 */
function parseArgs(): string {
  const args = process.argv.slice(2)

  // Filter out node/tsx execution flags
  const scenarios = args.filter((arg) => !arg.startsWith('--') && !arg.startsWith('-'))

  return scenarios[0] ?? 'multi-suite'
}

/**
 * Main entry point.
 *
 * Orchestrates the complete visual verification workflow:
 * 1. Display pre-flight checklist
 * 2. Confirm readiness
 * 3. Run test scenarios
 * 4. Display post-verification checklist
 * 5. Confirm all tests passed
 */
async function main(): Promise<void> {
  const scenario = parseArgs()

  // Display pre-flight checklist
  displayPreflightChecklist()

  // Confirm readiness to proceed
  const readyToProceed = await confirm({
    message: 'Are you ready to proceed with visual verification?',
    default: true,
  })

  if (!readyToProceed) {
    console.log('\nVisual verification cancelled.')
    process.exit(1)
  }

  // Run the manual test scenarios
  const exitCode = await runManualTestRunner(scenario)

  if (exitCode !== 0) {
    console.error('\nManual test runner exited with error.')
    process.exit(exitCode)
  }

  // Display post-verification checklist
  displayPostVerificationChecklist()

  // Confirm all tests passed
  const allTestsPassed = await confirm({
    message: 'Did all visual verification checks pass?',
    default: false,
  })

  if (allTestsPassed) {
    console.log('\n✓ Visual verification completed successfully!')
    process.exit(0)
  } else {
    console.log('\n✗ Visual verification failed. Please review and fix issues.')
    process.exit(1)
  }
}

// Run if executed directly
const scriptPath = process.argv[1] ?? ''
if (import.meta.url === `file://${scriptPath}`) {
  main().catch((error: unknown) => {
    console.error('Error:', error)
    process.exit(1)
  })
}
