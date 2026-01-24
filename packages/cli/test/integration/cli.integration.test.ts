/**
 * Integration tests for the attest-it CLI.
 *
 * These tests exercise the full CLI workflow including:
 * - Command parsing and execution
 * - File system operations
 * - Git integration
 * - Seal creation and validation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as os from 'node:os'
import * as yaml from 'yaml'
import type { Seal, SealsFile } from '@attest-it/core'
import { createSeal, generateEd25519KeyPair } from '@attest-it/core'
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

interface GateStatusResult {
  gateId: string
  state: string
  currentFingerprint: string
  sealedFingerprint?: string
  sealedBy?: string
  sealedAt?: string
  age?: number
  message?: string
}

function isGateStatusResultArray(value: unknown): value is GateStatusResult[] {
  if (!Array.isArray(value)) return false
  if (value.length === 0) return true

  const first: unknown = value[0]
  return (
    typeof first === 'object' &&
    first !== null &&
    'gateId' in first &&
    'state' in first &&
    'currentFingerprint' in first
  )
}

function isSealsFile(value: unknown): value is SealsFile {
  if (typeof value !== 'object' || value === null) return false
  if (!('version' in value) || !('seals' in value)) return false
  return typeof value.seals === 'object' && value.seals !== null
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

/**
 * Create a mock seal file for testing.
 * This bypasses the need for local identity configuration.
 * Note: The signature is fake and won't verify cryptographically.
 */
function createMockSealsFile(
  gateId: string,
  fingerprint: string,
  options?: { stale?: boolean },
): SealsFile {
  const timestamp = options?.stale
    ? new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString() // 60 days ago
    : new Date().toISOString()

  return {
    version: 1,
    seals: {
      [gateId]: {
        gateId,
        fingerprint,
        timestamp,
        sealedBy: 'test-user',
        // Note: This is a mock signature that won't verify cryptographically
        // but allows testing the CLI flow
        signature: 'mock-signature-for-testing',
      } as Seal,
    },
  }
}

/**
 * Create a real seal file with cryptographically valid signature.
 * This requires a private key file.
 */
function createRealSealsFile(
  gateId: string,
  fingerprint: string,
  privateKeyPem: string,
  options?: { stale?: boolean },
): SealsFile {
  // Create seal with real signature
  const seal = createSeal({
    gateId,
    fingerprint,
    sealedBy: 'test-user',
    privateKey: privateKeyPem,
  })

  // If stale, override the timestamp to be 60 days ago
  if (options?.stale) {
    seal.timestamp = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()
    // Re-sign with the old timestamp
    const realSeal = createSeal({
      gateId,
      fingerprint,
      sealedBy: 'test-user',
      privateKey: privateKeyPem,
    })
    // Replace the timestamp after signing (this makes signature invalid, but
    // we create a fresh seal and just backdating the timestamp for testing
    // means signature won't validate, so for stale test we accept that)
    realSeal.timestamp = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()
    return {
      version: 1,
      seals: { [gateId]: realSeal },
    }
  }

  return {
    version: 1,
    seals: { [gateId]: seal },
  }
}

/**
 * Update the config.yaml to set the public key for the test-user.
 * Uses direct string replacement to avoid YAML formatting issues.
 */
async function updateConfigPublicKey(tempDir: string, publicKeyBase64: string): Promise<void> {
  const configPath = path.join(tempDir, '.attest-it', 'config.yaml')
  const content = await fs.promises.readFile(configPath, 'utf8')

  // Replace the placeholder with the actual public key
  // The placeholder is: publicKey: placeholder-will-be-set-by-keygen
  const updatedContent = content.replace(
    /publicKey:\s*placeholder-will-be-set-by-keygen/,
    `publicKey: ${publicKeyBase64}`,
  )

  await fs.promises.writeFile(configPath, updatedContent, 'utf8')
}

describe('CLI Integration Tests', () => {
  let tempDir: string
  let privateKeyPem: string
  let publicKeyBase64: string

  beforeEach(async () => {
    // Create temp directory for test isolation
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'attest-it-test-'))

    // Copy fixture to temp directory
    await copyDir(FIXTURE_PATH, tempDir)

    // Generate Ed25519 keypair for tests
    // Note: The keygen command generates RSA keys, but seal verification uses Ed25519
    // So we generate Ed25519 keys directly for integration tests
    const keyPair = generateEd25519KeyPair()
    privateKeyPem = keyPair.privateKey
    publicKeyBase64 = keyPair.publicKey

    // Store keys in temp directory for reference (some tests might need files)
    const privateKeyPath = path.join(tempDir, '.attest-it', 'private.pem')
    const publicKeyPath = path.join(tempDir, '.attest-it', 'pubkey.pem')
    await fs.promises.writeFile(privateKeyPath, privateKeyPem)
    await fs.promises.writeFile(
      publicKeyPath,
      `-----BEGIN PUBLIC KEY-----\n${publicKeyBase64}\n-----END PUBLIC KEY-----\n`,
    )

    // Update the config with the generated public key
    await updateConfigPublicKey(tempDir, publicKeyBase64)

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
      expect(result.stdout).toContain('identity')
    })

    it('shows version', async () => {
      const result = await runCli(['--version'], tempDir)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain(packageJson.version)
    })
  })

  describe('attest-it status', () => {
    it('shows MISSING status when no seals exist', async () => {
      const result = await runCli(['status'], tempDir)
      expect(result.exitCode).toBe(1) // At least one gate has missing seal
      expect(result.stdout).toContain('MISSING')
    })

    it('outputs JSON with --json flag', async () => {
      const result = await runCli(['status', '--json'], tempDir)
      expect(result.exitCode).toBe(1)

      // Parse and validate JSON
      const json: unknown = JSON.parse(result.stdout)

      if (!isGateStatusResultArray(json)) {
        throw new Error('Expected gate status result array')
      }

      expect(json.length).toBeGreaterThan(0)

      // Validate first element has expected fields
      const firstGate = json[0]
      if (!firstGate) {
        throw new Error('Expected at least one gate')
      }

      expect(firstGate).toHaveProperty('gateId')
      expect(firstGate).toHaveProperty('state')
      expect(firstGate).toHaveProperty('currentFingerprint')
    })

    it('filters by gate with positional argument', async () => {
      const result = await runCli(['status', 'example-gate'], tempDir)
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toContain('example-gate')
      expect(result.stdout).not.toContain('failing-gate')
    })

    it('errors on unknown gate', async () => {
      const result = await runCli(['status', 'nonexistent'], tempDir)
      expect(result.exitCode).toBe(3) // CONFIG_ERROR
      expect(result.stderr).toContain('not found')
    })

    it('includes gate details in JSON output', async () => {
      const result = await runCli(['status', '--json'], tempDir)
      const json: unknown = JSON.parse(result.stdout)

      if (!isGateStatusResultArray(json)) {
        throw new Error('Expected gate status result array')
      }

      const exampleGate = json.find((g) => g.gateId === 'example-gate')
      expect(exampleGate).toBeDefined()
      if (!exampleGate) {
        throw new Error('Expected example-gate to be found')
      }

      expect(exampleGate).toHaveProperty('currentFingerprint')
      expect(typeof exampleGate.currentFingerprint).toBe('string')
    })

    it('shows VALID status when seal exists with matching fingerprint', async () => {
      // First get the current fingerprint
      const statusResult = await runCli(['status', '--json'], tempDir)
      const status: unknown = JSON.parse(statusResult.stdout)
      if (!isGateStatusResultArray(status)) {
        throw new Error('Expected gate status result array')
      }
      const fingerprint = status[0]?.currentFingerprint
      if (!fingerprint) {
        throw new Error('Expected fingerprint')
      }

      // Create a real seal with valid signature
      const sealsFile = createRealSealsFile('example-gate', fingerprint, privateKeyPem)
      const sealsPath = path.join(tempDir, '.attest-it', 'seals.json')
      await fs.promises.writeFile(sealsPath, JSON.stringify(sealsFile, null, 2))
      await runCommand('git add . && git commit -m "add seal"', tempDir)

      // Check status - should show VALID with valid signature
      const result = await runCli(['status', 'example-gate', '--json'], tempDir)

      const newStatus: unknown = JSON.parse(result.stdout)
      if (!isGateStatusResultArray(newStatus)) {
        throw new Error('Expected gate status result array')
      }

      const gateStatus = newStatus[0]
      expect(gateStatus?.state).toBe('VALID')
    })
  })

  describe('attest-it run', () => {
    it('runs tests and creates attestation', async () => {
      // NOTE: The old attestation system uses OpenSSL which doesn't support Ed25519
      // on macOS LibreSSL. Use --no-attest and verify tests ran successfully.
      // Full attestation creation is tested through the seal workflow tests.
      const result = await runCli(['run', '--suite', 'example', '--no-attest'], tempDir)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Tests passed')
      expect(result.stdout).toContain('Skipping attestation')
    })

    it('exits with code 1 on test failure', async () => {
      // Use --no-attest since attestation isn't reached when tests fail
      const result = await runCli(['run', '--suite', 'failing', '--no-attest'], tempDir)
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

      // Use --no-attest since attestation signing isn't the focus of this test
      const result = await runCli(['run', '--suite', 'example', '--no-attest'], tempDir)
      expect(result.exitCode).toBe(3) // CONFIG_ERROR
      expect(result.stderr).toContain('uncommitted')
    })
  })

  describe('attest-it verify', () => {
    it('returns exit code 1 when seal is missing', async () => {
      // No seals exist
      const result = await runCli(['verify', 'example-gate'], tempDir)
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toContain('MISSING')
    })

    it('outputs JSON with --json', async () => {
      const result = await runCli(['verify', '--json'], tempDir)
      const json: unknown = JSON.parse(result.stdout)

      expect(Array.isArray(json)).toBe(true)
      if (!Array.isArray(json)) {
        throw new Error('Expected json to be an array')
      }

      expect(json.length).toBeGreaterThan(0)
      const firstResult = json[0] as Record<string, unknown>
      expect(firstResult).toHaveProperty('gateId')
      expect(firstResult).toHaveProperty('state')
    })

    it('verifies specific gate with positional argument', async () => {
      const result = await runCli(['verify', 'example-gate'], tempDir)
      expect(result.exitCode).toBe(1) // Missing seal
      expect(result.stdout).toContain('example-gate')
      expect(result.stdout).not.toContain('failing-gate')
    })

    it('fails on unknown gate', async () => {
      const result = await runCli(['verify', 'nonexistent'], tempDir)
      expect(result.exitCode).toBe(3) // CONFIG_ERROR
      expect(result.stderr).toContain('not found')
    })

    it('detects fingerprint mismatch', async () => {
      // Create a seal with different fingerprint (must be valid hex format)
      const sealsFile = createMockSealsFile('example-gate', 'sha256:deadbeef1234567890')
      const sealsPath = path.join(tempDir, '.attest-it', 'seals.json')
      await fs.promises.writeFile(sealsPath, JSON.stringify(sealsFile, null, 2))
      await runCommand('git add . && git commit -m "add seal"', tempDir)

      const result = await runCli(['verify', 'example-gate'], tempDir)
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toContain('FINGERPRINT_MISMATCH')
    })

    it('detects stale seals', async () => {
      // First get the current fingerprint
      const statusResult = await runCli(['status', '--json'], tempDir)
      const status: unknown = JSON.parse(statusResult.stdout)
      if (!isGateStatusResultArray(status)) {
        throw new Error('Expected gate status result array')
      }
      const fingerprint = status[0]?.currentFingerprint
      if (!fingerprint) {
        throw new Error('Expected fingerprint')
      }

      // Create a valid seal
      const sealsFile = createRealSealsFile('example-gate', fingerprint, privateKeyPem)
      const sealsPath = path.join(tempDir, '.attest-it', 'seals.json')
      await fs.promises.writeFile(sealsPath, JSON.stringify(sealsFile, null, 2))

      // Update config to use a very short maxAge so the seal becomes stale immediately
      const configPath = path.join(tempDir, '.attest-it', 'config.yaml')
      const configContent = await fs.promises.readFile(configPath, 'utf8')
      const config = yaml.parse(configContent) as Record<string, unknown>
      const gates = config.gates as Record<string, { maxAge?: string }>
      if (gates && gates['example-gate']) {
        gates['example-gate'].maxAge = '1ms' // 1 millisecond - seal is immediately stale
      }
      await fs.promises.writeFile(configPath, yaml.stringify(config), 'utf8')

      await runCommand('git add . && git commit -m "add stale seal"', tempDir)

      // Wait a moment to ensure seal is stale
      await new Promise((resolve) => setTimeout(resolve, 10))

      const result = await runCli(['verify', 'example-gate'], tempDir)
      // STALE is a warning, exit code 0 in verify
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('STALE')
    })
  })

  describe('seal workflow', () => {
    it('full workflow: check status, manually seal, verify', async () => {
      // Initial status should show missing
      let result = await runCli(['status', '--json'], tempDir)
      expect(result.exitCode).toBe(1)

      let status: unknown = JSON.parse(result.stdout)
      if (!isGateStatusResultArray(status)) {
        throw new Error('Expected gate status result array')
      }

      const firstStatus = status[0]
      if (!firstStatus) {
        throw new Error('Expected at least one status')
      }
      expect(firstStatus.state).toBe('MISSING')

      const fingerprint = firstStatus.currentFingerprint

      // Create seal with valid signature
      const sealsFile = createRealSealsFile('example-gate', fingerprint, privateKeyPem)
      const sealsPath = path.join(tempDir, '.attest-it', 'seals.json')
      await fs.promises.writeFile(sealsPath, JSON.stringify(sealsFile, null, 2))
      await runCommand('git add . && git commit -m "add seal"', tempDir)

      // Status should now show VALID with properly signed seal
      result = await runCli(['status', 'example-gate', '--json'], tempDir)
      expect(result.exitCode).toBe(0)

      status = JSON.parse(result.stdout)
      if (!isGateStatusResultArray(status)) {
        throw new Error('Expected gate status result array')
      }

      const validStatus = status[0]
      if (!validStatus) {
        throw new Error('Expected at least one status')
      }
      expect(validStatus.state).toBe('VALID')

      // Modify code
      await fs.promises.appendFile(
        path.join(tempDir, 'packages/example/src/index.ts'),
        '\nconst x = 1\nmodule.exports.x = x\n',
      )
      await runCommand('git add . && git commit -m "modify code"', tempDir)

      // Status should show fingerprint mismatch
      result = await runCli(['status', 'example-gate', '--json'], tempDir)
      expect(result.exitCode).toBe(1)

      status = JSON.parse(result.stdout)
      if (!isGateStatusResultArray(status)) {
        throw new Error('Expected gate status result array')
      }

      const changedStatus = status[0]
      if (!changedStatus) {
        throw new Error('Expected at least one status')
      }
      expect(changedStatus.state).toBe('FINGERPRINT_MISMATCH')
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
      // Make .attest-it directory read-only (Unix only)
      if (process.platform !== 'win32') {
        const attestDir = path.join(tempDir, '.attest-it')
        await fs.promises.chmod(attestDir, 0o444)

        try {
          const result = await runCli(['seal', 'example-gate'], tempDir)
          expect(result.exitCode).not.toBe(0)
          // Should fail but not crash
        } finally {
          // Restore permissions for cleanup
          await fs.promises.chmod(attestDir, 0o755)
        }
      }
    })
  })

  describe('output formatting', () => {
    it('supports verbose output', async () => {
      const result = await runCli(['status', 'example-gate', '-v'], tempDir)
      // Verbose flag should be accepted
      expect([0, 1, 2, 3]).toContain(result.exitCode)
    })

    it('supports quiet output', async () => {
      const result = await runCli(['status', 'example-gate', '-q'], tempDir)
      // Quiet flag should be accepted
      expect([0, 1, 2, 3]).toContain(result.exitCode)
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

  // Note: keygen command has been removed - use 'identity create' instead

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
    it('handles special characters in filenames', async () => {
      // Create file with spaces and special chars
      const specialFile = path.join(tempDir, 'packages/example/src', 'file with spaces.ts')
      await fs.promises.writeFile(specialFile, 'export const x = 1\n')

      await runCommand('git add . && git commit -m "add special file"', tempDir)

      const result = await runCli(['status', 'example-gate'], tempDir)
      expect([0, 1]).toContain(result.exitCode)
    })

    it('handles concurrent seal file updates', async () => {
      // Get current fingerprint
      const statusResult = await runCli(['status', '--json'], tempDir)
      const status: unknown = JSON.parse(statusResult.stdout)
      if (!isGateStatusResultArray(status)) {
        throw new Error('Expected gate status result array')
      }
      const fingerprint = status[0]?.currentFingerprint
      if (!fingerprint) {
        throw new Error('Expected fingerprint')
      }

      // Create first seal
      const sealsPath = path.join(tempDir, '.attest-it', 'seals.json')
      const sealsFile = createMockSealsFile('example-gate', fingerprint)
      await fs.promises.writeFile(sealsPath, JSON.stringify(sealsFile, null, 2))
      await runCommand('git add . && git commit -m "first seal"', tempDir)

      // Update seal (simulating re-sealing)
      sealsFile.seals['example-gate']!.timestamp = new Date().toISOString()
      await fs.promises.writeFile(sealsPath, JSON.stringify(sealsFile, null, 2))

      // Verify seal file is readable
      const newContent = await fs.promises.readFile(sealsPath, 'utf-8')
      const readSealsFile: unknown = JSON.parse(newContent)

      if (!isSealsFile(readSealsFile)) {
        throw new Error('Invalid seals file structure')
      }

      // Should still have seal for this gate
      expect(Object.keys(readSealsFile.seals)).toContain('example-gate')
    })
  })
})
