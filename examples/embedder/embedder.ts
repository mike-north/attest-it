/**
 * Runnable sample embedder for the attest-it embeddable API.
 *
 * This is the human-facing counterpart to the CI integration test at
 * `packages/core/test/integration/embedder.test.ts`. It scaffolds a throwaway
 * project in a temp directory, then drives the embeddable surface exactly as an
 * embedder (e.g. Toolsmith) would — list -> seal -> verify — printing each
 * structured result as JSON. It runs with zero terminal interaction: the
 * identity here is backed by a filesystem key whose "unlock" is a no-op. A
 * hardware backend (YubiKey, etc.) would surface its own unlock prompt at the
 * seal step and nowhere else.
 *
 * Run it (after `pnpm build`):
 *
 *   pnpm exec tsx examples/embedder/embedder.ts
 *
 * @see PRD R3 — the programmatic surface and its versioned failure taxonomy.
 * @see docs/embedding.md — the reference documentation for this API.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  generateEd25519KeyPair,
  setAttestItHomeDir,
  saveLocalConfigSync,
  listGates,
  seal,
  verifyOne,
  type LocalConfig,
} from '@attest-it/core'

/** Scaffold a throwaway attest-it project and a filesystem-backed identity. */
function scaffold(): { baseDir: string; homeDir: string; gatedFile: string } {
  const baseDir = mkdtempSync(join(tmpdir(), 'attest-it-embedder-'))
  const homeDir = mkdtempSync(join(tmpdir(), 'attest-it-embedder-home-'))

  const { publicKey, privateKey } = generateEd25519KeyPair()
  const keyPath = join(homeDir, 'signing-key.pem')
  writeFileSync(keyPath, privateKey, 'utf8')

  const gatedFile = 'src/tool.ts'
  mkdirSync(join(baseDir, 'src'), { recursive: true })
  writeFileSync(join(baseDir, gatedFile), 'export const answer = 42\n', 'utf8')

  // Split config as JSON (policy.json + config.json are both accepted), so this
  // script needs no YAML dependency.
  mkdirSync(join(baseDir, '.attest-it'), { recursive: true })
  const policy = {
    version: 1,
    team: { alice: { name: 'Alice', publicKey } },
    gates: {
      tools: {
        name: 'Tools',
        description: 'Forged tool scripts',
        authorizedSigners: ['alice'],
        fingerprint: { paths: ['src/**'] },
        maxAge: '30d',
      },
    },
  }
  const operational = { version: 1, suites: { build: { gate: 'tools' } } }
  writeFileSync(join(baseDir, '.attest-it', 'policy.json'), JSON.stringify(policy, null, 2), 'utf8')
  writeFileSync(
    join(baseDir, '.attest-it', 'config.json'),
    JSON.stringify(operational, null, 2),
    'utf8',
  )

  setAttestItHomeDir(homeDir)
  const localConfig: LocalConfig = {
    version: 1,
    activeIdentity: 'alice',
    identities: {
      alice: { name: 'Alice', publicKey, privateKey: { type: 'file', path: keyPath } },
    },
  }
  saveLocalConfigSync(localConfig)

  return { baseDir, homeDir, gatedFile }
}

async function main(): Promise<void> {
  const { baseDir, homeDir, gatedFile } = scaffold()
  const opts = { baseDir }

  try {
    // 1. List gates / artifacts to review.
    const gates = await listGates(opts)
    console.log('listGates:', JSON.stringify(gates, null, 2))

    // 2. Seal the artifact as the active identity (backend unlock happens here).
    const sealed = await seal(gatedFile, { identity: 'alice' }, opts)
    console.log('seal:', JSON.stringify(sealed, null, 2))

    // 3. Verify the now-sealed artifact.
    const verified = await verifyOne(gatedFile, opts)
    console.log('verifyOne:', JSON.stringify(verified, null, 2))

    if (!verified.ok) {
      throw new Error(`Verification failed: ${verified.failureClass}`)
    }
    console.log('\nEmbedder cycle complete: list -> seal -> verify all succeeded.')
  } finally {
    setAttestItHomeDir(null)
    rmSync(baseDir, { recursive: true, force: true })
    rmSync(homeDir, { recursive: true, force: true })
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
