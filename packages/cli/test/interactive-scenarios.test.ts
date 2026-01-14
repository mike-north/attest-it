/**
 * Integration tests for interactive CLI scenarios using fixturify-project.
 * These tests validate the interactive experience with realistic project structures.
 *
 * NOTE: These tests are primarily for validating that fixtures can be created and used.
 * For comprehensive visual validation, use the manual test runner:
 *   pnpm test:manual
 */

import { describe, it, expect, afterEach } from 'vitest'
import type { Project } from 'fixturify-project'
import { execa } from 'execa'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  createMultiSuiteFixture,
  createAllMissingFixture,
  createComplexGroupsFixture,
  createProjectFixture,
} from './helpers/fixture-factory.js'
import { wrapWithSignatureErrorDetection } from './helpers/ai-friendly-errors.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const CLI_PATH = join(__dirname, '../dist/bin/attest-it.js')

interface RunResult {
  exitCode: number
  stdout: string
  stderr: string
}

/**
 * Helper to run CLI commands in a project directory
 */
async function runCli(args: string[], cwd: string): Promise<RunResult> {
  const result = await execa('node', [CLI_PATH, ...args], {
    cwd,
    env: { ...process.env, NO_COLOR: '1' }, // Disable colors for testing
    reject: false, // Don't throw on non-zero exit codes
  })

  return {
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
  }
}

/**
 * Execute a shell command
 */
async function runCommand(command: string, cwd: string): Promise<{ exitCode: number }> {
  const result = await execa(command, {
    cwd,
    shell: true,
    reject: false,
  })

  return { exitCode: result.exitCode }
}

/**
 * Setup helper to initialize a project for CLI use
 */
async function setupProject(proj: Project): Promise<void> {
  return wrapWithSignatureErrorDetection(async () => {
    // Generate keypair with project-local private key to avoid conflicts
    const privateKeyPath = join(proj.baseDir, '.attest-it', 'private.pem')
    const publicKeyPath = join(proj.baseDir, '.attest-it', 'pubkey.pem')

    const keygenResult = await runCli(
      [
        'keygen',
        '--force',
        '--no-interactive',
        '--private',
        privateKeyPath,
        '--output',
        publicKeyPath,
      ],
      proj.baseDir,
    )

    if (keygenResult.exitCode !== 0) {
      throw new Error(
        `Keygen failed:\nExit code: ${keygenResult.exitCode}\n` +
          `Stderr: ${keygenResult.stderr}\nStdout: ${keygenResult.stdout}`,
      )
    }

    // Verify keypair was created
    const fs = await import('node:fs/promises')
    try {
      await fs.access(publicKeyPath)
      await fs.access(privateKeyPath)
    } catch {
      throw new Error(
        `Keypair not created:\nPublic key: ${publicKeyPath}\nPrivate key: ${privateKeyPath}`,
      )
    }

    // Git init is already done by fixture factory, but ensure keypair is committed
    await runCommand('git add .', proj.baseDir)
    await runCommand('git commit -m "Add keypair" --allow-empty', proj.baseDir)
  }, `Setting up project with keypair in ${proj.baseDir}`)
}

/**
 * Check if git working tree is clean
 */
async function checkGitStatus(cwd: string): Promise<string> {
  const result = await execa('git', ['status', '--porcelain'], {
    cwd,
  })
  return result.stdout.trim()
}

describe('Interactive CLI Scenarios with fixturify-project', () => {
  let project: Project | null = null

  afterEach(async () => {
    if (project) {
      await project.dispose()
      project = null
    }
  })

  describe('Fixture creation and basic validation', () => {
    it('should have a clean git working tree after setup', async () => {
      project = await createMultiSuiteFixture()
      await setupProject(project)

      // Check git status - should be clean (no uncommitted changes)
      const gitStatus = await checkGitStatus(project.baseDir)

      if (gitStatus.length > 0) {
        console.log('Git status output:', gitStatus)
      }

      expect(gitStatus).toBe('')
    })
    it('should create a multi-suite project fixture', async () => {
      project = await createMultiSuiteFixture()
      await setupProject(project)

      // Verify project was created
      expect(project.baseDir).toBeTruthy()

      // Run status command to verify project is valid
      const result = await runCli(['status'], project.baseDir)

      // Exit code 0 = all valid, 1 = has pending suites (both are success)
      expect([0, 1]).toContain(result.exitCode)

      // Should show all 5 suites
      expect(result.stdout).toContain('unit-tests')
      expect(result.stdout).toContain('integration-tests')
      expect(result.stdout).toContain('e2e-tests')
      expect(result.stdout).toContain('linting')
      expect(result.stdout).toContain('type-check')
    })

    it('should create a simple project fixture', async () => {
      project = await createProjectFixture({
        name: 'simple-test',
        suites: [
          {
            name: 'tests',
            command: 'node -e "console.log(\'tests passed\')"',
            maxAge: '30d',
          },
        ],
      })
      await setupProject(project)

      const result = await runCli(['status'], project.baseDir)

      // Exit code 1 = has pending suites (since no attestations created yet)
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toContain('tests')
    })

    it('should create an all-missing project fixture', async () => {
      project = await createAllMissingFixture()
      await setupProject(project)

      const result = await runCli(['status'], project.baseDir)

      // Should have pending suites (exit code 1)
      expect([0, 1]).toContain(result.exitCode)
      expect(result.stdout).toContain('suite-1')
      expect(result.stdout).toContain('suite-2')
      expect(result.stdout).toContain('suite-3')
    })

    it('should create a complex groups project fixture', async () => {
      project = await createComplexGroupsFixture()
      await setupProject(project)

      const result = await runCli(['status'], project.baseDir)

      // Should have pending suites (exit code 1)
      expect([0, 1]).toContain(result.exitCode)
      expect(result.stdout).toContain('frontend-unit')
      expect(result.stdout).toContain('backend-unit')
    })
  })

  describe('CLI commands on fixtures', () => {
    it('should support --help on fixture projects', async () => {
      project = await createMultiSuiteFixture()
      await setupProject(project)

      const result = await runCli(['--help'], project.baseDir)

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('attest-it')
    })

    // NOTE: For comprehensive CLI testing including dry-run, interactive mode,
    // filtering, etc., use the manual test runner:
    //   pnpm test:manual
    //
    // The manual test runner allows you to:
    // - Visually validate the interactive UI
    // - Test keyboard shortcuts
    // - Check for visual artifacts
    // - Explore different scenarios interactively
  })
})
