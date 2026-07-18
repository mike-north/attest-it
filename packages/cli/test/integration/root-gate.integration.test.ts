/**
 * End-to-end integration tests for the sealed root gate over policy.yaml (#72).
 *
 * These drive the real, built `attest-it` binary against fixture repositories
 * with tampered and well-formed `.attest-it/policy.yaml`, proving the PRD R1
 * acceptance criteria at the user-facing (CLI) layer:
 *   - adversarial: an untrusted policy change fails `verify`, naming the change
 *   - positive: a root-signer-sealed policy change verifies and gates evaluate
 *   - bootstrap: a fresh repo reaches trusted state in one human-run ceremony
 *
 * @see Issue #72 acceptance criteria
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as os from 'node:os'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import {
  createSeal,
  createRootSeal,
  computePolicyFingerprintSync,
  generateEd25519KeyPair,
  readSealsSync,
  verifyRootGate,
  ROOT_GATE_ID,
  type AttestItConfig,
  type SealsFile,
} from '@attest-it/core'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CLI_PATH = path.resolve(__dirname, '../../dist/bin/attest-it.js')
const FIXTURE_PATH = path.resolve(__dirname, '../fixtures/sample-project')
const CLI_TIMEOUT_MS = 15000
// Each test spawns several real CLI subprocesses in sequence (identity create,
// init/bootstrap, seal, verify, …). vitest's 5s default is far too tight for
// that on a cold CI runner, so give the whole suite a generous per-test budget.
const TEST_TIMEOUT_MS = 90000
vi.setConfig({ testTimeout: TEST_TIMEOUT_MS, hookTimeout: TEST_TIMEOUT_MS })

interface RunResult {
  exitCode: number
  stdout: string
  stderr: string
}

function runCli(args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      cwd,
      env: { ...process.env, NO_COLOR: '1', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (c: Buffer) => (stdout += c.toString()))
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString()))
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`CLI did not exit in ${String(CLI_TIMEOUT_MS)}ms: ${args.join(' ')}`))
    }, CLI_TIMEOUT_MS)
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
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`git ${args.join(' ')} -> ${String(code)}`)),
    )
    child.on('error', reject)
  })
}

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.promises.mkdir(dest, { recursive: true })
  for (const entry of await fs.promises.readdir(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name)
    const d = path.join(dest, entry.name)
    if (entry.isDirectory()) await copyDir(s, d)
    else await fs.promises.copyFile(s, d)
  }
}

/** Read, mutate, and write the policy.yaml at `<dir>/.attest-it/policy.yaml`. */
function editPolicy(dir: string, mutate: (policy: Record<string, unknown>) => void): void {
  const policyPath = path.join(dir, '.attest-it', 'policy.yaml')
  const policy = parseYaml(fs.readFileSync(policyPath, 'utf8')) as Record<string, unknown>
  mutate(policy)
  fs.writeFileSync(policyPath, stringifyYaml(policy), 'utf8')
}

function writeSeals(dir: string, seals: SealsFile): void {
  fs.writeFileSync(
    path.join(dir, '.attest-it', 'seals.json'),
    JSON.stringify(seals, null, 2),
    'utf8',
  )
}

describe('root gate — CLI verify against tampered/valid policy.yaml (#72)', () => {
  let dir: string
  let ownerPrivateKey: string
  let ownerPublicKey: string

  beforeEach(async () => {
    dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'attest-rootgate-'))
    await copyDir(FIXTURE_PATH, dir)

    const kp = generateEd25519KeyPair()
    ownerPrivateKey = kp.privateKey
    ownerPublicKey = kp.publicKey

    // Anchor the fixture: give the owner a real key, add a rootGate, and seal the
    // policy + the example gate. This is the bootstrapped, trusted starting state.
    editPolicy(dir, (policy) => {
      policy.rootGate = { authorizedSigners: ['test-user'] }
      const team = policy.team as Record<string, { publicKey: string }>
      team['test-user'].publicKey = ownerPublicKey
    })

    await runGit(['init'], dir)
    await runGit(['config', 'user.email', 'test@example.com'], dir)
    await runGit(['config', 'user.name', 'Test User'], dir)
    await runGit(['add', '.'], dir)
    await runGit(['commit', '-m', 'anchor policy'], dir)
  })

  afterEach(async () => {
    await fs.promises.rm(dir, { recursive: true, force: true })
  })

  /** Anchor the current on-disk policy by writing a valid root seal over it. */
  function sealRoot(): void {
    const policyPath = path.join(dir, '.attest-it', 'policy.yaml')
    const rootSeal = createRootSeal({
      policyFingerprint: computePolicyFingerprintSync(dir, policyPath),
      sealedBy: 'test-user',
      privateKey: ownerPrivateKey,
    })
    writeSeals(dir, { version: 1, seals: { [ROOT_GATE_ID]: rootSeal } })
  }

  it('POSITIVE: a policy sealed by a genuine root signer verifies, and gates evaluate against it', async () => {
    // Seal the current (well-formed) policy as the root gate.
    const policyPath = path.join(dir, '.attest-it', 'policy.yaml')
    const rootSeal = createRootSeal({
      policyFingerprint: computePolicyFingerprintSync(dir, policyPath),
      sealedBy: 'test-user',
      privateKey: ownerPrivateKey,
    })

    // Also seal the example gate so it evaluates VALID once the root is trusted.
    const statusJson = await runCli(['status', 'example-gate', '--json'], dir)
    const status = JSON.parse(statusJson.stdout) as { currentFingerprint: string }[]
    const gateFingerprint = status[0]!.currentFingerprint
    const gateSeal = createSeal({
      gateId: 'example-gate',
      fingerprint: gateFingerprint,
      sealedBy: 'test-user',
      privateKey: ownerPrivateKey,
    })
    writeSeals(dir, { version: 1, seals: { [ROOT_GATE_ID]: rootSeal, 'example-gate': gateSeal } })
    await runGit(['add', '.'], dir)
    await runGit(['commit', '-m', 'seal root + gate'], dir)

    const result = await runCli(['verify', 'example-gate'], dir)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('VALID')
    // The root pre-step did not report an untrusted policy.
    expect(result.stdout).not.toContain('Untrusted')
    expect(result.stderr).not.toContain('Untrusted')
  })

  it('ADVERSARIAL 1: adding a key to team and authorizing it, without a root re-seal, fails verify and names the untrusted change', async () => {
    // Anchor the ORIGINAL policy.
    sealRoot()
    await runGit(['add', '.'], dir)
    await runGit(['commit', '-m', 'anchor'], dir)

    // Attacker adds a new team member + authorizes them on the example gate.
    const attacker = generateEd25519KeyPair()
    editPolicy(dir, (policy) => {
      const team = policy.team as Record<string, unknown>
      team.mallory = { name: 'Mallory', publicKey: attacker.publicKey }
      const gates = policy.gates as Record<string, { authorizedSigners: string[] }>
      gates['example-gate'].authorizedSigners.push('mallory')
    })
    await runGit(['add', '.'], dir)
    await runGit(['commit', '-m', 'tamper: add mallory'], dir)

    const result = await runCli(['verify', 'example-gate'], dir)
    expect(result.exitCode).toBe(1)
    const combined = result.stdout + result.stderr
    // Not a generic failure: it names the untrusted policy change.
    expect(combined).toContain('.attest-it/policy.yaml')
    expect(combined.toLowerCase()).toContain('root signer')
  })

  it('ADVERSARIAL 2: modifying an existing gate authorizedSigners without a root re-seal fails verify', async () => {
    sealRoot()
    await runGit(['add', '.'], dir)
    await runGit(['commit', '-m', 'anchor'], dir)

    // Change an existing gate's authorized signer set to a different (valid)
    // team member. The config still validates — only the root pre-step catches
    // that the trust-critical policy changed without a root re-seal.
    editPolicy(dir, (policy) => {
      const team = policy.team as Record<string, unknown>
      team.reviewer = { name: 'Reviewer', publicKey: generateEd25519KeyPair().publicKey }
      const gates = policy.gates as Record<string, { authorizedSigners: string[] }>
      gates['example-gate'].authorizedSigners = ['reviewer']
    })
    await runGit(['add', '.'], dir)
    await runGit(['commit', '-m', 'tamper: swap signer'], dir)

    const result = await runCli(['verify', 'example-gate'], dir)
    expect(result.exitCode).toBe(1)
    expect(result.stdout + result.stderr).toContain('.attest-it/policy.yaml')
  })

  it('POSITIVE follow-up: after a root signer re-seals the changed policy, verify passes again', async () => {
    // Legitimately add a member, then RE-SEAL the root over the new content.
    const dev = generateEd25519KeyPair()
    editPolicy(dir, (policy) => {
      const team = policy.team as Record<string, unknown>
      team.dev = { name: 'Dev', publicKey: dev.publicKey }
    })
    const policyPath = path.join(dir, '.attest-it', 'policy.yaml')
    const rootSeal = createRootSeal({
      policyFingerprint: computePolicyFingerprintSync(dir, policyPath),
      sealedBy: 'test-user',
      privateKey: ownerPrivateKey,
    })
    const statusJson = await runCli(['status', 'example-gate', '--json'], dir)
    const gateFp = (JSON.parse(statusJson.stdout) as { currentFingerprint: string }[])[0]!
      .currentFingerprint
    const gateSeal = createSeal({
      gateId: 'example-gate',
      fingerprint: gateFp,
      sealedBy: 'test-user',
      privateKey: ownerPrivateKey,
    })
    writeSeals(dir, { version: 1, seals: { [ROOT_GATE_ID]: rootSeal, 'example-gate': gateSeal } })
    await runGit(['add', '.'], dir)
    await runGit(['commit', '-m', 're-seal after change'], dir)

    const result = await runCli(['verify', 'example-gate'], dir)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('VALID')
  })

  it('SCENARIO B — BY DESIGN: a self-rewritten + self-resealed rootGate PASSES plain local verify, while the base-branch trust model (the Action) rejects it', async () => {
    // This test documents a DELIBERATE design boundary, not a vulnerability.
    //
    // Local `attest-it verify` evaluates against the WORKING TREE's policy. If a
    // branch rewrites `rootGate.authorizedSigners` to a key it controls and
    // re-seals the policy with that key, local verify trusts that local anchor and
    // reports VALID — by design. Local verify is a fast pre-check, not the trust
    // boundary (see the command docblock and docs/threat-model.md).
    //
    // The trust boundary is the merge gate: the GitHub Action sources
    // `rootGate`/`team`/`gates` from the BASE branch, so the same self-rewritten
    // anchor is rejected as UNKNOWN_SIGNER. We assert BOTH halves so the
    // intended/observed split is explicit and regression-guarded.
    const mallory = generateEd25519KeyPair()

    // Attacker rewrites the local policy: root signer -> mallory, and authorizes
    // mallory on the example gate too.
    editPolicy(dir, (policy) => {
      policy.rootGate = { authorizedSigners: ['mallory'] }
      const team = policy.team as Record<string, unknown>
      team.mallory = { name: 'Mallory', publicKey: mallory.publicKey }
      const gates = policy.gates as Record<string, { authorizedSigners: string[] }>
      gates['example-gate'].authorizedSigners = ['mallory']
    })

    // Re-seal BOTH the root gate and the example gate with mallory's own key over
    // the new local policy content.
    const policyPath = path.join(dir, '.attest-it', 'policy.yaml')
    const policyFingerprint = computePolicyFingerprintSync(dir, policyPath)
    const rootSeal = createRootSeal({
      policyFingerprint,
      sealedBy: 'mallory',
      privateKey: mallory.privateKey,
    })
    const statusJson = await runCli(['status', 'example-gate', '--json'], dir)
    const gateFp = (JSON.parse(statusJson.stdout) as { currentFingerprint: string }[])[0]!
      .currentFingerprint
    const gateSeal = createSeal({
      gateId: 'example-gate',
      fingerprint: gateFp,
      sealedBy: 'mallory',
      privateKey: mallory.privateKey,
    })
    writeSeals(dir, { version: 1, seals: { [ROOT_GATE_ID]: rootSeal, 'example-gate': gateSeal } })
    await runGit(['add', '.'], dir)
    await runGit(['commit', '-m', 'self-rewrite + self-reseal root of trust'], dir)

    // OBSERVED, BY DESIGN: local verify trusts the local anchor -> PASSES.
    const local = await runCli(['verify', 'example-gate'], dir)
    expect(local.exitCode).toBe(0)
    expect(local.stdout).toContain('VALID')

    // INTENDED BOUNDARY: the merge gate (the Action) verifies the SAME working-tree
    // root seal against the TRUSTED base-branch config, whose rootGate/team still
    // list only the original owner ('test-user'). Mallory is not a base-branch root
    // signer, so it is rejected as UNKNOWN_SIGNER.
    const baseConfig: AttestItConfig = {
      version: 1,
      settings: {
        maxAgeDays: 30,
        publicKeyPath: '.attest-it/pubkey.pem',
        attestationsPath: '.attest-it/attestations.json',
        sealsPath: '.attest-it/seals.json',
      },
      rootGate: { authorizedSigners: ['test-user'], maxAge: '365d' },
      team: { 'test-user': { name: 'Test User', publicKey: ownerPublicKey } },
      suites: {},
    }
    const baseResult = verifyRootGate({
      config: baseConfig,
      policyFingerprint,
      seals: { version: 1, seals: { [ROOT_GATE_ID]: rootSeal } },
    })
    expect(baseResult.state).toBe('UNKNOWN_SIGNER')
  })
})

describe('root gate — bootstrap ceremony reaches trusted state in one human-run step (#72)', () => {
  let projectDir: string
  let homeDir: string

  beforeEach(async () => {
    projectDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'attest-bootstrap-'))
    homeDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'attest-bootstrap-home-'))
    await fs.promises.mkdir(path.join(projectDir, 'src'), { recursive: true })
    await fs.promises.writeFile(path.join(projectDir, 'src', 'index.ts'), 'export const x = 1\n')
    await runGit(['init'], projectDir)
    await runGit(['config', 'user.email', 'test@example.com'], projectDir)
    await runGit(['config', 'user.name', 'Test User'], projectDir)
    await runGit(['add', '.'], projectDir)
    await runGit(['commit', '-m', 'initial'], projectDir)
  })

  afterEach(async () => {
    await fs.promises.rm(projectDir, { recursive: true, force: true })
    await fs.promises.rm(homeDir, { recursive: true, force: true })
  })

  it('identity create -> init --root-signer establishes the trust anchor; tampering it then fails verify', async () => {
    // VAULTKEEPER_CONFIG_DIR is redirected to the isolated per-test home so the
    // `identity create --storage file` step below never writes to the real
    // VaultKeeper config dir (issue #114 test-isolation guard).
    const env = { ATTEST_IT_HOME: homeDir, VAULTKEEPER_CONFIG_DIR: homeDir }

    const create = await runCli(
      ['identity', 'create', '--name', 'Test User', '--slug', 'test-user', '--storage', 'file'],
      projectDir,
      env,
    )
    expect(create.exitCode).toBe(0)

    // THE single ceremony step: scaffold config, establish the root signer, and
    // seal policy.yaml — all in one invocation.
    const bootstrap = await runCli(['init', '--root-signer', 'test-user'], projectDir, env)
    expect(bootstrap.exitCode).toBe(0)
    expect(bootstrap.stdout).toContain('Trust anchor established')

    // The repo is now trust-anchored: rootGate recorded + root seal present.
    const policy = parseYaml(
      fs.readFileSync(path.join(projectDir, '.attest-it', 'policy.yaml'), 'utf8'),
    ) as { rootGate?: { authorizedSigners: string[] } }
    expect(policy.rootGate?.authorizedSigners).toEqual(['test-user'])

    // The root seal is hosted in the file-per-seal layout under a reserved
    // `__root__` gate directory; read it back through the public aggregate API.
    const seals = readSealsSync(projectDir)
    expect(seals.seals[ROOT_GATE_ID]).toBeDefined()

    // Add a gate + suite so there is real work to verify, then re-anchor the
    // (now-changed) policy with `attest-it seal --root` and seal the gate.
    editPolicy(projectDir, (p) => {
      const gates = (p.gates ?? {}) as Record<string, unknown>
      gates['src-gate'] = {
        name: 'Source Gate',
        description: 'Source files',
        authorizedSigners: ['test-user'],
        fingerprint: { paths: ['src'] },
        maxAge: '30d',
      }
      p.gates = gates
    })
    const configPath = path.join(projectDir, '.attest-it', 'config.yaml')
    const opConfig = parseYaml(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>
    opConfig.suites = { src: { gate: 'src-gate', command: 'echo ok' } }
    fs.writeFileSync(configPath, stringifyYaml(opConfig), 'utf8')

    const reSealRoot = await runCli(['seal', '--root'], projectDir, env)
    expect(reSealRoot.exitCode).toBe(0)
    expect(reSealRoot.stdout).toContain('Root gate sealed')

    const sealGate = await runCli(['seal', 'src-gate'], projectDir, env)
    expect(sealGate.exitCode).toBe(0)

    // The anchor is live and the gate evaluates against the trusted policy.
    const verifyOk = await runCli(['verify', 'src-gate'], projectDir, env)
    expect(verifyOk.exitCode).toBe(0)
    expect(verifyOk.stdout).toContain('VALID')
    expect(verifyOk.stdout + verifyOk.stderr).not.toContain('Untrusted')

    // Tampering the anchored policy makes verify fail closed, naming the change.
    editPolicy(projectDir, (p) => {
      const team = (p.team ?? {}) as Record<string, unknown>
      team.intruder = { name: 'Intruder', publicKey: generateEd25519KeyPair().publicKey }
      p.team = team
    })
    const verifyTampered = await runCli(['verify', 'src-gate'], projectDir, env)
    expect(verifyTampered.exitCode).toBe(1)
    expect(verifyTampered.stdout + verifyTampered.stderr).toContain('.attest-it/policy.yaml')
  })
})
