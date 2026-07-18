/**
 * Shared fixture setup for pty-driven `run` tests (issue #100).
 *
 * Builds a real, git-committed project with a real local identity
 * authorized to seal its one gate, using the same documented sequence as
 * `test/integration/getting-started.integration.test.ts` (`identity create`
 * -> `init` -> hand-define gate/suite -> `team join` -> commit), so that
 * `attest-it run --suite <name>` (run inside a pty, without `--yes`) reaches
 * the real "Create seal for gate ... ?" confirmation prompt.
 *
 * @packageDocumentation
 */
import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stringify as stringifyYaml, parse as parseYaml } from 'yaml'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const CLI_PATH = path.resolve(__dirname, '../../dist/bin/attest-it.js')

interface RunResult {
  exitCode: number
  stdout: string
  stderr: string
}

/** Run the built CLI as a real subprocess with stdin closed and a hard timeout. */
function runCliNonInteractive(
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs = 15000,
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
          `CLI call did not exit within ${String(timeoutMs)}ms: node attest-it ${args.join(' ')}\n` +
            `stdout so far:\n${stdout}\nstderr so far:\n${stderr}`,
        ),
      )
    }, timeoutMs)

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

export interface SealPromptFixture {
  /** Directory containing the git repo + attest-it project configuration. */
  projectDir: string
  /** Directory used as this fixture's isolated `ATTEST_IT_HOME`. */
  homeDir: string
  /**
   * Env vars (`ATTEST_IT_HOME`, `VAULTKEEPER_CONFIG_DIR`) to pass to any CLI
   * invocation against this fixture.
   */
  env: NodeJS.ProcessEnv
  /** Name of the suite/gate configured, authorized for the fixture's identity. */
  suiteName: string
  gateId: string
  /** Remove both temp directories. */
  cleanup: () => Promise<void>
}

/**
 * Build a project + local identity such that `attest-it run --suite <suiteName>`
 * reaches the real seal-confirmation prompt after tests pass.
 */
export async function setupSealPromptFixture(): Promise<SealPromptFixture> {
  const projectDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'attest-it-pty-project-'))
  const homeDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'attest-it-pty-home-'))
  // Issue #114: also redirect VaultKeeper's `file` backend to this same
  // isolated temp home, so `identity create --storage file` below never
  // touches the real `~/.config/vaultkeeper/file/`.
  const env = { ATTEST_IT_HOME: homeDir, VAULTKEEPER_CONFIG_DIR: homeDir, NO_COLOR: '1' }
  const suiteName = 'smoke'
  const gateId = 'smoke'

  await fs.promises.writeFile(
    path.join(projectDir, 'package.json'),
    JSON.stringify({ name: 'pty-fixture', version: '0.0.0', private: true }, null, 2),
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
  if (createResult.exitCode !== 0) {
    throw new Error(
      `identity create failed (exit ${String(createResult.exitCode)}):\n${createResult.stderr}`,
    )
  }

  const initResult = await runCliNonInteractive(['init'], projectDir, env)
  if (initResult.exitCode !== 0) {
    throw new Error(`init failed (exit ${String(initResult.exitCode)}):\n${initResult.stderr}`)
  }

  const policyPath = path.join(projectDir, '.attest-it', 'policy.yaml')
  await fs.promises.writeFile(
    policyPath,
    stringifyYaml({
      version: 1,
      settings: { maxAgeDays: 30 },
      team: {},
      gates: {
        [gateId]: {
          name: 'Smoke Test',
          description: 'A trivial gate for pty-driven cancellation tests',
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
      suites: { [suiteName]: { gate: gateId, command: 'node -e "console.log(1)"' } },
    }),
    'utf8',
  )

  const joinResult = await runCliNonInteractive(
    ['team', 'join', '--gates', gateId],
    projectDir,
    env,
  )
  if (joinResult.exitCode !== 0) {
    throw new Error(`team join failed (exit ${String(joinResult.exitCode)}):\n${joinResult.stderr}`)
  }

  await runGit(['add', '.'], projectDir)
  await runGit(['commit', '-m', 'configure gate, suite, and team'], projectDir)

  // Sanity check: the local identity's public key really is authorized.
  const policyAfterJoin: unknown = parseYaml(await fs.promises.readFile(policyPath, 'utf8'))
  if (
    !isRecordOfUnknown(policyAfterJoin) ||
    !isRecordOfUnknown(policyAfterJoin.team) ||
    !isRecordOfUnknown(policyAfterJoin.team['test-user'])
  ) {
    throw new Error('Fixture setup did not add test-user to the team as expected')
  }

  return {
    projectDir,
    homeDir,
    env,
    suiteName,
    gateId,
    cleanup: async () => {
      await Promise.all([
        fs.promises.rm(projectDir, { recursive: true, force: true }),
        fs.promises.rm(homeDir, { recursive: true, force: true }),
      ])
    },
  }
}
