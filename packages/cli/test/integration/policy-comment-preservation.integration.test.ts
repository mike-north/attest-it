/**
 * Regression test for issue #102: CLI commands that write `policy.yaml`
 * silently stripped every human-authored comment (including the
 * `# yaml-language-server: $schema=...` directive `init` scaffolds) the
 * moment a documented, required step (`team join`) ran.
 *
 * This test drives the real, built CLI as subprocesses -- `init` scaffolds
 * `policy.yaml` with its schema directive, trust-model header, and commented
 * onboarding examples; `team join` then mutates it. Before the fix, `team
 * join`'s `stringify(parsedPolicyObject)` write destroyed all of that. The
 * assertions below fail against the pre-fix code (the file would contain
 * none of these strings) and pass once `team join` round-trips through a
 * comment-preserving YAML `Document` edit instead.
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

function isRecordOfUnknown(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Read the public key attest-it just wrote for `slug` under a temp ATTEST_IT_HOME. */
async function readCreatedPublicKey(homeDir: string, slug: string): Promise<string> {
  const { parse: parseYaml } = await import('yaml')
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

describe('policy.yaml comment preservation across mutating commands (issue #102)', () => {
  let projectDir: string
  let homeDir: string

  beforeEach(async () => {
    projectDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'attest-it-policy-comments-'))
    homeDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'attest-it-policy-comments-home-'))
  })

  afterEach(async () => {
    await fs.promises.rm(projectDir, { recursive: true, force: true })
    await fs.promises.rm(homeDir, { recursive: true, force: true })
  })

  it(
    'keeps the schema directive and header/example comments after `team join` mutates a freshly-scaffolded policy.yaml',
    async () => {
      const env = { ATTEST_IT_HOME: homeDir }
      const policyPath = path.join(projectDir, '.attest-it', 'policy.yaml')

      // 1. init: scaffolds policy.yaml with the schema directive, trust-model
      // header, and commented team/gates examples.
      const initResult = await runCliNonInteractive(['init'], projectDir, env)
      expect(initResult.exitCode).toBe(0)

      const scaffolded = await fs.promises.readFile(policyPath, 'utf8')
      expect(scaffolded).toContain(
        '# yaml-language-server: $schema=https://raw.githubusercontent.com/mike-north/attest-it/main/schemas/v1/policy.schema.json',
      )
      expect(scaffolded).toContain('# attest-it policy configuration (trust-critical)')
      expect(scaffolded).toContain('# Team members who can sign seals.')

      // 2. identity create: the identity `team join` will add.
      const createResult = await runCliNonInteractive(
        ['identity', 'create', '--name', 'Test User', '--slug', 'test-user', '--storage', 'file'],
        projectDir,
        env,
      )
      expect(createResult.exitCode).toBe(0)
      const publicKey = await readCreatedPublicKey(homeDir, 'test-user')
      void publicKey // identity create's own output is sufficient; join re-reads it internally

      // 3. team join: the documented, required onboarding step that
      // previously rewrote policy.yaml as a bare, comment-free YAML dump.
      const joinResult = await runCliNonInteractive(['team', 'join'], projectDir, env)
      expect(joinResult.exitCode).toBe(0)
      expect(joinResult.stdout).toContain('added successfully')

      const afterJoin = await fs.promises.readFile(policyPath, 'utf8')

      // The schema directive must survive -- this is the exact regression
      // reported in issue #102 (editor tooling silently loses its `$schema`
      // hint the moment a teammate runs `team join`).
      expect(afterJoin).toContain(
        '# yaml-language-server: $schema=https://raw.githubusercontent.com/mike-north/attest-it/main/schemas/v1/policy.schema.json',
      )
      // Representative header and onboarding-example comments must survive.
      expect(afterJoin).toContain('# attest-it policy configuration (trust-critical)')
      expect(afterJoin).toContain('This file defines WHO may sign and WHAT is protected.')
      expect(afterJoin).toContain('# Team members who can sign seals.')
      expect(afterJoin).toContain('# Gates define what code areas require a seal and who can sign.')

      // ...and the mutation itself must have actually happened.
      expect(afterJoin).toContain('test-user:')
    },
    CLI_CALL_TIMEOUT_MS * 3,
  )

  it(
    'keeps preserving comments across a second mutating command (`team add`) on the same file',
    async () => {
      const env = { ATTEST_IT_HOME: homeDir }
      const policyPath = path.join(projectDir, '.attest-it', 'policy.yaml')

      await runCliNonInteractive(['init'], projectDir, env)
      await runCliNonInteractive(
        ['identity', 'create', '--name', 'Test User', '--slug', 'test-user', '--storage', 'file'],
        projectDir,
        env,
      )
      await runCliNonInteractive(['team', 'join'], projectDir, env)

      const addResult = await runCliNonInteractive(
        [
          'team',
          'add',
          '--slug',
          'bob',
          '--name',
          'Bob',
          '--public-key',
          'oB5OUxsnFR7GdTPURp9loSGinbcb6EKDTrFGKl2VTPk=',
        ],
        projectDir,
        env,
      )
      expect(addResult.exitCode).toBe(0)

      const afterAdd = await fs.promises.readFile(policyPath, 'utf8')
      expect(afterAdd).toContain(
        '# yaml-language-server: $schema=https://raw.githubusercontent.com/mike-north/attest-it/main/schemas/v1/policy.schema.json',
      )
      expect(afterAdd).toContain('# Gates define what code areas require a seal and who can sign.')
      expect(afterAdd).toContain('test-user:')
      expect(afterAdd).toContain('bob:')
    },
    CLI_CALL_TIMEOUT_MS * 4,
  )
})
