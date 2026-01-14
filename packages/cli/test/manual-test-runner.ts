#!/usr/bin/env tsx
/**
 * Manual test runner for visually validating the interactive CLI experience.
 *
 * This script creates realistic test projects and launches the interactive CLI
 * so you can manually verify:
 * - Visual rendering is correct
 * - No visual artifacts
 * - Keyboard interactions work
 * - Status badges display properly
 * - Colors and formatting are correct
 *
 * Usage:
 *   pnpm tsx test/manual-test-runner.ts [scenario]
 *
 * Scenarios:
 *   multi-suite   - Project with 5 suites in various states (default)
 *   all-missing   - All suites are missing attestations
 *   complex       - Complex groups structure with 6 suites
 *   failing       - Project with a failing test suite
 *   all           - Run all scenarios in sequence
 */

import { execa } from 'execa'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { spawn } from 'node:child_process'
import {
  createMultiSuiteFixture,
  createAllMissingFixture,
  createComplexGroupsFixture,
  createFailingSuiteFixture,
} from './helpers/fixture-factory.js'
import type { Project } from 'fixturify-project'
import { AgentOutputWriter } from './helpers/agent-output-writer.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/**
 * Test scenario definition.
 */
interface Scenario {
  /** Scenario identifier (e.g., "multi-suite") */
  key: string
  /** Human-readable scenario name */
  name: string
  /** Scenario description */
  description: string
  /** Function that creates the test project fixture */
  createFixture: () => Promise<Project>
  /** Commands to run in this scenario */
  commands: Array<{
    /** Command name for display */
    name: string
    /** CLI arguments to pass to attest-it */
    args: string[]
    /** Human-readable description of what this command does */
    description: string
  }>
}

const scenarios: Record<string, Scenario> = {
  'multi-suite': {
    key: 'multi-suite',
    name: 'Multi-Suite Project',
    description: 'Project with 5 suites in various states (valid, missing, expired, changed)',
    createFixture: createMultiSuiteFixture,
    commands: [
      {
        name: 'status',
        args: ['status'],
        description: 'View status of all suites',
      },
      {
        name: 'run-interactive',
        args: ['run'],
        description: 'Interactive suite selection (use keyboard to select suites)',
      },
      {
        name: 'run-all-dry',
        args: ['run', '--all', '--dry-run'],
        description: 'Dry run of all pending suites',
      },
      {
        name: 'run-filter',
        args: ['run', '--filter', '*-tests', '--dry-run'],
        description: 'Filter suites by pattern',
      },
    ],
  },

  'all-missing': {
    key: 'all-missing',
    name: 'All Missing Attestations',
    description: 'All suites are missing attestations',
    createFixture: createAllMissingFixture,
    commands: [
      {
        name: 'status',
        args: ['status'],
        description: 'Should show all suites as MISSING',
      },
      {
        name: 'run-interactive',
        args: ['run'],
        description: 'Interactive selection of 3 suites',
      },
      {
        name: 'run-all-dry',
        args: ['run', '--all', '--dry-run'],
        description: 'Dry run of all missing suites',
      },
    ],
  },

  complex: {
    key: 'complex',
    name: 'Complex Groups Structure',
    description: 'Project with 6 suites organized into multiple groups',
    createFixture: createComplexGroupsFixture,
    commands: [
      {
        name: 'status',
        args: ['status'],
        description: 'View all suites with groups',
      },
      {
        name: 'run-interactive',
        args: ['run'],
        description: 'Interactive selection showing group organization',
      },
      {
        name: 'run-filter-frontend',
        args: ['run', '--filter', 'frontend-*', '--dry-run'],
        description: 'Filter to frontend suites only',
      },
      {
        name: 'run-filter-backend',
        args: ['run', '--filter', 'backend-*', '--dry-run'],
        description: 'Filter to backend suites only',
      },
    ],
  },

  failing: {
    key: 'failing',
    name: 'Failing Test Suite',
    description: 'Project with one passing and one failing suite',
    createFixture: createFailingSuiteFixture,
    commands: [
      {
        name: 'status',
        args: ['status'],
        description: 'View status',
      },
      {
        name: 'run-dry',
        args: ['run', '--suite', 'failing', '--dry-run'],
        description: 'Dry run of failing suite',
      },
      {
        name: 'run-passing',
        args: ['run', '--suite', 'example', '--dry-run'],
        description: 'Dry run of passing suite',
      },
    ],
  },
}

/**
 * Run a command and wait for it to complete.
 *
 * Treats both exit codes 0 and 1 as success for attest-it commands,
 * since 1 means "has pending work" which is expected behavior.
 *
 * @param command - Command to execute
 * @param args - Command arguments
 * @param cwd - Working directory
 * @throws {Error} if command exits with code other than 0 or 1
 */
async function runCommand(command: string, args: string[], cwd: string): Promise<void> {
  try {
    await execa(command, args, {
      cwd,
      stdio: 'inherit',
      reject: false, // Don't throw on non-zero exit codes, we'll check manually
    }).then((result) => {
      // Exit codes 0 and 1 are both considered success for attest-it
      // 0 = all suites valid, 1 = has pending suites
      if (result.exitCode !== 0 && result.exitCode !== 1) {
        throw new Error(`Command failed with code ${result.exitCode}`)
      }
    })
  } catch (error) {
    // If execa throws (not from our check above), rethrow
    throw error
  }
}

/**
 * Wait for user to press Enter.
 *
 * Used to pause between commands in interactive mode.
 */
async function waitForEnter(): Promise<void> {
  const readline = await import('node:readline')
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise((resolve) => {
    rl.question('', () => {
      rl.close()
      resolve()
    })
  })
}

/**
 * Parse command line arguments.
 *
 * Supports:
 * - Scenario name as positional arg
 * - --non-interactive flag
 * - --output <path> for markdown output
 * - --status <path> for JSON status file
 * - --print-command to show command for user to paste
 *
 * @returns Parsed arguments
 */
function parseArgs(): {
  scenario: string
  isNonInteractive: boolean
  outputPath?: string
  statusPath?: string
  shouldPrintCommand: boolean
} {
  const args = process.argv.slice(2)
  let scenario = 'multi-suite'
  let isNonInteractive = false
  let outputPath: string | undefined
  let statusPath: string | undefined
  let shouldPrintCommand = false

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    if (arg === '--non-interactive') {
      isNonInteractive = true
    } else if (arg === '--output' && i + 1 < args.length) {
      outputPath = args[++i]
    } else if (arg === '--status' && i + 1 < args.length) {
      statusPath = args[++i]
    } else if (arg === '--print-command') {
      shouldPrintCommand = true
    } else if (!arg.startsWith('--')) {
      scenario = arg
    }
  }

  return {
    scenario,
    isNonInteractive,
    outputPath,
    statusPath,
    shouldPrintCommand,
  }
}

/**
 * Print command for user to paste in new terminal.
 *
 * Used with --print-command flag for agent-friendly workflow.
 *
 * @param scenario - Scenario name to include in command
 */
function printCommand(scenario: string): void {
  console.log('\nPaste this command in a new terminal:\n')
  console.log(`cd ${process.cwd()}`)
  console.log(`pnpm test:manual ${scenario} --non-interactive --output ./manual-test-output.md\n`)
}

/**
 * Execute a command with streaming output to agent writer.
 *
 * Spawns the command and pipes stdout/stderr to both the console
 * and the agent output writer for markdown capture.
 *
 * @param command - Command to execute
 * @param args - Command arguments
 * @param cwd - Working directory
 * @param writer - Agent output writer for capturing results
 * @returns Exit code of the command
 */
async function executeCommandWithStreaming(
  command: string,
  args: string[],
  cwd: string,
  writer: AgentOutputWriter,
): Promise<number> {
  const startTime = Date.now()

  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      cwd,
      stdio: ['inherit', 'pipe', 'pipe'],
    })

    proc.on('error', (err) => {
      const duration = Date.now() - startTime
      const errorMsg = `Error spawning command: ${err.message}\n`
      process.stderr.write(errorMsg)
      writer.appendOutput(errorMsg, true)
      writer.completeCommand(1, duration)
      resolve(1)
    })

    proc.stdout.on('data', (data: Buffer) => {
      const text = data.toString()
      process.stdout.write(text) // Also show to user
      writer.appendOutput(text, false)
    })

    proc.stderr.on('data', (data: Buffer) => {
      const text = data.toString()
      process.stderr.write(text)
      writer.appendOutput(text, true)
    })

    proc.on('close', (code) => {
      const duration = Date.now() - startTime
      writer.completeCommand(code ?? 0, duration)
      resolve(code ?? 0)
    })
  })
}

/**
 * Run scenario in non-interactive mode for agent consumption.
 *
 * Executes all commands sequentially, writing results to markdown
 * and status to JSON file for AI agents to monitor.
 *
 * @param scenario - Scenario to execute
 * @param project - Test project fixture
 * @param outputPath - Path to markdown output file
 * @param statusPath - Path to JSON status file
 */
async function runNonInteractive(
  scenario: Scenario,
  project: Project,
  outputPath: string,
  statusPath: string,
): Promise<void> {
  const writer = new AgentOutputWriter()

  try {
    await writer.init(outputPath, statusPath)
    await writer.writeHeader(scenario, project.baseDir)
    await writer.writeAgentInstructions()

    // Initialize commands in status
    const commandList = scenario.commands.map((cmd, index) => ({
      index: index + 1,
      name: cmd.name,
      description: cmd.description,
      status: 'pending' as const,
    }))

    await writer.updateStatus({
      commands: commandList,
      stats: {
        total: scenario.commands.length,
        completed: 0,
        failed: 0,
        skipped: 0,
      },
    })

    const cliPath = join(__dirname, '../dist/bin/attest-it.js')

    // Execute all commands sequentially
    for (let i = 0; i < scenario.commands.length; i++) {
      const cmd = scenario.commands[i]
      await writer.startCommand(i + 1, {
        name: cmd.name,
        description: cmd.description,
      })

      await executeCommandWithStreaming('node', [cliPath, ...cmd.args], project.baseDir, writer)
    }

    const status = writer['statusTracker'].getStatus()
    await writer.writeCompletion(status.stats)
  } catch (error) {
    await writer.updateStatus({
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  } finally {
    await writer.close()
  }
}

/**
 * Display a menu and get user selection.
 *
 * Shows numbered options with "0. Exit" as the last option.
 *
 * @param title - Menu title
 * @param options - Array of menu options
 * @returns Selected option index (1-based), 0 for exit, -1 for invalid
 */
async function displayMenu(title: string, options: string[]): Promise<number> {
  console.log(`\n${title}`)
  console.log('='.repeat(title.length))
  options.forEach((option, index) => {
    console.log(`${index + 1}. ${option}`)
  })
  console.log('0. Exit')
  console.log()

  const readline = await import('node:readline')
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise((resolve) => {
    rl.question('Select option: ', (answer) => {
      rl.close()
      const num = parseInt(answer, 10)
      resolve(isNaN(num) ? -1 : num)
    })
  })
}

/**
 * Setup a scenario by creating the fixture and setting up keys.
 *
 * Creates the test project, generates keypair, and commits initial state.
 *
 * @param scenario - Scenario to set up
 * @returns Created project fixture
 * @throws {Error} if setup fails
 */
async function setupScenario(scenario: Scenario): Promise<Project> {
  console.log('\nCreating test project...')
  const project = await scenario.createFixture()
  console.log(`✓ Project created at: ${project.baseDir}`)

  // Setup the project (generate keypair and commit)
  console.log('Setting up keypair...')
  const cliPath = join(__dirname, '../dist/bin/attest-it.js')

  try {
    // Generate keypair
    console.log('  - Generating keypair...')
    await runCommand(
      'node',
      [cliPath, 'keygen', '--force', '--no-interactive', '--output', '.attest-it/pubkey.pem'],
      project.baseDir,
    )
    console.log('  - Keypair generated')

    // Commit the keypair
    console.log('  - Adding files to git...')
    await runCommand('git', ['add', '.'], project.baseDir)
    console.log('  - Committing keypair...')
    await runCommand('git', ['commit', '-m', 'Add keypair', '--allow-empty'], project.baseDir)
    console.log('  - Committed')

    // Verify git status is clean
    console.log('  - Verifying git status...')
    const { stdout: gitStatus } = await execa('git', ['status', '--porcelain'], {
      cwd: project.baseDir,
    })

    if (gitStatus.trim().length > 0) {
      console.log('  ⚠️  WARNING: Git status not clean!')
      console.log('  Uncommitted files:')
      console.log(gitStatus)
    } else {
      console.log('  - Git status clean ✓')
    }
  } catch (error) {
    console.error('  ✗ Setup failed:', error)
    throw error
  }

  console.log('✓ Setup complete')
  return project
}

/**
 * Run a scenario in interactive mode.
 *
 * Displays a menu of commands and allows the user to execute them
 * repeatedly, or open a shell in the project directory.
 *
 * @param scenario - Scenario to run
 * @param project - Test project fixture
 */
async function runInteractive(scenario: Scenario, project: Project): Promise<void> {
  console.log('\n' + '='.repeat(80))
  console.log('⚠️  IMPORTANT: This is a DEMO project for UI testing only!')
  console.log('='.repeat(80))
  console.log('The "tests" are dummy commands that just print messages.')
  console.log('They do NOT test real code - this is for validating the CLI interface:')
  console.log('  • Visual rendering and colors')
  console.log('  • Keyboard shortcuts and interactions')
  console.log('  • Status badge display')
  console.log('  • Checking for visual artifacts')
  console.log('\nIn a real project, you would:')
  console.log('  1. Run actual tests (npm test, pytest, etc.)')
  console.log('  2. Review the test output manually')
  console.log('  3. Attest that you verified the tests passed')
  console.log('='.repeat(80))
  console.log('\nNote: This is a temporary project that will be cleaned up when you exit.')

  const cliPath = join(__dirname, '../dist/bin/attest-it.js')

  // Run commands in a loop
  let running = true
  while (running) {
    const commandOptions = scenario.commands.map((cmd) => `${cmd.name}: ${cmd.description}`)

    const selection = await displayMenu('Available Commands', [
      ...commandOptions,
      'Open shell in project directory',
    ])

    if (selection === 0) {
      running = false
    } else if (selection === commandOptions.length + 1) {
      // Open shell
      console.log('\nOpening shell in project directory...')
      console.log(`Project: ${project.baseDir}`)
      console.log('Type "exit" to return to the menu.\n')
      await runCommand(process.env.SHELL || 'bash', [], project.baseDir)
    } else if (selection > 0 && selection <= scenario.commands.length) {
      const command = scenario.commands[selection - 1]
      console.log(`\nRunning: attest-it ${command.args.join(' ')}`)
      console.log('-'.repeat(80))
      try {
        await runCommand('node', [cliPath, ...command.args], project.baseDir)
      } catch (error) {
        console.error('Command failed:', error)
      }
      console.log('-'.repeat(80))
      console.log('\nPress Enter to continue...')
      await waitForEnter()
    } else {
      console.log('Invalid selection')
    }
  }
}

/**
 * Run a scenario (either interactive or non-interactive).
 *
 * Sets up the project, runs commands, and cleans up afterwards.
 *
 * @param scenarioKey - Scenario identifier
 * @param isNonInteractive - Whether to run in agent-friendly mode
 * @param outputPath - Optional markdown output path (non-interactive only)
 * @param statusPath - Optional JSON status path (non-interactive only)
 */
async function runScenario(
  scenarioKey: string,
  isNonInteractive: boolean,
  outputPath?: string,
  statusPath?: string,
): Promise<void> {
  const scenario = scenarios[scenarioKey]
  if (!scenario) {
    console.error(`Unknown scenario: ${scenarioKey}`)
    console.log('Available scenarios:', Object.keys(scenarios).join(', '), 'all')
    process.exit(1)
  }

  console.log(`\n${'='.repeat(80)}`)
  console.log(`Scenario: ${scenario.name}`)
  console.log(`Description: ${scenario.description}`)
  console.log('='.repeat(80))

  // Setup the scenario
  const project = await setupScenario(scenario)

  try {
    if (isNonInteractive) {
      const finalOutputPath = outputPath ?? './manual-test-output.md'
      const finalStatusPath = statusPath ?? `${finalOutputPath}.status.json`
      await runNonInteractive(scenario, project, finalOutputPath, finalStatusPath)
    } else {
      await runInteractive(scenario, project)
    }
  } finally {
    // Clean up
    console.log('\nCleaning up test project...')
    await project.dispose()
    console.log('✓ Done')
  }
}

/**
 * Run all scenarios in sequence.
 *
 * Always runs in interactive mode for comprehensive testing.
 */
async function runAllScenarios(): Promise<void> {
  const scenarioKeys = Object.keys(scenarios)

  for (const key of scenarioKeys) {
    await runScenario(key, false) // Always interactive for "all" mode
    console.log('\n')
  }
}

/**
 * Main entry point.
 *
 * Parses args and runs the requested scenario or prints the command
 * for agent-friendly usage.
 */
async function main(): Promise<void> {
  const args = parseArgs()

  // Handle --print-command flag
  if (args.shouldPrintCommand) {
    printCommand(args.scenario)
    return
  }

  console.log('='.repeat(80))
  console.log('Interactive CLI Manual Test Runner')
  console.log('='.repeat(80))
  console.log('\nThis tool helps you visually validate the interactive CLI experience.')
  console.log('It creates realistic test projects for manual testing.\n')

  if (args.scenario === 'all') {
    await runAllScenarios()
  } else {
    await runScenario(args.scenario, args.isNonInteractive, args.outputPath, args.statusPath)
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Error:', error)
    process.exit(1)
  })
}
