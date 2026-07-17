/**
 * End-to-end non-interactive setup test (issue #80).
 *
 * Drives the real, built CLI as subprocesses with stdin fully closed
 * (mirroring `< /dev/null`), through `identity create` -> `init` -> `run`
 * (seal) -> `verify`, and asserts the whole flow completes with zero TTY
 * prompts. This mirrors PRD R3's "sample embedder script" acceptance
 * criterion: a scripted caller must be able to go from nothing to a verified
 * seal without ever answering a terminal prompt.
 *
 * Every subprocess call in this file uses `stdio: ['ignore', 'pipe', 'pipe']`
 * (stdin closed, equivalent to `/dev/null`) and a hard timeout: if any
 * command were to fall back to an interactive prompt, it would hang until
 * killed and the test would fail loudly rather than pass silently.
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
 * Run the built CLI as a real subprocess with stdin closed and a hard
 * timeout. If the CLI ever falls back to an interactive prompt despite
 * having no TTY, the child never exits on its own; the timeout kills it and
 * fails the test with a clear message instead of hanging the whole suite.
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
      // stdin: 'ignore' is Node's equivalent of `< /dev/null` -- there is
      // nothing to read, ever. This is the exact scenario issue #80 requires
      // every setup command to survive without hanging.
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
          `CLI call did not exit within ${String(CLI_CALL_TIMEOUT_MS)}ms -- this indicates it ` +
            `hung on an interactive prompt with no TTY available: node attest-it ${args.join(' ')}\n` +
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

/**
 * Result of {@link runCliWithPipedYes}: `killed` distinguishes "exited on its
 * own" from "the test's safety-net timeout had to SIGKILL it" -- the whole
 * point of the regression this guards against (issue #94) is that the
 * process must exit on its own well before any external timeout.
 */
interface PipedYesResult extends RunResult {
  killed: boolean
}

/**
 * Run the built CLI with its stdin fed by a real, continuously-producing
 * `yes` process -- the exact scenario issue #94 reports: piping infinite
 * input into a command with no non-interactive flag caused `@inquirer/core`'s
 * readline-based prompt to enter an unbounded (~20MB) terminal-escape-code
 * render loop that never exited on its own. A hard timeout kills both
 * processes as a safety net if the regression reappears, but the assertions
 * that matter are that the CLI exits on its own (`killed: false`) with a
 * small, bounded amount of output.
 */
function runCliWithPipedYes(
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = {},
): Promise<PipedYesResult> {
  return new Promise((resolve, reject) => {
    const yesProc = spawn('yes', [], { stdio: ['ignore', 'pipe', 'ignore'] })
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      cwd,
      env: { ...process.env, NO_COLOR: '1', ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    // The whole point of this regression guard is that the CLI exits (and
    // closes its stdin) almost immediately, well before `yes` stops
    // producing output -- `yes` writing into that now-closed pipe raises
    // EPIPE, which must be swallowed rather than left to crash the test
    // process as an unhandled exception.
    child.stdin.on('error', () => undefined)
    yesProc.stdout.on('error', () => undefined)
    yesProc.stdout.pipe(child.stdin)

    let stdout = ''
    let stderr = ''
    let killed = false
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    const timer = setTimeout(() => {
      killed = true
      child.kill('SIGKILL')
      yesProc.kill('SIGKILL')
    }, CLI_CALL_TIMEOUT_MS)

    child.on('close', (code) => {
      clearTimeout(timer)
      yesProc.kill('SIGKILL')
      resolve({ exitCode: code ?? 1, stdout, stderr, killed })
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      yesProc.kill('SIGKILL')
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

// `Array.isArray` narrows `unknown` to `any[]` (a long-standing TS quirk), so
// a dedicated guard is used here to keep the destructured element `unknown`.
function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value)
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

describe('non-interactive setup end-to-end (issue #80)', () => {
  let projectDir: string
  let homeDir: string

  beforeEach(async () => {
    projectDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'attest-it-e2e-project-'))
    homeDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'attest-it-e2e-home-'))

    // A trivial source file so fingerprinting has something to hash.
    await fs.promises.mkdir(path.join(projectDir, 'src'), { recursive: true })
    await fs.promises.writeFile(path.join(projectDir, 'src', 'index.ts'), 'export const x = 1\n')

    await runGit(['init'], projectDir)
    await runGit(['config', 'user.email', 'test@example.com'], projectDir)
    await runGit(['config', 'user.name', 'Test User'], projectDir)
    await runGit(['add', '.'], projectDir)
    await runGit(['commit', '-m', 'initial commit'], projectDir)
  })

  afterEach(async () => {
    await fs.promises.rm(projectDir, { recursive: true, force: true })
    await fs.promises.rm(homeDir, { recursive: true, force: true })
  })

  it(
    'runs identity create -> init -> run (seal) -> verify with zero TTY prompts and stdin closed throughout',
    async () => {
      const env = { ATTEST_IT_HOME: homeDir }

      // 1. identity create: the very first onboarding step. This is the
      // exact hang this issue reports -- it must complete with no prompt.
      const createResult = await runCliNonInteractive(
        ['identity', 'create', '--name', 'Test User', '--slug', 'test-user', '--storage', 'file'],
        projectDir,
        env,
      )
      expect(createResult.exitCode).toBe(0)
      expect(createResult.stdout).toContain('Identity created successfully')

      const publicKey = await readCreatedPublicKey(homeDir, 'test-user')

      // 2. init: scaffolds the split config non-interactively (fresh
      // directory, so no overwrite confirmation is needed).
      const initResult = await runCliNonInteractive(['init'], projectDir, env)
      expect(initResult.exitCode).toBe(0)
      expect(fs.existsSync(path.join(projectDir, '.attest-it', 'policy.yaml'))).toBe(true)
      expect(fs.existsSync(path.join(projectDir, '.attest-it', 'config.yaml'))).toBe(true)

      // Wire up a gate/suite authorizing the identity just created -- the
      // manual editing step init's own "Next steps" output points to.
      const policyPath = path.join(projectDir, '.attest-it', 'policy.yaml')
      const policy = {
        version: 1,
        settings: { maxAgeDays: 30 },
        team: {
          'test-user': { name: 'Test User', publicKey, publicKeyAlgorithm: 'ed25519' },
        },
        gates: {
          'example-gate': {
            name: 'Example Gate',
            description: 'Example gate for the non-interactive e2e test',
            authorizedSigners: ['test-user'],
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
          example: {
            description: 'Example suite',
            gate: 'example-gate',
            command: 'echo "example tests passed"',
          },
        },
      }
      await fs.promises.writeFile(configPath, stringifyYaml(operationalConfig), 'utf8')

      await runGit(['add', '.'], projectDir)
      await runGit(['commit', '-m', 'configure gate and suite'], projectDir)

      // 3. run --suite ... --yes: executes the suite and creates a seal
      // without prompting for confirmation.
      const runResult = await runCliNonInteractive(
        ['run', '--suite', 'example', '--yes'],
        projectDir,
        env,
      )
      expect(runResult.exitCode).toBe(0)
      expect(runResult.stdout).toContain('Tests passed')
      expect(runResult.stdout).toContain("Seal created for gate 'example-gate'")
      expect(fs.existsSync(path.join(projectDir, '.attest-it', 'seals.json'))).toBe(true)

      // 4. verify: the freshly created seal must validate.
      const verifyResult = await runCliNonInteractive(
        ['verify', 'example-gate', '--json'],
        projectDir,
        env,
      )
      expect(verifyResult.exitCode).toBe(0)
      const verifyJson: unknown = JSON.parse(verifyResult.stdout)
      if (!isUnknownArray(verifyJson)) {
        throw new Error('Expected verify --json to output an array')
      }
      const [gateStatus] = verifyJson
      expect(isRecordOfUnknown(gateStatus) && gateStatus.state).toBe('VALID')
    },
    CLI_CALL_TIMEOUT_MS * 5,
  )

  it(
    'fails fast (never hangs) when identity create is missing required flags with no TTY',
    async () => {
      const env = { ATTEST_IT_HOME: homeDir }

      const result = await runCliNonInteractive(['identity', 'create'], projectDir, env)

      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toMatch(/--name/)
    },
    CLI_CALL_TIMEOUT_MS,
  )

  it(
    'fails fast (never hangs) when init would overwrite existing config without --force, with no TTY',
    async () => {
      const env = { ATTEST_IT_HOME: homeDir }

      const first = await runCliNonInteractive(['init'], projectDir, env)
      expect(first.exitCode).toBe(0)

      const second = await runCliNonInteractive(['init'], projectDir, env)
      expect(second.exitCode).not.toBe(0)
      expect(second.stderr).toMatch(/--force/)
    },
    CLI_CALL_TIMEOUT_MS * 2,
  )

  it(
    'fails fast (never hangs) when run has pending suites but neither --suite nor --all is given, with no TTY',
    async () => {
      const env = { ATTEST_IT_HOME: homeDir }

      const initResult = await runCliNonInteractive(['init'], projectDir, env)
      expect(initResult.exitCode).toBe(0)

      const policyPath = path.join(projectDir, '.attest-it', 'policy.yaml')
      await fs.promises.writeFile(
        policyPath,
        stringifyYaml({
          version: 1,
          settings: { maxAgeDays: 30 },
          team: {
            nobody: {
              name: 'Nobody',
              publicKey: 'oB5OUxsnFR7GdTPURp9loSGinbcb6EKDTrFGKl2VTPk=',
              publicKeyAlgorithm: 'ed25519',
            },
          },
          gates: {
            'example-gate': {
              name: 'Example Gate',
              description: 'Example gate',
              authorizedSigners: ['nobody'],
              fingerprint: { paths: ['src'] },
              maxAge: '30d',
            },
          },
        }),
        'utf8',
      )
      const configPath = path.join(projectDir, '.attest-it', 'config.yaml')
      await fs.promises.writeFile(
        configPath,
        stringifyYaml({
          version: 1,
          settings: {},
          suites: {
            example: { description: 'Example', gate: 'example-gate', command: 'echo ok' },
          },
        }),
        'utf8',
      )

      const result = await runCliNonInteractive(['run'], projectDir, env)

      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toMatch(/--suite|--all/)
    },
    CLI_CALL_TIMEOUT_MS * 2,
  )

  describe('identity remove headless operation (issue #94)', () => {
    it(
      'removes an identity non-interactively with --yes and closed stdin',
      async () => {
        const env = { ATTEST_IT_HOME: homeDir }
        await runCliNonInteractive(
          ['identity', 'create', '--name', 'A', '--slug', 'a', '--storage', 'file'],
          projectDir,
          env,
        )
        await runCliNonInteractive(
          ['identity', 'create', '--name', 'B', '--slug', 'b', '--storage', 'file'],
          projectDir,
          env,
        )

        const result = await runCliNonInteractive(
          ['identity', 'remove', 'b', '--yes'],
          projectDir,
          env,
        )

        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('removed')
      },
      CLI_CALL_TIMEOUT_MS * 3,
    )

    it(
      'fails fast (never hangs) when identity remove is given no --yes with no TTY',
      async () => {
        const env = { ATTEST_IT_HOME: homeDir }
        await runCliNonInteractive(
          ['identity', 'create', '--name', 'A', '--slug', 'a', '--storage', 'file'],
          projectDir,
          env,
        )
        await runCliNonInteractive(
          ['identity', 'create', '--name', 'B', '--slug', 'b', '--storage', 'file'],
          projectDir,
          env,
        )

        const result = await runCliNonInteractive(['identity', 'remove', 'b'], projectDir, env)

        expect(result.exitCode).not.toBe(0)
        expect(result.stderr).toMatch(/--yes/)
      },
      CLI_CALL_TIMEOUT_MS * 3,
    )

    it(
      'never enters the runaway prompt-render loop when stdin is piped from `yes`, ' +
        'and produces bounded output',
      async () => {
        const env = { ATTEST_IT_HOME: homeDir }
        await runCliNonInteractive(
          ['identity', 'create', '--name', 'A', '--slug', 'a', '--storage', 'file'],
          projectDir,
          env,
        )
        await runCliNonInteractive(
          ['identity', 'create', '--name', 'B', '--slug', 'b', '--storage', 'file'],
          projectDir,
          env,
        )

        const result = await runCliWithPipedYes(['identity', 'remove', 'b'], projectDir, env)

        // Regression guard: prior to the fix, a piped `yes` with no --yes flag
        // caused an unbounded (~20MB) terminal-escape-code render loop that
        // never exited on its own -- this asserts the process exits by itself
        // (never needed the safety-net SIGKILL) with a small, bounded amount
        // of combined output.
        expect(result.killed).toBe(false)
        expect(result.exitCode).not.toBe(0)
        expect(result.stdout.length + result.stderr.length).toBeLessThan(10_000)
      },
      CLI_CALL_TIMEOUT_MS,
    )
  })
})
