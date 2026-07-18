/**
 * Regression tests for issues #134 and #135, both on the `team join` write
 * path against a real, built CLI subprocess -- not a hand-built
 * approximation of policy.yaml or the command's option parsing.
 *
 * #134: `team join` rewrote the `team:` section of the trust-critical,
 * review-gated `policy.yaml` into flow-style, JSON-like YAML
 * (`team: {alice: {...}}`) the moment a member was added to the scaffolded,
 * empty `team: {}`, while the untouched `gates:` section (and every doc
 * example) stayed block-style. This made security review diffs noisy.
 *
 * #135: `team join --gates <name>` naming a gate that isn't defined in
 * policy.yaml silently succeeded (exit 0), giving no signal that the named
 * authorization was a no-op.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as os from 'node:os'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CLI_PATH = path.resolve(__dirname, '../../dist/bin/attest-it.js')

const CLI_CALL_TIMEOUT_MS = 15000

interface RunResult {
  exitCode: number
  stdout: string
  stderr: string
}

/**
 * Run the built CLI as a real subprocess with stdin closed (equivalent to
 * `< /dev/null`) and a hard timeout, so a regression that reintroduces an
 * interactive prompt fails loudly instead of hanging the suite.
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

describe('team join write path (issues #134, #135)', () => {
  let projectDir: string
  let homeDir: string

  beforeEach(async () => {
    projectDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'attest-it-team-join-'))
    homeDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'attest-it-team-join-home-'))
  })

  afterEach(async () => {
    await fs.promises.rm(projectDir, { recursive: true, force: true })
    await fs.promises.rm(homeDir, { recursive: true, force: true })
  })

  it(
    'writes the `team:` section in block style (not flow-style JSON-like YAML), leaving the untouched `gates:` section byte-unchanged (issue #134)',
    async () => {
      const env = { ATTEST_IT_HOME: homeDir, VAULTKEEPER_CONFIG_DIR: homeDir }
      const policyPath = path.join(projectDir, '.attest-it', 'policy.yaml')

      // 1. init: scaffolds policy.yaml with block-style `team: {}` / `gates: {}`.
      const initResult = await runCliNonInteractive(['init'], projectDir, env)
      expect(initResult.exitCode).toBe(0)

      const scaffolded = await fs.promises.readFile(policyPath, 'utf8')
      expect(scaffolded).toContain('team: {}')

      // Sanity: the untouched `gates:` section snapshot we'll assert is
      // byte-for-byte identical after `team join` writes.
      const gatesSectionBefore = scaffolded.slice(scaffolded.indexOf('# Gates define'))

      // 2. identity create: the identity `team join` will add.
      const createResult = await runCliNonInteractive(
        ['identity', 'create', '--name', 'Test User', '--slug', 'test-user', '--storage', 'file'],
        projectDir,
        env,
      )
      expect(createResult.exitCode).toBe(0)

      // 3. team join: previously rewrote `team:` into flow-style YAML the
      // instant a member was added to the scaffolded, empty `team: {}`.
      const joinResult = await runCliNonInteractive(['team', 'join'], projectDir, env)
      expect(joinResult.exitCode).toBe(0)
      expect(joinResult.stdout).toContain('added successfully')

      const afterJoin = await fs.promises.readFile(policyPath, 'utf8')

      // The written `team:` section must not contain a flow-style JSON-like
      // mapping anywhere (this is the exact regression from issue #134).
      expect(afterJoin).not.toMatch(/team:\s*\{/)
      expect(afterJoin).toMatch(/team:\n {2}test-user:\n {4}name: Test User/)

      // The untouched `gates:` section (including its commented example and
      // the empty `gates: {}` scaffold) must be byte-for-byte unchanged.
      const gatesSectionAfter = afterJoin.slice(afterJoin.indexOf('# Gates define'))
      expect(gatesSectionAfter).toBe(gatesSectionBefore)
    },
    CLI_CALL_TIMEOUT_MS * 3,
  )

  it(
    'hard-fails naming the missing gate when --gates references a gate not defined in policy.yaml, and still succeeds for a gate that does exist (issue #135)',
    async () => {
      const env = { ATTEST_IT_HOME: homeDir, VAULTKEEPER_CONFIG_DIR: homeDir }
      const policyPath = path.join(projectDir, '.attest-it', 'policy.yaml')

      const initResult = await runCliNonInteractive(['init'], projectDir, env)
      expect(initResult.exitCode).toBe(0)

      // policy.yaml scaffolds `gates: {}` -- no gates are defined at all,
      // matching the exact repro in issue #135.
      const scaffolded = await fs.promises.readFile(policyPath, 'utf8')
      expect(scaffolded).toContain('gates: {}')

      const createResult = await runCliNonInteractive(
        ['identity', 'create', '--name', 'Test User', '--slug', 'test-user', '--storage', 'file'],
        projectDir,
        env,
      )
      expect(createResult.exitCode).toBe(0)

      // --gates my-gate, where "my-gate" is not defined anywhere in
      // policy.yaml -- must hard-fail (nonzero exit) naming "my-gate", not
      // silently succeed.
      const joinWithUnknownGate = await runCliNonInteractive(
        ['team', 'join', '--gates', 'my-gate'],
        projectDir,
        env,
      )
      expect(joinWithUnknownGate.exitCode).not.toBe(0)
      expect(joinWithUnknownGate.stdout + joinWithUnknownGate.stderr).toContain('my-gate')

      // The failed attempt must not have written the team member to disk.
      const afterFailedJoin = await fs.promises.readFile(policyPath, 'utf8')
      expect(afterFailedJoin).not.toContain('test-user:')

      // Now hand-author a real gate into policy.yaml (no CLI command creates
      // gates yet) and confirm referencing an *existing* gate by name still
      // works unchanged.
      const withGate = afterFailedJoin.replace(
        'gates: {}',
        'gates:\n  release:\n    name: Release Gate\n    description: Release approval\n    authorizedSigners:\n      - placeholder\n    fingerprint:\n      paths:\n        - src\n',
      )
      await fs.promises.writeFile(policyPath, withGate, 'utf8')

      const joinWithKnownGate = await runCliNonInteractive(
        ['team', 'join', '--gates', 'release'],
        projectDir,
        env,
      )
      expect(joinWithKnownGate.exitCode).toBe(0)
      expect(joinWithKnownGate.stdout).toContain('added successfully')

      const afterSuccessfulJoin = await fs.promises.readFile(policyPath, 'utf8')
      expect(afterSuccessfulJoin).toContain('test-user:')
      expect(afterSuccessfulJoin).toMatch(
        /authorizedSigners:\s*\n\s*-\s*placeholder\s*\n\s*-\s*test-user/,
      )
    },
    CLI_CALL_TIMEOUT_MS * 3,
  )
})
