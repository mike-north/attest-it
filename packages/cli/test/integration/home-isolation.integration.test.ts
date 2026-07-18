/**
 * UAT / end-to-end regression coverage for issue #129: `ATTEST_IT_HOME` must
 * isolate *all* attest-it state -- including the VaultKeeper-backed encrypted
 * private key -- under the configured sandbox home.
 *
 * Before the fix, `ATTEST_IT_HOME` isolated only attest-it's own `config.yaml`
 * and public key; the encrypted `.enc` private-key blob still leaked to the
 * real, non-sandboxed `~/.config/vaultkeeper/file/` on every run. This test
 * drives the *real built CLI* as a subprocess (stdin closed, `< /dev/null`)
 * with only `ATTEST_IT_HOME` set -- deliberately NOT `VAULTKEEPER_CONFIG_DIR`,
 * so it proves the ATTEST_IT_HOME propagation alone isolates key material.
 *
 * It asserts, exactly as the issue's repro demands:
 *   - the encrypted `.enc` key lands UNDER the sandbox home, and
 *   - the real `~/.config/vaultkeeper/` gains NO new file (before/after diff).
 *
 * Against pre-fix code this fails: the `.enc` is absent from the sandbox and a
 * new file appears under the real VaultKeeper directory.
 *
 * @see https://github.com/mike-north/attest-it/issues/129
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as os from 'node:os'
import { parse as parseYaml } from 'yaml'
import {
  collectFilesRecursive,
  resolveRealVaultKeeperConfigDir,
} from '../setup/vaultkeeper-isolation-guard.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CLI_PATH = path.resolve(__dirname, '../../dist/bin/attest-it.js')
const CLI_CALL_TIMEOUT_MS = 15000

interface RunResult {
  exitCode: number
  stdout: string
  stderr: string
}

/**
 * Spawn the built CLI with a fully controlled environment. Unlike the shared
 * helpers in other integration files, this deliberately strips any inherited
 * `VAULTKEEPER_CONFIG_DIR` from the child env so the test exercises isolation
 * driven by `ATTEST_IT_HOME` alone (the whole point of issue #129).
 */
function runCli(args: string[], cwd: string, extraEnv: Record<string, string>): Promise<RunResult> {
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1', ...extraEnv }
  delete env.VAULTKEEPER_CONFIG_DIR
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      cwd,
      env,
      // stdin closed == `< /dev/null`: a fall-through to an interactive prompt
      // would hang until the timeout kills it, failing loudly.
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(
        new Error(
          `CLI did not exit within ${String(CLI_CALL_TIMEOUT_MS)}ms (hung on a prompt?): ` +
            `attest-it ${args.join(' ')}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
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

/** Read the VaultKeeper `privateKey.id` attest-it recorded for `slug`. */
function readPrivateKeyId(homeDir: string, slug: string): string {
  const parsed: unknown = parseYaml(fs.readFileSync(path.join(homeDir, 'config.yaml'), 'utf8'))
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('identities' in parsed) ||
    typeof (parsed as { identities: unknown }).identities !== 'object'
  ) {
    throw new Error('Expected local config to contain an identities map')
  }
  const identities = (parsed as { identities: Record<string, unknown> }).identities
  const identity = identities[slug]
  if (
    typeof identity !== 'object' ||
    identity === null ||
    !('privateKey' in identity) ||
    typeof (identity as { privateKey: unknown }).privateKey !== 'object'
  ) {
    throw new Error(`Expected identity "${slug}" to have a privateKey object`)
  }
  const privateKey = (identity as { privateKey: Record<string, unknown> }).privateKey
  if (typeof privateKey.id !== 'string') {
    throw new Error(`Expected identity "${slug}" to have a string privateKey.id`)
  }
  return privateKey.id
}

/**
 * VaultKeeper `file`-backend secret path: `<configDir>/file/<hex(id)>.enc`
 * (mirrors `getEntryPath` in vaultkeeper's file backend).
 */
function encPathFor(vaultKeeperConfigDir: string, secretId: string): string {
  return path.join(
    vaultKeeperConfigDir,
    'file',
    `${Buffer.from(secretId, 'utf8').toString('hex')}.enc`,
  )
}

describe('ATTEST_IT_HOME isolates VaultKeeper key material (issue #129)', () => {
  let homeDir: string
  let projectDir: string

  beforeEach(async () => {
    homeDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'attest-it-129-home-'))
    projectDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'attest-it-129-proj-'))
  })

  afterEach(async () => {
    await fs.promises.rm(homeDir, { recursive: true, force: true })
    await fs.promises.rm(projectDir, { recursive: true, force: true })
  })

  it('writes the encrypted .enc key under the sandbox home and leaks nothing to the real ~/.config/vaultkeeper', async () => {
    const realVkDir = resolveRealVaultKeeperConfigDir()
    const before = collectFilesRecursive(realVkDir)

    const result = await runCli(
      ['identity', 'create', '--name', 'Isolation Test', '--slug', 'iso', '--storage', 'file'],
      projectDir,
      { ATTEST_IT_HOME: homeDir },
    )

    expect(result.exitCode, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(0)

    // 1. The encrypted key lands UNDER the sandbox home (in the namespaced
    //    vaultkeeper subdir), not the real VaultKeeper directory.
    const secretId = readPrivateKeyId(homeDir, 'iso')
    const sandboxEnc = encPathFor(path.join(homeDir, 'vaultkeeper'), secretId)
    expect(fs.existsSync(sandboxEnc), `expected encrypted key at ${sandboxEnc}`).toBe(true)

    // 2. The real ~/.config/vaultkeeper gained NO new file.
    const after = collectFilesRecursive(realVkDir)
    const beforeSet = new Set(before)
    const leaked = after.filter((f) => !beforeSet.has(f))
    expect(leaked, `leaked key/config files to real VaultKeeper dir: ${leaked.join(', ')}`).toEqual(
      [],
    )

    // 3. Belt-and-suspenders: nothing at all under the sandbox home escapes it.
    expect(sandboxEnc.startsWith(homeDir)).toBe(true)
  })

  it('writes a real PEM public key (with BEGIN/END markers) under the sandbox home', async () => {
    const result = await runCli(
      ['identity', 'create', '--name', 'Pem Test', '--slug', 'pem', '--storage', 'file'],
      projectDir,
      { ATTEST_IT_HOME: homeDir },
    )
    expect(result.exitCode, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(0)

    const pemPath = path.join(homeDir, 'public-keys', 'pem.pem')
    expect(fs.existsSync(pemPath)).toBe(true)
    const pem = fs.readFileSync(pemPath, 'utf8')
    expect(pem).toContain('-----BEGIN PUBLIC KEY-----')
    expect(pem).toContain('-----END PUBLIC KEY-----')
  })

  it('does not print the 1Password/Keychain provider-prompt banner under --storage file', async () => {
    const result = await runCli(
      ['identity', 'create', '--name', 'Banner Test', '--slug', 'banner', '--storage', 'file'],
      projectDir,
      { ATTEST_IT_HOME: homeDir },
    )
    expect(result.exitCode, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(0)

    const combined = result.stdout + result.stderr
    expect(combined).not.toContain('authentication prompts from 1Password')
    expect(combined).not.toContain('Checking available key storage providers')
  })
})
