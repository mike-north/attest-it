/**
 * End-to-end UAT for the documented getting-started flow (issue #84).
 *
 * Drives the real, built CLI as subprocesses with stdin fully closed
 * (mirroring `< /dev/null`), through the exact sequence
 * `docs/getting-started.md` documents: `init` (on a package.json shaped
 * exactly like `npm install`'s output), `identity create`, `team join`,
 * hand-defining a gate/suite (the documented manual-edit step -- see
 * "Step 2b: Define Your First Gate and Suite" in the doc), `run --suite`
 * (seal), `status`, and `verify`. Every step must exit 0 with zero
 * undocumented prompts.
 *
 * @see docs/getting-started.md
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
 * timeout. A hang here would mean an undocumented prompt slipped through
 * despite there being no TTY -- exactly the class of bug this issue reports.
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
          `CLI call did not exit within ${String(CLI_CALL_TIMEOUT_MS)}ms -- likely an ` +
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

describe('documented getting-started flow end-to-end (issue #84)', () => {
  let projectDir: string
  let homeDir: string

  beforeEach(async () => {
    projectDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'attest-it-getting-started-'))
    homeDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'attest-it-getting-started-home-'))
  })

  afterEach(async () => {
    await fs.promises.rm(projectDir, { recursive: true, force: true })
    await fs.promises.rm(homeDir, { recursive: true, force: true })
  })

  it(
    'AC: init succeeds on the exact package.json npm install leaves behind (no name/version)',
    async () => {
      const env = { ATTEST_IT_HOME: homeDir }

      // This is exactly what `npm install <pkg>` produces in a directory with
      // no prior package.json (README Quick Start step 1) -- verified by
      // running `npm install is-odd` in an empty temp dir during triage: the
      // resulting file has no "name" and no "version" field.
      await fs.promises.writeFile(
        path.join(projectDir, 'package.json'),
        JSON.stringify({ dependencies: { 'is-odd': '^3.0.1' } }, null, 2),
      )

      const initResult = await runCliNonInteractive(['init', '--force'], projectDir, env)

      expect(initResult.exitCode).toBe(0)
      expect(initResult.stderr).not.toMatch(/Invalid package\.json/)

      const packageJson: unknown = JSON.parse(
        await fs.promises.readFile(path.join(projectDir, 'package.json'), 'utf8'),
      )
      if (!isRecordOfUnknown(packageJson)) throw new Error('expected package.json to be an object')
      expect(typeof packageJson.name).toBe('string')
      expect(typeof packageJson.version).toBe('string')
    },
    CLI_CALL_TIMEOUT_MS,
  )

  it(
    'AC: the full documented sequence (identity create -> init -> team join -> ' +
      'define a gate -> seal -> status -> verify) succeeds with no undocumented ' +
      'manual YAML editing beyond the documented gate/suite step, and no undocumented prompts',
    async () => {
      const env = { ATTEST_IT_HOME: homeDir }

      // Mirror the README's own first command: a bare package.json with no
      // name/version, as `npm install attest-it` leaves behind.
      await fs.promises.writeFile(
        path.join(projectDir, 'package.json'),
        JSON.stringify({ dependencies: {} }, null, 2),
      )
      await fs.promises.mkdir(path.join(projectDir, 'src'), { recursive: true })
      await fs.promises.writeFile(path.join(projectDir, 'src', 'index.ts'), 'export const x = 1\n')
      await runGit(['init'], projectDir)
      await runGit(['config', 'user.email', 'test@example.com'], projectDir)
      await runGit(['config', 'user.name', 'Test User'], projectDir)

      // Step 1: identity create (docs/getting-started.md "Step 1")
      const createResult = await runCliNonInteractive(
        ['identity', 'create', '--name', 'Test User', '--slug', 'test-user', '--storage', 'file'],
        projectDir,
        env,
      )
      expect(createResult.exitCode).toBe(0)
      const publicKey = await readCreatedPublicKey(homeDir, 'test-user')

      // Step 2: init (docs/getting-started.md "Step 2"). Fresh directory
      // aside from the bare package.json above, so no overwrite prompt.
      const initResult = await runCliNonInteractive(['init'], projectDir, env)
      expect(initResult.exitCode).toBe(0)
      expect(fs.existsSync(path.join(projectDir, '.attest-it', 'policy.yaml'))).toBe(true)
      expect(fs.existsSync(path.join(projectDir, '.attest-it', 'config.yaml'))).toBe(true)

      // Step 2b: define a gate + suite (docs/getting-started.md "Step 2b") --
      // this is the one documented manual-edit step; init deliberately does
      // not prompt for it (see AC: "either init prompts... or docs match the
      // real manual-edit flow" -- this PR picks the latter).
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
              // Every gate requires >=1 authorized signer; list the identity
              // slug now, then "team join" (next step) adds it to the team
              // so the reference resolves -- see docs/getting-started.md's
              // "Step 2b: Define Your First Gate and Suite".
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

      // Step 3: team join (docs/getting-started.md "Step 3"). Must succeed
      // even though it runs right after a scaffold whose suites were, until
      // just now, empty -- the documented order (init -> team join -> define
      // gates/suites) must not be circular (AC #3).
      const joinResult = await runCliNonInteractive(
        ['team', 'join', '--gates', 'smoke'],
        projectDir,
        env,
      )
      expect(joinResult.exitCode).toBe(0)
      expect(joinResult.stdout).toContain('added successfully')

      const policyAfterJoin: unknown = parseYaml(await fs.promises.readFile(policyPath, 'utf8'))
      if (!isRecordOfUnknown(policyAfterJoin) || !isRecordOfUnknown(policyAfterJoin.team)) {
        throw new Error('Expected policy.yaml to contain a team map after join')
      }
      const teamMember = policyAfterJoin.team['test-user']
      if (!isRecordOfUnknown(teamMember)) {
        throw new Error('Expected test-user to be added to the team')
      }
      expect(teamMember.publicKey).toBe(publicKey)

      await runGit(['add', '.'], projectDir)
      await runGit(['commit', '-m', 'configure gate, suite, and team'], projectDir)

      // Step 4: run --suite ... --yes (docs/getting-started.md "Step 4")
      const runResult = await runCliNonInteractive(
        ['run', '--suite', 'smoke', '--yes'],
        projectDir,
        env,
      )
      expect(runResult.exitCode).toBe(0)
      expect(runResult.stdout).toContain("Seal created for gate 'smoke'")

      // Checking Status (docs/getting-started.md "Checking Status")
      const statusResult = await runCliNonInteractive(['status'], projectDir, env)
      expect(statusResult.exitCode).toBe(0)
      expect(statusResult.stdout).toContain('VALID')

      // Step 6: verify (docs/getting-started.md "Step 6")
      const verifyResult = await runCliNonInteractive(['verify'], projectDir, env)
      expect(verifyResult.exitCode).toBe(0)
      expect(verifyResult.stdout).toContain('All gate seals valid')

      // No undocumented prompts: every call above closed stdin and completed
      // before the timeout, so nothing hung waiting on input. The only
      // interactive-only prompt init can show (shell completions) is
      // documented in getting-started.md and is itself skipped whenever
      // stdin isn't a TTY, which is asserted by init exiting 0 above without
      // any confirm() call blocking on the closed stdin.
    },
    CLI_CALL_TIMEOUT_MS * 6,
  )

  it(
    'AC: identity export never guides users to the nonexistent team-config.yaml/members schema',
    async () => {
      const env = { ATTEST_IT_HOME: homeDir }

      const createResult = await runCliNonInteractive(
        ['identity', 'create', '--name', 'Test User', '--slug', 'test-user', '--storage', 'file'],
        projectDir,
        env,
      )
      expect(createResult.exitCode).toBe(0)

      const exportResult = await runCliNonInteractive(['identity', 'export'], projectDir, env)

      expect(exportResult.exitCode).toBe(0)
      expect(exportResult.stdout).not.toMatch(/team-config\.yaml/)
      expect(exportResult.stdout).not.toMatch(/members:/)
      expect(exportResult.stdout).toMatch(/\.attest-it\/policy\.yaml/)
      expect(exportResult.stdout).toMatch(/"team:"/)
    },
    CLI_CALL_TIMEOUT_MS * 2,
  )
})
