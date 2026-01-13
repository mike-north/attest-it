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
 *   all-valid     - All suites have valid attestations
 *   all-missing   - All suites are missing attestations
 *   all-expired   - All suites have expired attestations
 *   complex       - Complex groups structure with 6 suites
 *   failing       - Project with a failing test suite
 *   all           - Run all scenarios in sequence
 */

import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import {
  createMultiSuiteFixture,
  createAllValidFixture,
  createAllMissingFixture,
  createAllExpiredFixture,
  createComplexGroupsFixture,
  createFailingSuiteFixture,
} from './helpers/fixture-factory.js';
import type { Project } from 'fixturify-project';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface Scenario {
  name: string;
  description: string;
  createFixture: () => Promise<Project>;
  commands: Array<{
    name: string;
    args: string[];
    description: string;
  }>;
}

const scenarios: Record<string, Scenario> = {
  'multi-suite': {
    name: 'Multi-Suite Project',
    description:
      'Project with 5 suites in various states (valid, missing, expired, changed)',
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
        description:
          'Interactive suite selection (use keyboard to select suites)',
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

  'all-valid': {
    name: 'All Valid Suites',
    description: 'All suites have fresh, valid attestations',
    createFixture: createAllValidFixture,
    commands: [
      {
        name: 'status',
        args: ['status'],
        description: 'Should show all suites as VALID',
      },
      {
        name: 'run',
        args: ['run'],
        description: 'Should show message about no pending suites',
      },
    ],
  },

  'all-missing': {
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

  'all-expired': {
    name: 'All Expired Attestations',
    description: 'All suites have expired attestations',
    createFixture: createAllExpiredFixture,
    commands: [
      {
        name: 'status',
        args: ['status'],
        description: 'Should show all suites as STALE',
      },
      {
        name: 'run-interactive',
        args: ['run'],
        description: 'Interactive selection to re-attest',
      },
    ],
  },

  complex: {
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
};

/**
 * Run a command and wait for it to complete
 */
async function runCommand(
  command: string,
  args: string[],
  cwd: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      shell: true,
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with code ${code}`));
      }
    });

    child.on('error', reject);
  });
}

/**
 * Display a menu and get user selection
 */
async function displayMenu(
  title: string,
  options: string[],
): Promise<number> {
  console.log(`\n${title}`);
  console.log('='.repeat(title.length));
  options.forEach((option, index) => {
    console.log(`${index + 1}. ${option}`);
  });
  console.log('0. Exit');
  console.log();

  const readline = await import('node:readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question('Select option: ', (answer) => {
      rl.close();
      const num = parseInt(answer, 10);
      resolve(isNaN(num) ? -1 : num);
    });
  });
}

/**
 * Run a scenario
 */
async function runScenario(scenarioKey: string): Promise<void> {
  const scenario = scenarios[scenarioKey];
  if (!scenario) {
    console.error(`Unknown scenario: ${scenarioKey}`);
    console.log(
      'Available scenarios:',
      Object.keys(scenarios).join(', '),
      'all',
    );
    process.exit(1);
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log(`Scenario: ${scenario.name}`);
  console.log(`Description: ${scenario.description}`);
  console.log('='.repeat(80));

  // Create the fixture
  console.log('\nCreating test project...');
  const project = await scenario.createFixture();

  console.log(`✓ Project created at: ${project.baseDir}`);
  console.log(
    '\nNote: This is a temporary project that will be cleaned up when you exit.',
  );

  try {
    // Get CLI path
    const cliPath = join(__dirname, '../dist/bin/attest-it.js');

    // Run commands in a loop
    let running = true;
    while (running) {
      const commandOptions = scenario.commands.map(
        (cmd) => `${cmd.name}: ${cmd.description}`,
      );

      const selection = await displayMenu('Available Commands', [
        ...commandOptions,
        'Open shell in project directory',
      ]);

      if (selection === 0) {
        running = false;
      } else if (selection === commandOptions.length + 1) {
        // Open shell
        console.log('\nOpening shell in project directory...');
        console.log(`Project: ${project.baseDir}`);
        console.log('Type "exit" to return to the menu.\n');
        await runCommand(process.env.SHELL || 'bash', [], project.baseDir);
      } else if (selection > 0 && selection <= scenario.commands.length) {
        const command = scenario.commands[selection - 1];
        console.log(`\nRunning: attest-it ${command.args.join(' ')}`);
        console.log('-'.repeat(80));
        try {
          await runCommand('node', [cliPath, ...command.args], project.baseDir);
        } catch (error) {
          console.error('Command failed:', error);
        }
        console.log('-'.repeat(80));
        console.log('\nPress Enter to continue...');
        await new Promise<void>((resolve) => {
          process.stdin.once('data', () => resolve());
        });
      } else {
        console.log('Invalid selection');
      }
    }
  } finally {
    // Clean up
    console.log('\nCleaning up test project...');
    await project.dispose();
    console.log('✓ Done');
  }
}

/**
 * Run all scenarios in sequence
 */
async function runAllScenarios(): Promise<void> {
  const scenarioKeys = Object.keys(scenarios);

  for (const key of scenarioKeys) {
    await runScenario(key);
    console.log('\n');
  }
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const scenarioArg = process.argv[2] || 'multi-suite';

  console.log('='.repeat(80));
  console.log('Interactive CLI Manual Test Runner');
  console.log('='.repeat(80));
  console.log(
    '\nThis tool helps you visually validate the interactive CLI experience.',
  );
  console.log('It creates realistic test projects for manual testing.\n');

  if (scenarioArg === 'all') {
    await runAllScenarios();
  } else {
    await runScenario(scenarioArg);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
}
