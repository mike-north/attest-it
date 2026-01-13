/**
 * Example: Basic fixture usage
 *
 * This file demonstrates how to use the fixture factory to create
 * realistic test projects for testing the interactive CLI.
 */

import {
  createProjectFixture,
  createMultiSuiteFixture,
} from '../helpers/fixture-factory.js';
import type { Project } from 'fixturify-project';

/**
 * Example 1: Create a simple project with one suite
 */
async function example1(): Promise<void> {
  console.log('Example 1: Simple project with one suite\n');

  const project = await createProjectFixture({
    name: 'simple-project',
    suites: [
      {
        name: 'tests',
        command: 'node -e "console.log(\'Tests passed\')"',
        maxAge: '30d',
      },
    ],
  });

  console.log('Project created at:', project.baseDir);
  console.log('Run: cd', project.baseDir, '&& attest-it status');
  console.log();

  // Clean up
  await project.dispose();
}

/**
 * Example 2: Create a project with multiple suites and attestations
 */
async function example2(): Promise<void> {
  console.log('Example 2: Project with multiple suites and attestations\n');

  const project = await createProjectFixture({
    name: 'multi-suite-project',
    suites: [
      {
        name: 'unit-tests',
        command: 'npm test',
        maxAge: '30d',
        groups: ['tests'],
      },
      {
        name: 'linting',
        command: 'npm run lint',
        maxAge: '1d',
        groups: ['quality'],
      },
    ],
    attestations: [
      // Fresh attestation for unit tests
      { suiteName: 'unit-tests', daysOld: 1 },
      // Expired attestation for linting
      { suiteName: 'linting', daysOld: 5 },
    ],
  });

  console.log('Project created at:', project.baseDir);
  console.log('Suites:');
  console.log('  - unit-tests (VALID - 1 day old)');
  console.log('  - linting (STALE - 5 days old, max 1d)');
  console.log();

  await project.dispose();
}

/**
 * Example 3: Use pre-configured fixtures
 */
async function example3(): Promise<void> {
  console.log('Example 3: Pre-configured multi-suite fixture\n');

  const project = await createMultiSuiteFixture();

  console.log('Project created at:', project.baseDir);
  console.log('This fixture includes:');
  console.log('  - 5 suites in various states');
  console.log('  - Mixed attestation states (valid, expired, missing, changed)');
  console.log('  - Groups for organization');
  console.log();

  await project.dispose();
}

/**
 * Example 4: Create a custom project with additional files
 */
async function example4(): Promise<void> {
  console.log('Example 4: Project with custom files\n');

  const project = await createProjectFixture({
    name: 'custom-project',
    suites: [
      {
        name: 'build',
        command: 'npm run build',
        maxAge: '7d',
      },
    ],
    files: {
      'README.md': '# My Project\n\nThis is a test project.',
      'src/index.ts': 'export const greeting = "Hello, World!";',
      'src/utils/math.ts': 'export const add = (a: number, b: number) => a + b;',
      '.gitignore': 'node_modules/\ndist/',
    },
  });

  console.log('Project created at:', project.baseDir);
  console.log('Custom files:');
  console.log('  - README.md');
  console.log('  - src/index.ts');
  console.log('  - src/utils/math.ts');
  console.log('  - .gitignore');
  console.log();

  await project.dispose();
}

/**
 * Example 5: Keep project for manual inspection
 */
async function example5(): Promise<void> {
  console.log('Example 5: Keep project for manual inspection\n');

  const project = await createMultiSuiteFixture();

  console.log('Project created at:', project.baseDir);
  console.log();
  console.log('The project will NOT be cleaned up.');
  console.log('You can explore it manually:');
  console.log('  cd', project.baseDir);
  console.log('  attest-it status');
  console.log('  attest-it run');
  console.log();
  console.log('Clean up manually when done:');
  console.log('  rm -rf', project.baseDir);
  console.log();

  // Don't call dispose() to keep the project around
  // await project.dispose();
}

/**
 * Example 6: Use in a test
 */
async function example6(): Promise<void> {
  console.log('Example 6: Using fixtures in automated tests\n');

  console.log('In a Vitest test file:');
  console.log(`
import { describe, it, expect, afterEach } from 'vitest';
import { createMultiSuiteFixture } from './helpers/fixture-factory.js';
import type { Project } from 'fixturify-project';

describe('Interactive CLI', () => {
  let project: Project | null = null;

  afterEach(async () => {
    if (project) {
      await project.dispose();
      project = null;
    }
  });

  it('should show status for multi-suite project', async () => {
    project = await createMultiSuiteFixture();

    // Run CLI command
    const result = await runCli(['status'], project.baseDir);

    // Assert output
    expect(result.stdout).toContain('VALID');
    expect(result.stdout).toContain('STALE');
    expect(result.stdout).toContain('MISSING');
  });
});
  `);
}

// Run examples
async function main(): Promise<void> {
  const exampleNumber = process.argv[2];

  if (exampleNumber === '1') {
    await example1();
  } else if (exampleNumber === '2') {
    await example2();
  } else if (exampleNumber === '3') {
    await example3();
  } else if (exampleNumber === '4') {
    await example4();
  } else if (exampleNumber === '5') {
    await example5();
  } else if (exampleNumber === '6') {
    await example6();
  } else {
    console.log('Fixture Factory Examples\n');
    console.log('Usage: tsx examples/basic-fixture-usage.ts <example-number>');
    console.log();
    console.log('Available examples:');
    console.log('  1 - Simple project with one suite');
    console.log('  2 - Project with multiple suites and attestations');
    console.log('  3 - Pre-configured multi-suite fixture');
    console.log('  4 - Project with custom files');
    console.log('  5 - Keep project for manual inspection');
    console.log('  6 - Using fixtures in automated tests');
    console.log();
  }
}

main().catch(console.error);
