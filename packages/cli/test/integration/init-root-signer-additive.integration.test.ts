/**
 * End-to-end UAT for the non-destructive `init --root-signer` path and the
 * `init --force` data-loss guard (issue #127).
 *
 * Drives the real, built CLI as subprocesses with stdin fully closed
 * (mirroring `< /dev/null`), reproducing the exact DX wave-1 sequence that
 * caused silent data loss:
 *
 *   identity create -> init -> team join -> hand-add a gate + suite ->
 *   run --suite --yes (seal) -> init --root-signer <slug>
 *
 * Before the fix, the final step required `--force` and then re-scaffolded
 * `policy.yaml`/`config.yaml` from empty templates — wiping `gates:`/`suites:`
 * and orphaning the seal — while printing "Trust anchor established" and
 * exiting 0. This suite asserts the corrected behavior: the root-signer step
 * succeeds WITHOUT `--force` and leaves gates, suites, and the seal intact, and
 * a full `--force` re-scaffold refuses to silently discard a populated config.
 *
 * @see Issue #127 acceptance criteria
 * @see docs/getting-started.md (the walkthrough this sequence mirrors)
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
 * Run the built CLI as a real subprocess with stdin closed and a hard timeout.
 * A hang here would mean an undocumented prompt slipped through despite there
 * being no TTY — exactly the failure mode this issue also guards against.
 */
function runCliNonInteractive(
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [CLI_PATH, ...args], {
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
          `CLI call did not exit within ${String(CLI_CALL_TIMEOUT_MS)}ms — likely an ` +
            `undocumented prompt with no TTY available: node attest-it ${args.join(' ')}\n` +
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

/** Parse `<project>/.attest-it/<file>` and return it as a record. */
function readAttestConfig(projectDir: string, file: string): Record<string, unknown> {
  const parsed: unknown = parseYaml(
    fs.readFileSync(path.join(projectDir, '.attest-it', file), 'utf8'),
  )
  if (!isRecordOfUnknown(parsed)) {
    throw new Error(`Expected ${file} to parse to an object`)
  }
  return parsed
}

/**
 * Drive the shared setup: a real git repo, a `file`-backed identity, `init`, a
 * hand-added gate + suite, `team join`, a commit, and a real seal via
 * `run --suite`. Returns the project dir left in the trust-anchored-but-for-the
 * -root-gate state that the reported repro reaches just before the destructive
 * `init --root-signer` call.
 */
async function scaffoldSealedProject(projectDir: string, env: NodeJS.ProcessEnv): Promise<void> {
  await fs.promises.writeFile(
    path.join(projectDir, 'package.json'),
    JSON.stringify({ dependencies: {} }, null, 2),
  )
  await fs.promises.mkdir(path.join(projectDir, 'src'), { recursive: true })
  await fs.promises.writeFile(path.join(projectDir, 'src', 'index.ts'), 'export const x = 1\n')
  await runGit(['init'], projectDir)
  await runGit(['config', 'user.email', 'test@example.com'], projectDir)
  await runGit(['config', 'user.name', 'Test User'], projectDir)

  const createResult = await runCliNonInteractive(
    ['identity', 'create', '--name', 'Test User', '--slug', 'test-user', '--storage', 'file'],
    projectDir,
    env,
  )
  expect(createResult.exitCode).toBe(0)

  const initResult = await runCliNonInteractive(['init'], projectDir, env)
  expect(initResult.exitCode).toBe(0)

  // Hand-add a gate (policy.yaml) and a suite (config.yaml) — the documented
  // manual-edit step of the getting-started walkthrough.
  const policyPath = path.join(projectDir, '.attest-it', 'policy.yaml')
  await fs.promises.writeFile(
    policyPath,
    stringifyYaml({
      version: 1,
      settings: { maxAgeDays: 30 },
      team: {},
      gates: {
        smoke: {
          name: 'Smoke Test',
          description: 'A trivial gate for the getting-started flow',
          authorizedSigners: ['test-user'],
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
      suites: { smoke: { gate: 'smoke', command: 'true' } },
    }),
    'utf8',
  )

  const joinResult = await runCliNonInteractive(
    ['team', 'join', '--gates', 'smoke'],
    projectDir,
    env,
  )
  expect(joinResult.exitCode).toBe(0)

  await runGit(['add', '.'], projectDir)
  await runGit(['commit', '-m', 'configure gate, suite, and team'], projectDir)

  const runResult = await runCliNonInteractive(
    ['run', '--suite', 'smoke', '--yes'],
    projectDir,
    env,
  )
  expect(runResult.exitCode).toBe(0)
  expect(runResult.stdout).toContain("Seal created for gate 'smoke'")
}

describe('init --root-signer is additive; init --force refuses silent data loss (issue #127)', () => {
  let projectDir: string
  let homeDir: string
  let env: NodeJS.ProcessEnv

  beforeEach(async () => {
    projectDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'attest-it-127-'))
    homeDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'attest-it-127-home-'))
    // Isolate both attest-it's home and VaultKeeper's `file` backend to the
    // temp home so the real `~/.config` is never touched (issue #114).
    env = { ATTEST_IT_HOME: homeDir, VAULTKEEPER_CONFIG_DIR: homeDir }
  })

  afterEach(async () => {
    await fs.promises.rm(projectDir, { recursive: true, force: true })
    await fs.promises.rm(homeDir, { recursive: true, force: true })
  })

  it(
    'AC1: init --root-signer on a populated repo succeeds WITHOUT --force and leaves ' +
      'gates, suites, and the existing seal intact, with verify passing',
    async () => {
      await scaffoldSealedProject(projectDir, env)

      // The reported repro's failing step: the CLI's own "Next steps" tells the
      // user to run exactly this. Pre-fix it exited non-zero ("Pass --force")
      // and, with --force, wiped gates/suites. Post-fix it must succeed as-is.
      const rootSignerResult = await runCliNonInteractive(
        ['init', '--root-signer', 'test-user'],
        projectDir,
        env,
      )
      expect(rootSignerResult.exitCode).toBe(0)
      expect(rootSignerResult.stdout).toContain('Trust anchor established')

      // Gates survived in policy.yaml.
      const policy = readAttestConfig(projectDir, 'policy.yaml')
      expect(isRecordOfUnknown(policy.gates) && 'smoke' in policy.gates).toBe(true)
      // The root gate was merged in additively.
      expect(isRecordOfUnknown(policy.rootGate)).toBe(true)
      // The pre-existing team member survived.
      expect(isRecordOfUnknown(policy.team) && 'test-user' in policy.team).toBe(true)

      // Suites survived in config.yaml.
      const config = readAttestConfig(projectDir, 'config.yaml')
      expect(isRecordOfUnknown(config.suites) && 'smoke' in config.suites).toBe(true)

      // The smoke seal survived (it was NOT orphaned by a re-scaffold). Seals
      // live one file per (gate, signer) under `<seals>/<gateSlug>/<signer>.seal`
      // where each path segment is `<readable>-<hash>`, so match by prefix.
      const sealsDir = path.join(projectDir, '.attest-it', 'seals')
      const gateDirs = fs.readdirSync(sealsDir)
      expect(gateDirs.some((d) => d.startsWith('smoke-'))).toBe(true)

      // The end state the reported repro never reached: verify passes.
      const verifyResult = await runCliNonInteractive(['verify'], projectDir, env)
      expect(verifyResult.exitCode).toBe(0)
      expect(verifyResult.stdout).toContain('All gate seals valid')
    },
    CLI_CALL_TIMEOUT_MS * 8,
  )

  it(
    'AC2: init --force refuses to silently discard a non-empty gates:/suites: config',
    async () => {
      await scaffoldSealedProject(projectDir, env)

      // A full re-scaffold with --force must NOT silently empty the populated
      // config. Non-interactively (no TTY to confirm), it must refuse.
      const forceResult = await runCliNonInteractive(['init', '--force'], projectDir, env)
      expect(forceResult.exitCode).not.toBe(0)
      expect(forceResult.stderr).toMatch(/Refusing to re-scaffold over a populated config/)

      // The config was left completely untouched — this is the whole point.
      const policy = readAttestConfig(projectDir, 'policy.yaml')
      expect(isRecordOfUnknown(policy.gates) && 'smoke' in policy.gates).toBe(true)
      const config = readAttestConfig(projectDir, 'config.yaml')
      expect(isRecordOfUnknown(config.suites) && 'smoke' in config.suites).toBe(true)
    },
    CLI_CALL_TIMEOUT_MS * 8,
  )
})
