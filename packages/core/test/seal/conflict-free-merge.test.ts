/**
 * PRD R5 acceptance test (verbatim): "two branches from the same base each add
 * one tool + one seal; merging both produces zero conflicts and both verify."
 *
 * This exercises the file-per-seal storage against a REAL `git` merge in a temp
 * repository — the actual input contract the requirement is about — rather than
 * a hand-built approximation. Each branch seals a disjoint gate, so the two
 * seals land in disjoint files under `.attest-it/seals/` and never touch a
 * shared file.
 *
 * @see PRD Goal 4 — parallel proposal PRs merge without seal-storage conflicts.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { computeFingerprintSync } from '../../src/fingerprint.js'
import { createSeal, readSealsSync, writeSealsSync } from '../../src/seal/operations.js'
import { verifyGateSeal } from '../../src/seal/verification.js'
import type { AttestItConfig } from '../../src/types.js'
import { generateKeyPair } from '../../src/crypto/ed25519.js'

/** Run a git command in `cwd`, throwing on failure. */
function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
    },
  })
}

describe('conflict-free parallel seal merges (PRD R5)', () => {
  let repo: string
  const alice = generateKeyPair()
  const bob = generateKeyPair()

  /** In-memory config used only to verify seals against the merged tree. */
  const config: AttestItConfig = {
    version: 1,
    settings: {
      maxAgeDays: 3650,
      publicKeyPath: '.attest-it/pubkey.pem',
      attestationsPath: '.attest-it/attestations.json',
    },
    team: {
      alice: { name: 'Alice', publicKey: alice.publicKey },
      bob: { name: 'Bob', publicKey: bob.publicKey },
    },
    gates: {
      'tool-one': {
        name: 'Tool One',
        authorizedSigners: ['alice'],
        fingerprint: { paths: ['tools/one.sh'] },
        maxAge: '3650d',
      },
      'tool-two': {
        name: 'Tool Two',
        authorizedSigners: ['bob'],
        fingerprint: { paths: ['tools/two.sh'] },
        maxAge: '3650d',
      },
    },
    suites: {
      one: { gate: 'tool-one' },
      two: { gate: 'tool-two' },
    },
  }

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'attest-merge-'))
    git(repo, 'init', '-q', '-b', 'main')
    fs.mkdirSync(path.join(repo, 'tools'), { recursive: true })
    fs.writeFileSync(path.join(repo, 'README.md'), '# base\n', 'utf8')
    git(repo, 'add', '.')
    git(repo, 'commit', '-q', '-m', 'base')
  })

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true })
  })

  /**
   * On a branch: add a tool file, seal its gate, commit. Mirrors what a single
   * proposal PR does.
   */
  function addToolAndSeal(
    branch: string,
    toolRel: string,
    gateId: string,
    signer: 'alice' | 'bob',
    key: string,
  ): void {
    git(repo, 'checkout', '-q', '-b', branch, 'main')
    const toolAbs = path.join(repo, toolRel)
    fs.mkdirSync(path.dirname(toolAbs), { recursive: true })
    fs.writeFileSync(toolAbs, `#!/bin/sh\necho ${gateId}\n`, 'utf8')

    const fingerprint = computeFingerprintSync({ paths: [toolRel], baseDir: repo }).fingerprint
    const seals = readSealsSync(repo)
    seals.seals[gateId] = createSeal({ gateId, fingerprint, sealedBy: signer, privateKey: key })
    writeSealsSync(repo, seals)

    git(repo, 'add', '.')
    git(repo, 'commit', '-q', '-m', `add ${gateId}`)
  }

  it('two branches each add one tool + one seal; merge is conflict-free and both verify', () => {
    addToolAndSeal('feature-one', 'tools/one.sh', 'tool-one', 'alice', alice.privateKey)
    addToolAndSeal('feature-two', 'tools/two.sh', 'tool-two', 'bob', bob.privateKey)

    // Merge feature-two into feature-one. A seal-storage conflict would abort
    // the merge with a non-zero exit; execFileSync throws on that.
    git(repo, 'checkout', '-q', 'feature-one')
    expect(() => git(repo, 'merge', '--no-edit', 'feature-two')).not.toThrow()

    // No conflict markers / unmerged paths remain.
    const status = git(repo, 'status', '--porcelain')
    expect(status).not.toMatch(/^(UU|AA|DD|U|A|D)/m)

    // Both tool files exist in the merged working tree.
    expect(fs.existsSync(path.join(repo, 'tools', 'one.sh'))).toBe(true)
    expect(fs.existsSync(path.join(repo, 'tools', 'two.sh'))).toBe(true)

    // Both seals are present and independently verify against the merged tree.
    const merged = readSealsSync(repo)
    expect(Object.keys(merged.seals).sort()).toEqual(['tool-one', 'tool-two'])

    const fpOne = computeFingerprintSync({ paths: ['tools/one.sh'], baseDir: repo }).fingerprint
    const fpTwo = computeFingerprintSync({ paths: ['tools/two.sh'], baseDir: repo }).fingerprint

    expect(verifyGateSeal(config, 'tool-one', merged, fpOne).state).toBe('VALID')
    expect(verifyGateSeal(config, 'tool-two', merged, fpTwo).state).toBe('VALID')
  })

  it('the two seals live in disjoint files — no shared file is touched by either branch', () => {
    addToolAndSeal('feature-one', 'tools/one.sh', 'tool-one', 'alice', alice.privateKey)
    addToolAndSeal('feature-two', 'tools/two.sh', 'tool-two', 'bob', bob.privateKey)

    // The set of seal files introduced by each branch (relative to base) must be
    // disjoint — that is what guarantees a conflict-free merge.
    const filesOn = (branch: string): string[] => {
      git(repo, 'checkout', '-q', branch)
      return git(repo, 'ls-files', '.attest-it/seals')
        .split('\n')
        .filter((l) => l.length > 0)
        .sort()
    }
    const oneFiles = filesOn('feature-one')
    const twoFiles = filesOn('feature-two')

    expect(oneFiles).toHaveLength(1)
    expect(twoFiles).toHaveLength(1)
    expect(oneFiles[0]).not.toBe(twoFiles[0])
  })
})
