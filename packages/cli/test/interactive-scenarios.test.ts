/**
 * Integration tests for interactive CLI scenarios using fixturify-project.
 * These tests validate the interactive experience with realistic project structures.
 *
 * NOTE: These tests are primarily for validating that fixtures can be created and used.
 * For comprehensive visual validation, use the manual test runner:
 *   pnpm test:manual
 */

import { describe, it, expect, afterEach } from 'vitest';
import type { Project } from 'fixturify-project';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  createMultiSuiteFixture,
  createAllValidFixture,
  createAllMissingFixture,
  createComplexGroupsFixture,
} from './helpers/fixture-factory.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CLI_PATH = join(__dirname, '../dist/bin/attest-it.js');

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Helper to run CLI commands in a project directory
 * Uses spawn (like the existing integration tests) instead of exec
 */
async function runCli(args: string[], cwd: string): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn('node', [CLI_PATH, ...args], {
      cwd,
      env: { ...process.env, NO_COLOR: '1' }, // Disable colors for testing
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });

    child.on('error', (err) => {
      resolve({
        exitCode: 1,
        stdout,
        stderr: stderr + err.message,
      });
    });
  });
}

/**
 * Execute a shell command
 */
async function runCommand(
  command: string,
  cwd: string,
): Promise<{ exitCode: number }> {
  return new Promise((resolve) => {
    const child = spawn(command, {
      shell: true,
      cwd,
      stdio: 'pipe',
    });

    child.on('close', (code) => {
      resolve({ exitCode: code ?? 1 });
    });

    child.on('error', () => {
      resolve({ exitCode: 1 });
    });
  });
}

/**
 * Setup helper to initialize a project for CLI use
 */
async function setupProject(proj: Project): Promise<void> {
  // Generate keypair (like integration tests do)
  await runCli(
    ['keygen', '--force', '--public', '.attest-it/pubkey.pem'],
    proj.baseDir,
  );

  // Git init is already done by fixture factory, but ensure keypair is committed
  await runCommand('git add .', proj.baseDir);
  await runCommand(
    'git commit -m "Add keypair" --allow-empty',
    proj.baseDir,
  );
}

describe('Interactive CLI Scenarios with fixturify-project', () => {
  let project: Project | null = null;

  afterEach(async () => {
    if (project) {
      await project.dispose();
      project = null;
    }
  });

  describe('Fixture creation and basic validation', () => {
    it('should create a multi-suite project fixture', async () => {
      project = await createMultiSuiteFixture();
      await setupProject(project);

      // Verify project was created
      expect(project.baseDir).toBeTruthy();

      // Run status command to verify project is valid
      const result = await runCli(['status'], project.baseDir);

      // Exit code 0 = all valid, 1 = has pending suites (both are success)
      expect([0, 1]).toContain(result.exitCode);

      // Should show all 5 suites
      expect(result.stdout).toContain('unit-tests');
      expect(result.stdout).toContain('integration-tests');
      expect(result.stdout).toContain('e2e-tests');
      expect(result.stdout).toContain('linting');
      expect(result.stdout).toContain('type-check');
    });

    it('should create an all-valid project fixture', async () => {
      project = await createAllValidFixture();
      await setupProject(project);

      const result = await runCli(['status'], project.baseDir);

      // Exit code 0 = all valid, 1 = has pending suites
      expect([0, 1]).toContain(result.exitCode);
      expect(result.stdout).toContain('tests');
    });

    it('should create an all-missing project fixture', async () => {
      project = await createAllMissingFixture();
      await setupProject(project);

      const result = await runCli(['status'], project.baseDir);

      // Should have pending suites (exit code 1)
      expect([0, 1]).toContain(result.exitCode);
      expect(result.stdout).toContain('suite-1');
      expect(result.stdout).toContain('suite-2');
      expect(result.stdout).toContain('suite-3');
    });

    it('should create a complex groups project fixture', async () => {
      project = await createComplexGroupsFixture();
      await setupProject(project);

      const result = await runCli(['status'], project.baseDir);

      // Should have pending suites (exit code 1)
      expect([0, 1]).toContain(result.exitCode);
      expect(result.stdout).toContain('frontend-unit');
      expect(result.stdout).toContain('backend-unit');
    });
  });

  describe('CLI commands on fixtures', () => {
    it('should support --help on fixture projects', async () => {
      project = await createMultiSuiteFixture();
      await setupProject(project);

      const result = await runCli(['--help'], project.baseDir);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('attest-it');
    });

    // NOTE: For comprehensive CLI testing including dry-run, interactive mode,
    // filtering, etc., use the manual test runner:
    //   pnpm test:manual
    //
    // The manual test runner allows you to:
    // - Visually validate the interactive UI
    // - Test keyboard shortcuts
    // - Check for visual artifacts
    // - Explore different scenarios interactively
  });
});

