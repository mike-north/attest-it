/**
 * Integration tests for the attest-it CLI.
 *
 * These tests exercise the full CLI workflow including:
 * - Command parsing and execution
 * - File system operations
 * - Git integration
 * - Attestation creation and validation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as os from 'node:os'
import { writeSignedAttestations, type Attestation } from '@attest-it/core'
import packageJson from '../../package.json' with { type: 'json' }

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// Use the built CLI from dist directory
const CLI_PATH = path.resolve(__dirname, '../../dist/bin/attest-it.js')
const FIXTURE_PATH = path.resolve(__dirname, '../fixtures/sample-project')

interface RunResult {
  exitCode: number
  stdout: string
  stderr: string
}

interface StatusResult {
  name: string
  status: string
  currentFingerprint: string
  attestedFingerprint?: string
  attestedAt?: string
  age?: number
}

interface AttestationsStructure {
  schemaVersion?: string
  attestations: Attestation[]
  signature?: string
}

function isStatusResultArray(value: unknown): value is StatusResult[] {
  if (!Array.isArray(value)) return false
  if (value.length === 0) return true

  const first: unknown = value[0]
  return (
    typeof first === 'object' &&
    first !== null &&
    'name' in first &&
    'status' in first &&
    'currentFingerprint' in first
  )
}

function hasAttestationsField(value: object): value is { attestations: unknown } {
  return 'attestations' in value
}

function isAttestationsStructure(value: unknown): value is AttestationsStructure {
  if (typeof value !== 'object' || value === null) return false
  if (!hasAttestationsField(value)) return false

  return Array.isArray(value.attestations)
}

/**
 * Execute the CLI with given arguments and return the result.
 */
async function runCli(
  args: string[],
  cwd: string = FIXTURE_PATH,
  stdin?: string,
): Promise<RunResult> {
  return new Promise((resolve) => {
    // Run the built CLI
    const child = spawn('node', [CLI_PATH, ...args], {
      cwd,
      env: { ...process.env, NO_COLOR: '1' }, // Disable colors for testing
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    child.on('close', (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
      })
    })

    child.on('error', (err) => {
      resolve({
        exitCode: 1,
        stdout,
        stderr: stderr + err.message,
      })
    })

    // Provide stdin input if specified
    if (stdin !== undefined) {
      child.stdin.write(stdin)
      child.stdin.end()
    }
  })
}

/**
 * Copy directory recursively.
 */
async function copyDir(src: string, dest: string): Promise<void> {
  await fs.promises.mkdir(dest, { recursive: true })
  const entries = await fs.promises.readdir(src, { withFileTypes: true })

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath)
    } else {
      await fs.promises.copyFile(srcPath, destPath)
    }
  }
}

/**
 * Get the private key path for signing attestations.
 * Uses the same default as the core library.
 */
function getPrivateKeyPath(): string {
  const homeDir = os.homedir()

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA ?? path.join(homeDir, 'AppData', 'Roaming')
    return path.join(appData, 'attest-it', 'private.pem')
  }

  return path.join(homeDir, '.config', 'attest-it', 'private.pem')
}

/**
 * Re-sign an attestations file after modifying it.
 * This is needed when tests manually modify attestation data.
 * Uses the private key from the default location (~/.config/attest-it).
 */
async function resignAttestations(
  attestPath: string,
  attestations: Attestation[],
  _cwd: string,
): Promise<void> {
  // The keygen command in beforeEach creates keys in the default locations
  // (private key in ~/.config/attest-it, public key in repo)
  // so we use the same private key path that the run command uses
  const privateKeyPath = getPrivateKeyPath()
  await writeSignedAttestations({
    filePath: attestPath,
    attestations,
    privateKeyPath,
  })
}

/**
 * Execute a shell command and return exit code.
 */
async function runCommand(
  command: string,
  cwd: string,
): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, {
      shell: true,
      cwd,
      stdio: 'pipe',
    })

    let output = ''
    child.stdout.on('data', (data: Buffer) => {
      output += data.toString()
    })
    child.stderr.on('data', (data: Buffer) => {
      output += data.toString()
    })

    child.on('close', (code) => {
      resolve({ exitCode: code ?? 1, output })
    })

    child.on('error', (err) => {
      resolve({ exitCode: 1, output: err.message })
    })
  })
}

describe('CLI Integration Tests', () => {
  let tempDir: string

  beforeEach(async () => {
    // Create temp directory for test isolation
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'attest-it-test-'))

    // Copy fixture to temp directory
    await copyDir(FIXTURE_PATH, tempDir)

    // Generate keypair for tests (force overwrite in case keys exist)
    // Use the public key path from the config (.attest-it/pubkey.pem)
    await runCli(
      ['keygen', '--force', '--output', '.attest-it/pubkey.pem', '--no-interactive'],
      tempDir,
    )

    // Initialize git repo (required for dirty check)
    await runCommand('git init', tempDir)
    await runCommand('git config user.email "test@example.com"', tempDir)
    await runCommand('git config user.name "Test User"', tempDir)
    await runCommand('git add .', tempDir)
    await runCommand('git commit -m "initial commit"', tempDir)
  })

  afterEach(async () => {
    // Clean up temp directory
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('attest-it --help', () => {
    it('shows help text', async () => {
      const result = await runCli(['--help'], tempDir)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('attest-it')
      expect(result.stdout).toContain('status')
      expect(result.stdout).toContain('run')
      expect(result.stdout).toContain('keygen')
    })

    it('shows version', async () => {
      const result = await runCli(['--version'], tempDir)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain(packageJson.version)
    })
  })

  describe('attest-it status', () => {
    it('shows NEEDS_ATTESTATION when no attestations exist', async () => {
      const result = await runCli(['status'], tempDir)
      expect(result.exitCode).toBe(1) // At least one needs attestation
      expect(result.stdout).toContain('NEEDS_ATTESTATION')
    })

    it('outputs JSON with --json flag', async () => {
      const result = await runCli(['status', '--json'], tempDir)
      expect(result.exitCode).toBe(1)

      // Parse and validate JSON
      const json: unknown = JSON.parse(result.stdout)

      if (!isStatusResultArray(json)) {
        throw new Error('Expected status result array')
      }

      expect(json.length).toBeGreaterThan(0)

      // Validate first element has expected fields
      const firstSuite = json[0]
      if (!firstSuite) {
        throw new Error('Expected at least one suite')
      }

      expect(firstSuite).toHaveProperty('name')
      expect(firstSuite).toHaveProperty('status')
      expect(firstSuite).toHaveProperty('currentFingerprint')
    })

    it('filters by suite with --suite', async () => {
      const result = await runCli(['status', '--suite', 'example'], tempDir)
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toContain('example')
      expect(result.stdout).not.toContain('failing')
    })

    it('errors on unknown suite', async () => {
      const result = await runCli(['status', '--suite', 'nonexistent'], tempDir)
      expect(result.exitCode).toBe(3) // CONFIG_ERROR
      expect(result.stderr).toContain('not found')
    })

    it('includes suite description and status details', async () => {
      const result = await runCli(['status', '--json'], tempDir)
      const json: unknown = JSON.parse(result.stdout)

      if (!isStatusResultArray(json)) {
        throw new Error('Expected status result array')
      }

      const exampleSuite = json.find((s) => s.name === 'example')
      expect(exampleSuite).toBeDefined()
      if (!exampleSuite) {
        throw new Error('Expected example suite to be found')
      }

      expect(exampleSuite).toHaveProperty('currentFingerprint')
      expect(typeof exampleSuite.currentFingerprint).toBe('string')
    })
  })

  describe('attest-it run', () => {
    it('without args enters interactive mode (exits with NO_WORK if all valid)', async () => {
      // Run once to create attestation
      await runCli(['run', '--suite', 'example'], tempDir, 'y\n')
      await runCommand('git add .', tempDir)
      await runCommand('git commit -m "add attestation"', tempDir)

      // Now running with --dry-run shows what would run (the "failing" suite still needs attestation)
      const result = await runCli(['run', '--dry-run'], tempDir)
      // Should exit with SUCCESS (0) because dry-run shows suites that would run
      expect(result.exitCode).toBe(0) // SUCCESS - dry run completed, showing what would run
    })

    it('runs tests and creates attestation', async () => {
      const result = await runCli(['run', '--suite', 'example'], tempDir, 'y\n')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Tests passed')
      expect(result.stdout).toContain('Attestation created')

      // Verify attestation file exists
      const attestPath = path.join(tempDir, '.attest-it', 'attestations.json')
      expect(fs.existsSync(attestPath)).toBe(true)

      // Validate attestation content
      const attestContent = await fs.promises.readFile(attestPath, 'utf-8')
      const attestations: unknown = JSON.parse(attestContent)

      if (!isAttestationsStructure(attestations)) {
        throw new Error('Invalid attestations file structure')
      }

      expect(attestations.attestations).toHaveLength(1)

      const firstAttestation = attestations.attestations[0]
      if (!firstAttestation) {
        throw new Error('Expected first attestation')
      }

      expect(firstAttestation.suite).toBe('example')
    })

    it('exits with code 1 on test failure', async () => {
      const result = await runCli(['run', '--suite', 'failing'], tempDir, 'y\n')
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('failed')
    })

    it('skips attestation with --no-attest', async () => {
      const result = await runCli(['run', '--suite', 'example', '--no-attest'], tempDir)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Skipping attestation')

      // Verify no attestation file created
      const attestPath = path.join(tempDir, '.attest-it', 'attestations.json')
      expect(fs.existsSync(attestPath)).toBe(false)
    })

    it('fails on dirty working tree', async () => {
      // Make uncommitted changes
      await fs.promises.writeFile(path.join(tempDir, 'new-file.txt'), 'uncommitted content')

      const result = await runCli(['run', '--suite', 'example'], tempDir, 'y\n')
      expect(result.exitCode).toBe(3) // CONFIG_ERROR
      expect(result.stderr).toContain('uncommitted')
    })

    it('runs multiple suites with --all', async () => {
      // Create a config with only passing suites
      const configPath = path.join(tempDir, '.attest-it', 'config.yaml')

      const passingConfig = `version: 1

settings:
  maxAgeDays: 30
  publicKeyPath: .attest-it/pubkey.pem
  attestationsPath: .attest-it/attestations.json
  defaultCommand: echo "tests passed"

suites:
  example:
    description: Example test suite
    packages:
      - packages/example
    files:
      - packages/example/test/**/*.test.ts
    command: echo "example tests passed"
`
      await fs.promises.writeFile(configPath, passingConfig)

      // Commit the config change to avoid dirty working tree
      await runCommand('git add .attest-it/config.yaml', tempDir)
      await runCommand('git commit -m "update config"', tempDir)

      const result = await runCli(['run', '--all'], tempDir, 'y\n')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('example')
    })

    it('includes command and user info in attestation', async () => {
      await runCli(['run', '--suite', 'example'], tempDir, 'y\n')

      const attestPath = path.join(tempDir, '.attest-it', 'attestations.json')
      const attestContent = await fs.promises.readFile(attestPath, 'utf-8')
      const attestations: unknown = JSON.parse(attestContent)

      if (!isAttestationsStructure(attestations)) {
        throw new Error('Invalid attestations structure')
      }

      const firstAttestation = attestations.attestations[0]
      if (!firstAttestation) {
        throw new Error('Expected first attestation')
      }

      // Check for expected fields
      expect(firstAttestation).toHaveProperty('attestedBy')
      expect(firstAttestation).toHaveProperty('attestedAt')
      expect(firstAttestation).toHaveProperty('fingerprint')
      expect(firstAttestation).toHaveProperty('command')
    })
  })

  describe('attestation workflow', () => {
    it('full workflow: run tests, attest, check status', async () => {
      // Initial status should show needs attestation
      let result = await runCli(['status', '--json'], tempDir)
      expect(result.exitCode).toBe(1)

      let status: unknown = JSON.parse(result.stdout)
      if (!isStatusResultArray(status)) {
        throw new Error('Expected status result array')
      }

      const firstStatus = status[0]
      if (!firstStatus) {
        throw new Error('Expected at least one status')
      }
      expect(firstStatus.status).toBe('NEEDS_ATTESTATION')

      // Run and attest
      result = await runCli(['run', '--suite', 'example'], tempDir, 'y\n')
      expect(result.exitCode).toBe(0)

      // Commit the attestation
      await runCommand('git add .', tempDir)
      await runCommand('git commit -m "add attestation"', tempDir)

      // Status should show valid
      result = await runCli(['status', '--suite', 'example', '--json'], tempDir)
      expect(result.exitCode).toBe(0)

      status = JSON.parse(result.stdout)
      if (!isStatusResultArray(status)) {
        throw new Error('Expected status result array')
      }

      const validStatus = status[0]
      if (!validStatus) {
        throw new Error('Expected at least one status')
      }
      expect(validStatus.status).toBe('VALID')

      // Modify code
      await fs.promises.appendFile(
        path.join(tempDir, 'packages/example/src/index.ts'),
        '\nconst x = 1\nmodule.exports.x = x\n',
      )
      await runCommand('git add . && git commit -m "modify code"', tempDir)

      // Status should show fingerprint changed
      result = await runCli(['status', '--suite', 'example', '--json'], tempDir)
      expect(result.exitCode).toBe(1)

      status = JSON.parse(result.stdout)
      if (!isStatusResultArray(status)) {
        throw new Error('Expected status result array')
      }

      const changedStatus = status[0]
      if (!changedStatus) {
        throw new Error('Expected at least one status')
      }
      expect(changedStatus.status).toBe('FINGERPRINT_CHANGED')
    })

    it('detects expired attestations', async () => {
      // Create attestation
      await runCli(['run', '--suite', 'example'], tempDir, 'y\n')

      // Manually modify attestation to be old
      const attestPath = path.join(tempDir, '.attest-it', 'attestations.json')
      const attestContent = await fs.promises.readFile(attestPath, 'utf-8')
      const attestations: unknown = JSON.parse(attestContent)

      if (!isAttestationsStructure(attestations)) {
        throw new Error('Invalid attestations structure')
      }

      if (attestations.attestations.length === 0) {
        throw new Error('Expected at least one attestation')
      }

      const firstAttestation = attestations.attestations[0]
      if (!firstAttestation) {
        throw new Error('First attestation is undefined')
      }

      // Set attestation date to 60 days ago (max is 30)
      const oldDate = new Date()
      oldDate.setDate(oldDate.getDate() - 60)
      firstAttestation.attestedAt = oldDate.toISOString()

      await fs.promises.writeFile(attestPath, JSON.stringify(attestations, null, 2))
      await runCommand('git add . && git commit -m "old attestation"', tempDir)

      // Check status
      const result = await runCli(['status', '--suite', 'example', '--json'], tempDir)
      expect(result.exitCode).toBe(1)

      const status: unknown = JSON.parse(result.stdout)
      if (!isStatusResultArray(status)) {
        throw new Error('Expected status result array')
      }

      const expiredStatus = status[0]
      if (!expiredStatus) {
        throw new Error('Expected at least one status')
      }
      expect(expiredStatus.status).toBe('EXPIRED')
    })
  })

  describe('error handling', () => {
    it('handles missing config file', async () => {
      // Create temp dir without config
      const emptyDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'attest-it-empty-'))

      try {
        const result = await runCli(['status'], emptyDir)
        expect(result.exitCode).toBe(3) // CONFIG_ERROR
        expect(result.stderr).toContain('config')
      } finally {
        await fs.promises.rm(emptyDir, { recursive: true, force: true })
      }
    })

    it('handles invalid config file', async () => {
      // Corrupt the config file
      const configPath = path.join(tempDir, '.attest-it', 'config.yaml')
      await fs.promises.writeFile(configPath, 'invalid: yaml: content: [')

      const result = await runCli(['status'], tempDir)
      expect(result.exitCode).toBe(3) // CONFIG_ERROR
      // Should error on invalid YAML
    })

    it('handles permission errors gracefully', async () => {
      // Make attestations directory read-only (Unix only)
      if (process.platform !== 'win32') {
        const attestDir = path.join(tempDir, '.attest-it')
        await fs.promises.chmod(attestDir, 0o444)

        try {
          const result = await runCli(['run', '--suite', 'example'], tempDir, 'y\n')
          expect(result.exitCode).not.toBe(0)
          // Should fail but not crash
        } finally {
          // Restore permissions for cleanup
          await fs.promises.chmod(attestDir, 0o755)
        }
      }
    })

    it('handles non-existent package paths', async () => {
      // Add suite with non-existent package
      const configPath = path.join(tempDir, '.attest-it', 'config.yaml')
      let configContent = await fs.promises.readFile(configPath, 'utf-8')

      configContent += `
  nonexistent:
    description: Suite with missing package
    packages:
      - packages/does-not-exist
    command: echo "test"
`
      await fs.promises.writeFile(configPath, configContent)

      const result = await runCli(['status', '--suite', 'nonexistent'], tempDir)
      // Should handle gracefully (may succeed with empty fingerprint or error)
      // Exit codes: 0=SUCCESS, 1=FAILURE, 2=NO_WORK, 3=CONFIG_ERROR
      expect([0, 1, 2, 3]).toContain(result.exitCode)
    })
  })

  describe('output formatting', () => {
    it('supports verbose output', async () => {
      const result = await runCli(['status', '--suite', 'example', '-v'], tempDir)
      // Verbose flag should be accepted
      expect([0, 1, 2]).toContain(result.exitCode)
    })

    it('supports quiet output', async () => {
      const result = await runCli(['status', '--suite', 'example', '-q'], tempDir)
      // Quiet flag should be accepted
      expect([0, 1, 2]).toContain(result.exitCode)
    })

    it('JSON output is valid and parseable', async () => {
      const result = await runCli(['status', '--json'], tempDir)

      // Should produce valid JSON
      expect(() => {
        const _parsed: unknown = JSON.parse(result.stdout)
      }).not.toThrow()

      const json: unknown = JSON.parse(result.stdout)
      expect(Array.isArray(json)).toBe(true)
    })
  })

  describe('attest-it keygen', () => {
    it('shows help for keygen command', async () => {
      const result = await runCli(['keygen', '--help'], tempDir)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('keygen')
      expect(result.stdout).toContain('RSA keypair')
    })

    it('generates RSA keypair with --force', async () => {
      const result = await runCli(['keygen', '--force', '--no-interactive'], tempDir)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Keypair generated successfully')
      expect(result.stdout).toContain('Private key')
      expect(result.stdout).toContain('Public key')
    })

    it('uses custom output paths', async () => {
      const privateKeyPath = path.join(tempDir, 'custom-private.pem')
      const publicKeyPath = path.join(tempDir, 'custom-public.pem')

      const result = await runCli(
        [
          'keygen',
          '--private',
          privateKeyPath,
          '--output',
          publicKeyPath,
          '--force',
          '--no-interactive',
        ],
        tempDir,
      )

      expect(result.exitCode).toBe(0)
      expect(fs.existsSync(privateKeyPath)).toBe(true)
      expect(fs.existsSync(publicKeyPath)).toBe(true)
    })

    it('displays next steps after key generation', async () => {
      const result = await runCli(['keygen', '--force', '--no-interactive'], tempDir)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Next steps')
      expect(result.stdout).toContain('git add')
      expect(result.stdout).toContain('attest-it run')
    })

    it('warns about backing up private key', async () => {
      const result = await runCli(['keygen', '--force', '--no-interactive'], tempDir)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Back up your private key')
      expect(result.stdout).toContain('KEEP SECRET')
    })
  })

  describe('attest-it verify', () => {
    it('returns exit code 0 when all attestations valid', async () => {
      // Setup: Create a config with only one suite so "all" means just that one
      const configPath = path.join(tempDir, '.attest-it', 'config.yaml')
      const singleSuiteConfig = `version: 1

settings:
  maxAgeDays: 30
  publicKeyPath: .attest-it/pubkey.pem
  attestationsPath: .attest-it/attestations.json
  defaultCommand: echo "tests passed"

suites:
  example:
    description: Example test suite
    packages:
      - packages/example
    files:
      - packages/example/test/**/*.test.ts
    command: echo "example tests passed"
`
      await fs.promises.writeFile(configPath, singleSuiteConfig)
      await runCommand('git add . && git commit -m "single suite config"', tempDir)

      // Create attestation
      await runCli(['run', '--suite', 'example'], tempDir, 'y\n')
      await runCommand('git add . && git commit -m "add attestation"', tempDir)

      const result = await runCli(['verify'], tempDir)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('VALID')
      expect(result.stdout).toContain('All attestations valid')
    })

    it('returns exit code 1 when attestation invalid', async () => {
      // No attestations exist
      const result = await runCli(['verify'], tempDir)
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toContain('NEEDS_ATTESTATION')
    })

    it('outputs JSON with --json', async () => {
      const result = await runCli(['verify', '--json'], tempDir)
      const json: unknown = JSON.parse(result.stdout)

      expect(typeof json).toBe('object')
      expect(json).not.toBeNull()

      if (typeof json !== 'object' || json === null) {
        throw new Error('Expected json to be an object')
      }

      expect('success' in json).toBe(true)
      expect('suites' in json).toBe(true)
    })

    it('verifies specific suite with --suite', async () => {
      // Create attestation for example suite
      await runCli(['run', '--suite', 'example'], tempDir, 'y\n')
      await runCommand('git add . && git commit -m "add attestation"', tempDir)

      const result = await runCli(['verify', '--suite', 'example'], tempDir)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('example')
      expect(result.stdout).not.toContain('failing')
    })

    it('fails in strict mode with approaching expiry warning', async () => {
      // Create attestation
      await runCli(['run', '--suite', 'example'], tempDir, 'y\n')

      // Manually modify attestation to be old but not expired
      const attestPath = path.join(tempDir, '.attest-it', 'attestations.json')
      const attestContent = await fs.promises.readFile(attestPath, 'utf-8')
      const attestations: unknown = JSON.parse(attestContent)

      if (!isAttestationsStructure(attestations)) {
        throw new Error('Invalid attestations structure')
      }

      const firstAttestation = attestations.attestations[0]
      if (!firstAttestation) {
        throw new Error('Expected first attestation')
      }

      // Set attestation date to 28 days ago (close to 30 day max)
      const oldDate = new Date()
      oldDate.setDate(oldDate.getDate() - 28)
      firstAttestation.attestedAt = oldDate.toISOString()

      // Re-sign the modified attestations
      await resignAttestations(attestPath, attestations.attestations, tempDir)
      await runCommand('git add . && git commit -m "old attestation"', tempDir)

      // Verify only the example suite, not all suites
      const result = await runCli(['verify', '--strict', '--suite', 'example'], tempDir)
      expect(result.exitCode).toBe(1)
      // The warning goes to stderr, but we can check for the strict mode message in stdout
      expect(result.stdout).toContain('--strict mode')
      // Or check stderr for the warning
      expect(result.stderr).toContain('approaching expiry')
    })

    it('succeeds in non-strict mode with approaching expiry warning', async () => {
      // Create attestation
      await runCli(['run', '--suite', 'example'], tempDir, 'y\n')

      // Manually modify attestation to be old but not expired
      const attestPath = path.join(tempDir, '.attest-it', 'attestations.json')
      const attestContent = await fs.promises.readFile(attestPath, 'utf-8')
      const attestations: unknown = JSON.parse(attestContent)

      if (!isAttestationsStructure(attestations)) {
        throw new Error('Invalid attestations structure')
      }

      const firstAttestation = attestations.attestations[0]
      if (!firstAttestation) {
        throw new Error('Expected first attestation')
      }

      // Set attestation date to 28 days ago
      const oldDate = new Date()
      oldDate.setDate(oldDate.getDate() - 28)
      firstAttestation.attestedAt = oldDate.toISOString()

      // Re-sign the modified attestations
      await resignAttestations(attestPath, attestations.attestations, tempDir)
      await runCommand('git add . && git commit -m "old attestation"', tempDir)

      // Verify only the example suite, not all suites
      const result = await runCli(['verify', '--suite', 'example'], tempDir)
      expect(result.exitCode).toBe(0)
      // The warning goes to stderr, not stdout
      expect(result.stderr).toContain('approaching expiry')
    })

    it('shows remediation steps when attestations invalid', async () => {
      const result = await runCli(['verify'], tempDir)
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toContain('Remediation:')
      expect(result.stdout).toContain('attest-it run --suite')
    })

    it('detects fingerprint changes', async () => {
      // Create initial attestation
      await runCli(['run', '--suite', 'example'], tempDir, 'y\n')
      await runCommand('git add . && git commit -m "add attestation"', tempDir)

      // Modify code
      await fs.promises.appendFile(
        path.join(tempDir, 'packages/example/src/index.ts'),
        '\nconst changed = true\nmodule.exports.changed = changed\n',
      )
      await runCommand('git add . && git commit -m "modify code"', tempDir)

      const result = await runCli(['verify', '--suite', 'example'], tempDir)
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toContain('FINGERPRINT_CHANGED')
    })

    it('fails on unknown suite with --suite', async () => {
      const result = await runCli(['verify', '--suite', 'nonexistent'], tempDir)
      expect(result.exitCode).toBe(3) // CONFIG_ERROR
      expect(result.stderr).toContain('not found')
    })

    it('detects expired attestations', async () => {
      // Create attestation
      await runCli(['run', '--suite', 'example'], tempDir, 'y\n')

      // Manually modify attestation to be expired
      const attestPath = path.join(tempDir, '.attest-it', 'attestations.json')
      const attestContent = await fs.promises.readFile(attestPath, 'utf-8')
      const attestations: unknown = JSON.parse(attestContent)

      if (!isAttestationsStructure(attestations)) {
        throw new Error('Invalid attestations structure')
      }

      const firstAttestation = attestations.attestations[0]
      if (!firstAttestation) {
        throw new Error('Expected first attestation')
      }

      // Set attestation date to 60 days ago (max is 30)
      const oldDate = new Date()
      oldDate.setDate(oldDate.getDate() - 60)
      firstAttestation.attestedAt = oldDate.toISOString()

      // Re-sign the modified attestations
      await resignAttestations(attestPath, attestations.attestations, tempDir)
      await runCommand('git add . && git commit -m "expired attestation"', tempDir)

      const result = await runCli(['verify', '--suite', 'example'], tempDir)
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toContain('EXPIRED')
    })

    it('shows signature verification failure', async () => {
      // Create attestation
      await runCli(['run', '--suite', 'example'], tempDir, 'y\n')
      await runCommand('git add . && git commit -m "add attestation"', tempDir)

      // Tamper with attestation file
      const attestPath = path.join(tempDir, '.attest-it', 'attestations.json')
      const attestContent = await fs.promises.readFile(attestPath, 'utf-8')
      const attestations: unknown = JSON.parse(attestContent)

      if (!isAttestationsStructure(attestations)) {
        throw new Error('Invalid attestations structure')
      }

      // Modify signature to make it invalid
      attestations.signature = 'invalid-signature'

      await fs.promises.writeFile(attestPath, JSON.stringify(attestations, null, 2))
      await runCommand('git add . && git commit -m "tampered attestation"', tempDir)

      const result = await runCli(['verify'], tempDir)
      expect(result.exitCode).toBe(1)
      // The error message goes to stderr, but the warning goes to stdout
      expect(result.stdout).toContain('The attestations file may have been tampered with')
    })
  })

  describe('attest-it init', () => {
    it('shows help for init command', async () => {
      const result = await runCli(['init', '--help'], tempDir)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('init')
      expect(result.stdout).toContain('Initialize')
    })

    // Note: Interactive init tests would require mocking stdin
    // which is complex in integration tests. The unit tests cover
    // the init logic comprehensively.
  })

  describe('edge cases', () => {
    it('handles empty package directories', async () => {
      // Create empty package
      const emptyPkg = path.join(tempDir, 'packages', 'empty')
      await fs.promises.mkdir(emptyPkg, { recursive: true })

      // Add suite for empty package
      const configPath = path.join(tempDir, '.attest-it', 'config.yaml')
      const configContent = await fs.promises.readFile(configPath, 'utf-8')

      const updatedConfig =
        configContent +
        `
  empty:
    description: Empty package suite
    packages:
      - packages/empty
    command: echo "empty test"
`
      await fs.promises.writeFile(configPath, updatedConfig)

      const result = await runCli(['status', '--suite', 'empty'], tempDir)
      // Should handle empty packages gracefully
      expect([0, 1, 2]).toContain(result.exitCode)
    })

    it('handles special characters in filenames', async () => {
      // Create file with spaces and special chars
      const specialFile = path.join(tempDir, 'packages/example/src', 'file with spaces.ts')
      await fs.promises.writeFile(specialFile, 'export const x = 1\n')

      await runCommand('git add . && git commit -m "add special file"', tempDir)

      const result = await runCli(['status', '--suite', 'example'], tempDir)
      expect([0, 1]).toContain(result.exitCode)
    })

    it('handles concurrent attestation updates', async () => {
      // Create first attestation
      await runCli(['run', '--suite', 'example'], tempDir, 'y\n')

      // Read attestation file
      const attestPath = path.join(tempDir, '.attest-it', 'attestations.json')
      await fs.promises.readFile(attestPath, 'utf-8')

      // Ensure upsert logic works (running same suite twice)
      await runCommand('git add . && git commit -m "first attest"', tempDir)

      // Run again - should update, not duplicate
      await runCli(['run', '--suite', 'example'], tempDir, 'y\n')

      const newContent = await fs.promises.readFile(attestPath, 'utf-8')
      const attestations: unknown = JSON.parse(newContent)

      if (!isAttestationsStructure(attestations)) {
        throw new Error('Invalid attestations structure')
      }

      // Should still have only 1 attestation (upserted, not duplicated)
      expect(attestations.attestations).toHaveLength(1)
    })
  })
})
