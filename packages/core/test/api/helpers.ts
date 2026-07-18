/**
 * Shared setup for the embeddable-API tests.
 *
 * Each helper scaffolds a real, self-contained attest-it project in a temp
 * directory — split policy + operational config, a gated source file, and a
 * local identity backed by a filesystem Ed25519 key — so tests exercise the
 * genuine load → fingerprint → seal → verify path rather than mocks.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stringify as stringifyYaml } from 'yaml'
import { generateKeyPair } from '../../src/crypto/ed25519.js'
import { setAttestItHomeDir, saveLocalConfigSync } from '../../src/identity/index.js'
import type { LocalConfig } from '../../src/identity/index.js'

/**
 * A scaffolded attest-it project for embeddable-API tests.
 */
export interface TestProject {
  /** Repository root the API is pointed at via `{ baseDir }`. */
  baseDir: string
  /** attest-it home holding the local identity config. */
  homeDir: string
  /** Relative path (from `baseDir`) of the gated source file. */
  gatedFile: string
  /** Gate id that governs {@link gatedFile}. */
  gateId: string
  /** Base64 Ed25519 public key of the authorized identity `alice`. */
  alicePublicKey: string
  /** PEM-encoded Ed25519 private key for `alice`. */
  alicePrivateKeyPem: string
  /** The seals file path (relative to `baseDir`) used by this project. */
  sealsPath: string
  /** Remove all temp state and reset the attest-it home override. */
  cleanup: () => void
}

/**
 * Options for {@link createTestProject}.
 */
export interface CreateTestProjectOptions {
  /** Signers authorized on the gate. Defaults to `['alice']`. */
  authorizedSigners?: string[]
  /**
   * Gate kind. Defaults to `single` (omitted from config). When `pattern`, the
   * gate seals each matched file independently.
   */
  kind?: 'single' | 'pattern'
  /**
   * Glob paths the gate fingerprints. Defaults to `['src/**']`. Pattern-gate
   * tests typically pass something like `['tools/*.sh']`.
   */
  gatePaths?: string[]
  /**
   * Gate `maxAge`. Defaults to `'30d'`. Pass `null` to omit `maxAge` entirely
   * (an indefinite gate that never expires).
   */
  maxAge?: string | null
  /**
   * Extra files to create under `baseDir` before the gate is evaluated, as a map
   * of repo-relative path → content. Used to populate a pattern gate's matches.
   */
  files?: Record<string, string>
  /**
   * Scaffold the operational config with an empty `suites: {}` map (the shape
   * `init` writes). Exercises the gate-only / read-only flows that must load
   * cleanly without any suite defined (issue #137). Defaults to `false` (a
   * single `build` suite referencing the gate).
   */
  emptySuites?: boolean
}

/**
 * Scaffold a temp attest-it project and point the attest-it home at a temp dir
 * holding a local identity config with two identities: `alice` (authorized by
 * default) and `mallory` (never authorized).
 */
export function createTestProject(options: CreateTestProjectOptions = {}): TestProject {
  const authorizedSigners = options.authorizedSigners ?? ['alice']
  const gatePaths = options.gatePaths ?? ['src/**']
  const baseDir = mkdtempSync(join(tmpdir(), 'attest-it-api-base-'))
  const homeDir = mkdtempSync(join(tmpdir(), 'attest-it-api-home-'))

  const alice = generateKeyPair()
  const mallory = generateKeyPair()

  const aliceKeyPath = join(homeDir, 'alice.pem')
  const malloryKeyPath = join(homeDir, 'mallory.pem')
  writeFileSync(aliceKeyPath, alice.privateKey, 'utf8')
  writeFileSync(malloryKeyPath, mallory.privateKey, 'utf8')

  // Gated source file.
  const gatedFile = 'src/lib/tool.ts'
  mkdirSync(join(baseDir, 'src', 'lib'), { recursive: true })
  writeFileSync(join(baseDir, gatedFile), 'export const tool = () => 42\n', 'utf8')

  // Any extra files (e.g. a pattern gate's matched artifacts).
  for (const [relPath, content] of Object.entries(options.files ?? {})) {
    const abs = join(baseDir, relPath)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, content, 'utf8')
  }

  // Split config: policy (trust) + operational (suites).
  const gateId = 'tools'
  const gateConfig: Record<string, unknown> = {
    name: 'Tools',
    description: 'Forged tool scripts',
    ...(options.kind !== undefined && { kind: options.kind }),
    authorizedSigners,
    fingerprint: { paths: gatePaths },
    ...(options.maxAge !== null && { maxAge: options.maxAge ?? '30d' }),
  }
  const policy = {
    version: 1,
    team: {
      alice: { name: 'Alice Developer', publicKey: alice.publicKey },
    },
    gates: {
      [gateId]: gateConfig,
    },
  }
  const operational = {
    version: 1,
    suites: options.emptySuites ? {} : { build: { gate: gateId } },
  }
  mkdirSync(join(baseDir, '.attest-it'), { recursive: true })
  writeFileSync(join(baseDir, '.attest-it', 'policy.yaml'), stringifyYaml(policy), 'utf8')
  writeFileSync(join(baseDir, '.attest-it', 'config.yaml'), stringifyYaml(operational), 'utf8')

  // Local identity config lives under the attest-it home. Both identities use
  // the v2 `filesystem` (legacy) key ref: the private key is a real PEM on disk
  // read directly by the legacy filesystem provider, no VaultKeeper import
  // required. This mirrors how a migrated v1 identity is served.
  setAttestItHomeDir(homeDir)
  const localConfig: LocalConfig = {
    version: 2,
    activeIdentity: 'alice',
    identities: {
      alice: {
        name: 'Alice Developer',
        publicKey: alice.publicKey,
        privateKey: { type: 'filesystem', path: aliceKeyPath },
      },
      mallory: {
        name: 'Mallory',
        publicKey: mallory.publicKey,
        privateKey: { type: 'filesystem', path: malloryKeyPath },
      },
    },
  }
  saveLocalConfigSync(localConfig)

  return {
    baseDir,
    homeDir,
    gatedFile,
    gateId,
    alicePublicKey: alice.publicKey,
    alicePrivateKeyPem: alice.privateKey,
    // Policy default (see policy-graph settings): seals live at seals.json.
    sealsPath: '.attest-it/seals.json',
    cleanup: () => {
      setAttestItHomeDir(null)
      rmSync(baseDir, { recursive: true, force: true })
      rmSync(homeDir, { recursive: true, force: true })
    },
  }
}
