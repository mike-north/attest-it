/**
 * Regression tests for issue #136: an unauthorized-signer `seal`/`run`
 * reported success (`✓ Suite completed!`, exit 0, `ok:true` in `--json`)
 * instead of failing, and printed a "To commit" hint for a seal that was
 * never created.
 *
 * These drive the real, built `attest-it` binary (not an in-process
 * approximation) through the exact repro from the issue: a gate authorizing
 * only one team member, a second identity that is NOT authorized attempting
 * to seal/run against it non-interactively (`--yes`, stdin closed).
 *
 * Verified pre-fix: both commands exited 0 with a success banner/`ok:true`
 * and wrote no seal file (confirmed separately that `verify` reports
 * `MISSING` afterwards) -- i.e. this was a reporting bug, not a trust hole.
 * These tests fail against that pre-fix behavior (exit 0) and pass once the
 * unauthorized outcome is a hard failure.
 *
 * @see https://github.com/mike-north/attest-it/issues/136
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as os from 'node:os'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CLI_PATH = path.resolve(__dirname, '../../dist/bin/attest-it.js')
const CLI_CALL_TIMEOUT_MS = 15000

interface RunResult {
  exitCode: number
  stdout: string
  stderr: string
}

/**
 * Run the built CLI as a real subprocess with stdin closed (`< /dev/null`)
 * and a hard timeout, matching the non-interactive-setup integration tests'
 * convention: if the CLI ever falls back to a prompt, the test fails loudly
 * instead of hanging.
 */
function runCliNonInteractive(
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      cwd,
      env: { ...process.env, NO_COLOR: '1', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(
        new Error(
          `CLI call did not exit within ${String(CLI_CALL_TIMEOUT_MS)}ms: node attest-it ${args.join(' ')}\n` +
            `stdout so far:\n${stdout}\nstderr so far:\n${stderr}`,
        ),
      )
    }, CLI_CALL_TIMEOUT_MS)

    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ exitCode: code ?? 1, stdout, stderr })
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

async function runGit(args: string[], cwd: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('git', args, { cwd, stdio: 'ignore' })
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`git ${args.join(' ')} exited with code ${String(code)}`))
      }
    })
    child.on('error', reject)
  })
}

function isRecordOfUnknown(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Read the public key attest-it just wrote for `slug` under a temp ATTEST_IT_HOME. */
async function readCreatedPublicKey(homeDir: string, slug: string): Promise<string> {
  const content = await fs.promises.readFile(path.join(homeDir, 'config.yaml'), 'utf8')
  const parsed: unknown = parseYaml(content)
  if (!isRecordOfUnknown(parsed) || !isRecordOfUnknown(parsed.identities)) {
    throw new Error('Expected local config to contain an identities map')
  }
  const identity = parsed.identities[slug]
  if (!isRecordOfUnknown(identity) || typeof identity.publicKey !== 'string') {
    throw new Error(`Expected identity "${slug}" to have a string publicKey`)
  }
  return identity.publicKey
}

describe('unauthorized signer seal/run reporting (issue #136)', () => {
  let projectDir: string
  let homeDir: string
  let env: NodeJS.ProcessEnv

  beforeEach(async () => {
    projectDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'attest-it-136-project-'))
    homeDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'attest-it-136-home-'))
    env = { ATTEST_IT_HOME: homeDir, VAULTKEEPER_CONFIG_DIR: homeDir }

    // A trivial source file so fingerprinting has something to hash.
    await fs.promises.mkdir(path.join(projectDir, 'src'), { recursive: true })
    await fs.promises.writeFile(path.join(projectDir, 'src', 'index.ts'), 'export const x = 1\n')

    await runGit(['init'], projectDir)
    await runGit(['config', 'user.email', 'test@example.com'], projectDir)
    await runGit(['config', 'user.name', 'Test User'], projectDir)
    await runGit(['add', '.'], projectDir)
    await runGit(['commit', '-m', 'initial commit'], projectDir)

    // Two identities: alice is the only authorized signer for gate "g"; bob
    // is a legitimate team member with no signing rights for it -- the exact
    // repro from the issue.
    const createAlice = await runCliNonInteractive(
      ['identity', 'create', '--name', 'Alice', '--slug', 'alice', '--storage', 'file'],
      projectDir,
      env,
    )
    expect(createAlice.exitCode).toBe(0)
    const createBob = await runCliNonInteractive(
      ['identity', 'create', '--name', 'Bob', '--slug', 'bob', '--storage', 'file'],
      projectDir,
      env,
    )
    expect(createBob.exitCode).toBe(0)

    const alicePublicKey = await readCreatedPublicKey(homeDir, 'alice')
    const bobPublicKey = await readCreatedPublicKey(homeDir, 'bob')

    const initResult = await runCliNonInteractive(['init'], projectDir, env)
    expect(initResult.exitCode).toBe(0)

    const policyPath = path.join(projectDir, '.attest-it', 'policy.yaml')
    const policy = {
      version: 1,
      settings: { maxAgeDays: 30 },
      team: {
        alice: { name: 'Alice', publicKey: alicePublicKey, publicKeyAlgorithm: 'ed25519' },
        bob: { name: 'Bob', publicKey: bobPublicKey, publicKeyAlgorithm: 'ed25519' },
      },
      gates: {
        g: {
          name: 'Gate G',
          description: 'Regression gate for issue 136',
          authorizedSigners: ['alice'],
          fingerprint: { paths: ['src'] },
          maxAge: '30d',
        },
      },
    }
    await fs.promises.writeFile(policyPath, stringifyYaml(policy), 'utf8')

    const configPath = path.join(projectDir, '.attest-it', 'config.yaml')
    const operationalConfig = {
      version: 1,
      settings: {},
      suites: {
        'g-suite': {
          description: 'Regression suite for issue 136',
          gate: 'g',
          command: 'echo "tests passed"',
        },
      },
    }
    await fs.promises.writeFile(configPath, stringifyYaml(operationalConfig), 'utf8')

    await runGit(['add', '.'], projectDir)
    await runGit(['commit', '-m', 'configure gate g / suite g-suite'], projectDir)
  })

  afterEach(async () => {
    await fs.promises.rm(projectDir, { recursive: true, force: true })
    await fs.promises.rm(homeDir, { recursive: true, force: true })
  })

  it(
    '`run --suite ... --yes` as an unauthorized signer fails hard: nonzero exit, ' +
      'no ✓, no "To commit" hint, and no seal file is written',
    async () => {
      const useBob = await runCliNonInteractive(['identity', 'use', 'bob'], projectDir, env)
      expect(useBob.exitCode).toBe(0)

      const runResult = await runCliNonInteractive(
        ['run', '--suite', 'g-suite', '--yes'],
        projectDir,
        env,
      )

      // Pre-fix this was exitCode 0 with "✓ Suite completed!" -- the
      // regression this test guards against.
      expect(runResult.exitCode).not.toBe(0)
      expect(runResult.stdout + runResult.stderr).not.toContain('✓ Suite completed!')
      expect(runResult.stdout + runResult.stderr).not.toContain('To commit:')
      expect(runResult.stdout + runResult.stderr).toMatch(/not authorized|unauthorized/i)

      expect(fs.existsSync(path.join(projectDir, '.attest-it', 'seals'))).toBe(false)

      // verify must independently confirm nothing was sealed -- proves the
      // unauthorized attempt never produced anything a verifier would accept.
      const verifyResult = await runCliNonInteractive(['verify', 'g', '--json'], projectDir, env)
      const verifyJson: unknown = JSON.parse(verifyResult.stdout)
      expect(Array.isArray(verifyJson)).toBe(true)
      const [gateStatus] = verifyJson as unknown[]
      expect(isRecordOfUnknown(gateStatus) && gateStatus.state).toBe('MISSING')
    },
    CLI_CALL_TIMEOUT_MS * 6,
  )

  it(
    '`seal --json` as an unauthorized signer reports ok:false with a nonzero exit ' +
      'and writes no seal file',
    async () => {
      const useBob = await runCliNonInteractive(['identity', 'use', 'bob'], projectDir, env)
      expect(useBob.exitCode).toBe(0)

      const sealResult = await runCliNonInteractive(['seal', 'g', '--json'], projectDir, env)

      // Pre-fix this was exitCode 0 with `ok: true` -- the regression this
      // test guards against.
      expect(sealResult.exitCode).not.toBe(0)
      const json: unknown = JSON.parse(sealResult.stdout)
      if (!isRecordOfUnknown(json)) {
        throw new Error('Expected seal --json output to be an object')
      }
      expect(json.ok).toBe(false)
      expect(Array.isArray(json.sealed) && json.sealed).toHaveLength(0)

      expect(fs.existsSync(path.join(projectDir, '.attest-it', 'seals'))).toBe(false)
    },
    CLI_CALL_TIMEOUT_MS * 3,
  )

  it(
    '`run --suite ... --yes` as the authorized signer still succeeds and writes a seal',
    async () => {
      // alice is already the active identity from `identity create` above.
      const runResult = await runCliNonInteractive(
        ['run', '--suite', 'g-suite', '--yes'],
        projectDir,
        env,
      )

      expect(runResult.exitCode).toBe(0)
      expect(runResult.stdout).toContain('Suite completed!')
      expect(runResult.stdout).toContain("Seal created for gate 'g'")
      expect(fs.existsSync(path.join(projectDir, '.attest-it', 'seals'))).toBe(true)

      const verifyResult = await runCliNonInteractive(['verify', 'g', '--json'], projectDir, env)
      expect(verifyResult.exitCode).toBe(0)
      const verifyJson: unknown = JSON.parse(verifyResult.stdout)
      const [gateStatus] = verifyJson as unknown[]
      expect(isRecordOfUnknown(gateStatus) && gateStatus.state).toBe('VALID')
    },
    CLI_CALL_TIMEOUT_MS * 6,
  )

  it(
    '`seal --json` as the authorized signer still succeeds and writes a seal',
    async () => {
      const sealResult = await runCliNonInteractive(['seal', 'g', '--json'], projectDir, env)

      expect(sealResult.exitCode).toBe(0)
      const json: unknown = JSON.parse(sealResult.stdout)
      if (!isRecordOfUnknown(json)) {
        throw new Error('Expected seal --json output to be an object')
      }
      expect(json.ok).toBe(true)
      expect(Array.isArray(json.sealed) && json.sealed).toHaveLength(1)
      expect(fs.existsSync(path.join(projectDir, '.attest-it', 'seals'))).toBe(true)
    },
    CLI_CALL_TIMEOUT_MS * 3,
  )
})
