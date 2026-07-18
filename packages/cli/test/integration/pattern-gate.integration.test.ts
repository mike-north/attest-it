/**
 * CLI-layer UAT for **pattern gates** (`kind: pattern`) driven through the real,
 * built `attest-it` binary as subprocesses (issue #130).
 *
 * The core (`@attest-it/core`) has per-file fingerprinting/sealing primitives
 * with their own unit tests, but before this change the CLI commands
 * (`seal`/`verify`/`status`/`run`) never called them — a `kind: pattern` gate
 * silently degraded to single-gate behavior (one combined seal, one row, whole-
 * gate invalidation). These tests exercise the documented per-file contract at
 * the CLI boundary, so they FAIL against the pre-fix CLI:
 *
 *   - sealing a 2-file pattern gate produces **two** per-file `.seal` files
 *     (each carrying an `artifactPath`), not one combined aggregate seal;
 *   - `status --json` / `verify --json` show **one row per matched file**;
 *   - a newly-added matching file shows UNSEALED (`MISSING`) with no config edit;
 *   - a one-byte change to one sealed file flips ONLY that file to
 *     `FINGERPRINT_MISMATCH` while its sibling stays `VALID`.
 *
 * A regression case asserts a single (non-pattern) gate still yields exactly one
 * combined seal and one row.
 *
 * @see docs/configuration.md (pattern gates)
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

function runCli(args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): Promise<RunResult> {
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
      reject(new Error(`CLI call timed out: attest-it ${args.join(' ')}\nstdout:\n${stdout}`))
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
      if (code === 0) resolve()
      else reject(new Error(`git ${args.join(' ')} exited ${String(code)}`))
    })
    child.on('error', reject)
  })
}

/** Recursively collect every `.seal` file's absolute path under `.attest-it/seals`. */
function collectSealFiles(projectDir: string): string[] {
  const root = path.join(projectDir, '.attest-it', 'seals')
  const out: string[] = []
  const walk = (dir: string): void => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile() && entry.name.endsWith('.seal')) out.push(full)
    }
  }
  walk(root)
  return out.sort()
}

interface JsonRow {
  gateId: string
  artifactPath?: string
  state: string
}

function parseRows(stdout: string): JsonRow[] {
  const parsed: unknown = JSON.parse(stdout)
  if (!Array.isArray(parsed)) throw new Error(`Expected a JSON array, got: ${stdout}`)
  return parsed as JsonRow[]
}

/** Index verification/status rows by their artifact path for per-file assertions. */
function byArtifact(rows: JsonRow[]): Map<string, JsonRow> {
  const m = new Map<string, JsonRow>()
  for (const r of rows) {
    if (r.artifactPath !== undefined) m.set(r.artifactPath, r)
  }
  return m
}

/**
 * Run the shared bootstrap: create an identity, `init`, write the given policy
 * gates + operational suites, join the team over `gateIds`, and commit. Returns
 * once the working tree is clean and the gate(s) are ready to seal.
 */
async function bootstrap(
  projectDir: string,
  env: NodeJS.ProcessEnv,
  gates: Record<string, unknown>,
  suites: Record<string, unknown>,
  gateIds: string[],
): Promise<void> {
  await fs.promises.writeFile(
    path.join(projectDir, 'package.json'),
    JSON.stringify({ dependencies: {} }, null, 2),
  )
  await runGit(['init'], projectDir)
  await runGit(['config', 'user.email', 'test@example.com'], projectDir)
  await runGit(['config', 'user.name', 'Test User'], projectDir)

  const createResult = await runCli(
    ['identity', 'create', '--name', 'Test User', '--slug', 'test-user', '--storage', 'file'],
    projectDir,
    env,
  )
  expect(createResult.exitCode, createResult.stderr).toBe(0)

  const initResult = await runCli(['init'], projectDir, env)
  expect(initResult.exitCode, initResult.stderr).toBe(0)

  const policyPath = path.join(projectDir, '.attest-it', 'policy.yaml')
  await fs.promises.writeFile(
    policyPath,
    stringifyYaml({ version: 1, settings: { maxAgeDays: 30 }, team: {}, gates }),
    'utf8',
  )
  await fs.promises.writeFile(
    path.join(projectDir, '.attest-it', 'config.yaml'),
    stringifyYaml({ version: 1, settings: {}, suites }),
    'utf8',
  )

  const joinResult = await runCli(['team', 'join', '--gates', ...gateIds], projectDir, env)
  expect(joinResult.exitCode, joinResult.stderr).toBe(0)

  await runGit(['add', '.'], projectDir)
  await runGit(['commit', '-m', 'configure gates'], projectDir)
}

describe('pattern gates through the real CLI (issue #130)', () => {
  let projectDir: string
  let homeDir: string
  let env: NodeJS.ProcessEnv

  beforeEach(async () => {
    projectDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'attest-it-pattern-'))
    homeDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'attest-it-pattern-home-'))
    // Issue #114: redirect VaultKeeper's file backend to the isolated temp home
    // so the real ~/.config/vaultkeeper is never touched.
    env = { ATTEST_IT_HOME: homeDir, VAULTKEEPER_CONFIG_DIR: homeDir }
  })

  afterEach(async () => {
    await fs.promises.rm(projectDir, { recursive: true, force: true })
    await fs.promises.rm(homeDir, { recursive: true, force: true })
  })

  const patternGates = {
    tools: {
      name: 'Tools',
      description: 'Per-file pattern gate over tools shell scripts',
      kind: 'pattern',
      authorizedSigners: ['test-user'],
      fingerprint: { paths: ['tools/*.sh'] },
      maxAge: '30d',
    },
  }

  async function writeToolFiles(files: Record<string, string>): Promise<void> {
    await fs.promises.mkdir(path.join(projectDir, 'tools'), { recursive: true })
    for (const [name, content] of Object.entries(files)) {
      await fs.promises.writeFile(path.join(projectDir, 'tools', name), content, 'utf8')
    }
  }

  it(
    'seals one per-file seal per matched file; per-file rows; new file unsealed; one-byte flip isolates',
    async () => {
      await writeToolFiles({
        'build.sh': '#!/bin/sh\necho build\n',
        'deploy.sh': '#!/bin/sh\necho deploy\n',
      })
      await bootstrap(
        projectDir,
        env,
        patternGates,
        { tools: { gate: 'tools', command: 'true' } },
        ['tools'],
      )

      // seal → ONE seal file per matched file (two), each carrying an artifactPath.
      const sealResult = await runCli(['seal', 'tools'], projectDir, env)
      expect(sealResult.exitCode, sealResult.stderr).toBe(0)

      const sealFiles = collectSealFiles(projectDir)
      expect(sealFiles).toHaveLength(2)
      const sealArtifacts = sealFiles
        .map((p) => parseYaml(fs.readFileSync(p, 'utf8')) as { artifactPath?: string })
        .map((s) => s.artifactPath)
        .sort()
      expect(sealArtifacts).toEqual(['tools/build.sh', 'tools/deploy.sh'])

      // status --json → per-file rows, both VALID.
      const status1 = await runCli(['status', '--json'], projectDir, env)
      expect(status1.exitCode, status1.stderr).toBe(0)
      const rows1 = byArtifact(parseRows(status1.stdout))
      expect(rows1.get('tools/build.sh')?.state).toBe('VALID')
      expect(rows1.get('tools/deploy.sh')?.state).toBe('VALID')
      expect(rows1.size).toBe(2)

      // verify --json → per-file rows, exit 0.
      const verify1 = await runCli(['verify', '--json'], projectDir, env)
      expect(verify1.exitCode, verify1.stderr).toBe(0)
      const vrows1 = byArtifact(parseRows(verify1.stdout))
      expect(vrows1.get('tools/build.sh')?.state).toBe('VALID')
      expect(vrows1.get('tools/deploy.sh')?.state).toBe('VALID')

      // Add a THIRD matching file with NO config change → it shows UNSEALED.
      await writeToolFiles({ 'release.sh': '#!/bin/sh\necho release\n' })
      const status2 = await runCli(['status', '--json'], projectDir, env)
      expect(status2.exitCode, status2.stderr).toBe(0)
      const rows2 = byArtifact(parseRows(status2.stdout))
      expect(rows2.size).toBe(3)
      expect(rows2.get('tools/release.sh')?.state).toBe('MISSING')
      expect(rows2.get('tools/build.sh')?.state).toBe('VALID')
      expect(rows2.get('tools/deploy.sh')?.state).toBe('VALID')

      // Edit ONE byte of ONE sealed file → only that file flips; sibling unaffected.
      await fs.promises.writeFile(
        path.join(projectDir, 'tools', 'build.sh'),
        '#!/bin/sh\necho BUILD\n',
        'utf8',
      )
      const status3 = await runCli(['status', '--json'], projectDir, env)
      const rows3 = byArtifact(parseRows(status3.stdout))
      expect(rows3.get('tools/build.sh')?.state).toBe('FINGERPRINT_MISMATCH')
      expect(rows3.get('tools/deploy.sh')?.state).toBe('VALID')
      expect(rows3.get('tools/release.sh')?.state).toBe('MISSING')

      // verify now fails (one file invalid) — but the sibling is still reported VALID.
      const verify3 = await runCli(['verify', '--json'], projectDir, env)
      expect(verify3.exitCode).not.toBe(0)
      const vrows3 = byArtifact(parseRows(verify3.stdout))
      expect(vrows3.get('tools/build.sh')?.state).toBe('FINGERPRINT_MISMATCH')
      expect(vrows3.get('tools/deploy.sh')?.state).toBe('VALID')
    },
    CLI_CALL_TIMEOUT_MS * 8,
  )

  it(
    'run --suite over a pattern gate seals each matched file independently',
    async () => {
      await writeToolFiles({
        'build.sh': '#!/bin/sh\necho build\n',
        'deploy.sh': '#!/bin/sh\necho deploy\n',
      })
      await bootstrap(
        projectDir,
        env,
        patternGates,
        { tools: { gate: 'tools', command: 'true' } },
        ['tools'],
      )

      const runResult = await runCli(['run', '--suite', 'tools', '--yes'], projectDir, env)
      expect(runResult.exitCode, runResult.stderr).toBe(0)

      // Consistent with `seal`: one per-file seal per matched file.
      const sealFiles = collectSealFiles(projectDir)
      expect(sealFiles).toHaveLength(2)

      const verifyResult = await runCli(['verify', '--json'], projectDir, env)
      expect(verifyResult.exitCode, verifyResult.stderr).toBe(0)
      const rows = byArtifact(parseRows(verifyResult.stdout))
      expect(rows.get('tools/build.sh')?.state).toBe('VALID')
      expect(rows.get('tools/deploy.sh')?.state).toBe('VALID')
    },
    CLI_CALL_TIMEOUT_MS * 8,
  )

  it(
    'regression: a single (non-pattern) gate still produces one combined seal and one row',
    async () => {
      await fs.promises.mkdir(path.join(projectDir, 'src'), { recursive: true })
      await fs.promises.writeFile(path.join(projectDir, 'src', 'a.ts'), 'export const a = 1\n')
      await fs.promises.writeFile(path.join(projectDir, 'src', 'b.ts'), 'export const b = 2\n')

      const singleGate = {
        core: {
          name: 'Core',
          description: 'A single combined-fingerprint gate',
          authorizedSigners: ['test-user'],
          fingerprint: { paths: ['src'] },
          maxAge: '30d',
        },
      }
      await bootstrap(projectDir, env, singleGate, { core: { gate: 'core', command: 'true' } }, [
        'core',
      ])

      const sealResult = await runCli(['seal', 'core'], projectDir, env)
      expect(sealResult.exitCode, sealResult.stderr).toBe(0)

      // Exactly ONE combined seal, with NO artifactPath (aggregate one-per-gate).
      const sealFiles = collectSealFiles(projectDir)
      expect(sealFiles).toHaveLength(1)
      const seal = parseYaml(fs.readFileSync(sealFiles[0]!, 'utf8')) as { artifactPath?: string }
      expect(seal.artifactPath).toBeUndefined()

      // Exactly one status row, keyed by gate (no artifactPath).
      const statusResult = await runCli(['status', '--json'], projectDir, env)
      expect(statusResult.exitCode, statusResult.stderr).toBe(0)
      const rows = parseRows(statusResult.stdout)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.gateId).toBe('core')
      expect(rows[0]?.artifactPath).toBeUndefined()
      expect(rows[0]?.state).toBe('VALID')
    },
    CLI_CALL_TIMEOUT_MS * 6,
  )
})
