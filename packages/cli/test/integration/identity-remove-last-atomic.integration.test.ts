/**
 * UAT for `identity remove` refusing to remove the last identity (issue #133).
 *
 * Pre-fix, `identity remove <slug> -y` on a repo's *last* identity deleted
 * the private key from VaultKeeper storage first, then failed the "cannot
 * remove last identity" guard -- leaving an orphaned config entry that still
 * pointed at now-missing key material. `whoami` kept reporting the identity
 * healthy, but any operation needing the private key (e.g. bootstrapping the
 * root gate) failed with "Secret not found in file store".
 *
 * This test drives the real, built CLI as subprocesses (mirroring the exact
 * repro from the issue): create a single `file`-backed identity, attempt to
 * remove it, and assert both that the removal is refused (exit 3) *and* that
 * the private key still resolves afterward via a real signing operation
 * (`init --root-signer <slug>`, which loads the identity's private key and
 * uses it to create the root gate's anchoring seal). Against the pre-fix
 * implementation, the refused removal still deletes the key, so the
 * subsequent `init --root-signer` call fails -- this test fails there and
 * passes once the guard runs before the destructive delete.
 *
 * @see https://github.com/mike-north/attest-it/issues/133
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as os from 'node:os'
import { parse as parseYaml } from 'yaml'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CLI_PATH = path.resolve(__dirname, '../../dist/bin/attest-it.js')

const CLI_CALL_TIMEOUT_MS = 15000
const CONFIG_ERROR_EXIT_CODE = 3

interface RunResult {
  exitCode: number
  stdout: string
  stderr: string
}

/** Run the built CLI as a real subprocess with stdin closed and a hard timeout. */
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

describe('identity remove refuses to remove the last identity atomically (issue #133)', () => {
  let projectDir: string
  let homeDir: string
  let env: NodeJS.ProcessEnv

  beforeEach(async () => {
    projectDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'attest-it-remove-last-'))
    homeDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'attest-it-remove-last-home-'))
    // Issue #114: redirect VaultKeeper's `file` backend to the same isolated
    // temp home used for ATTEST_IT_HOME, so the real
    // `~/.config/vaultkeeper/file/` store is never touched by this test.
    env = { ATTEST_IT_HOME: homeDir, VAULTKEEPER_CONFIG_DIR: homeDir }
  })

  afterEach(async () => {
    await fs.promises.rm(projectDir, { recursive: true, force: true })
    await fs.promises.rm(homeDir, { recursive: true, force: true })
  })

  it(
    'refuses removal of the last identity (exit 3) and leaves the private key ' +
      'usable -- a subsequent `init --root-signer` still resolves and signs with it',
    async () => {
      const slug = 'only-one'

      const createResult = await runCliNonInteractive(
        ['identity', 'create', '--name', 'Only One', '--slug', slug, '--storage', 'file'],
        projectDir,
        env,
      )
      expect(createResult.exitCode).toBe(0)

      // Sanity check: exactly one identity exists before the removal attempt.
      const configBefore: unknown = parseYaml(
        await fs.promises.readFile(path.join(homeDir, 'config.yaml'), 'utf8'),
      )
      if (!isRecordOfUnknown(configBefore) || !isRecordOfUnknown(configBefore.identities)) {
        throw new Error('Expected local config to contain an identities map')
      }
      expect(Object.keys(configBefore.identities)).toEqual([slug])

      // Attempt to remove the only identity -- must be refused.
      const removeResult = await runCliNonInteractive(
        ['identity', 'remove', slug, '-y'],
        projectDir,
        env,
      )
      expect(removeResult.exitCode).toBe(CONFIG_ERROR_EXIT_CODE)
      expect(removeResult.stdout + removeResult.stderr).toContain('Cannot remove last identity')

      // Config must still reference the identity -- the refused removal
      // didn't half-apply.
      const configAfter: unknown = parseYaml(
        await fs.promises.readFile(path.join(homeDir, 'config.yaml'), 'utf8'),
      )
      if (!isRecordOfUnknown(configAfter) || !isRecordOfUnknown(configAfter.identities)) {
        throw new Error('Expected local config to still contain an identities map')
      }
      expect(Object.keys(configAfter.identities)).toEqual([slug])

      // The real regression check: the private key must still resolve and be
      // usable for signing, not just referenced in config. `init
      // --root-signer` loads the identity's private key from VaultKeeper and
      // uses it to create the root gate's anchoring seal -- pre-fix, this
      // failed with "Secret not found in file store" because the key had
      // already been deleted before the last-identity guard ran.
      const initResult = await runCliNonInteractive(
        ['init', '--root-signer', slug, '--force'],
        projectDir,
        env,
      )
      expect(initResult.exitCode).toBe(0)
      expect(initResult.stdout + initResult.stderr).not.toMatch(/Secret not found/)
    },
    CLI_CALL_TIMEOUT_MS * 2,
  )
})
