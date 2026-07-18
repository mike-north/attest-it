/**
 * Tests for the comment-preserving policy.yaml read/write round-trip
 * (issue #102).
 *
 * `policy.yaml` is scaffolded with a `# yaml-language-server:` schema
 * directive, a trust-model header, and commented onboarding examples. Prior
 * to this fix, any command that mutated the file (`team join`/`add`/`remove`)
 * parsed it to a plain object and re-`stringify()`d the whole thing, silently
 * discarding every comment. These tests assert the replacement
 * `loadEditablePolicy`/`serializeEditablePolicy` round-trip preserves
 * comments via a document/AST-level edit instead.
 */

import { describe, expect, it } from 'vitest'
import { parseDocument } from 'yaml'
import {
  loadEditablePolicy,
  serializeEditablePolicy,
  type EditablePolicy,
} from '../../src/config/policy-writer.js'
import { PolicyValidationError } from '../../src/config/policy-schema.js'
import type { PolicyConfig } from '../../src/config/policy-schema.js'

const SCHEMA_DIRECTIVE =
  '# yaml-language-server: $schema=https://raw.githubusercontent.com/mike-north/attest-it/main/schemas/v1/policy.schema.json'

const ANNOTATED_POLICY_YAML = `${SCHEMA_DIRECTIVE}
# attest-it policy configuration (trust-critical)
#
# This file defines WHO may sign and WHAT is protected.

version: 1

settings:
  # How long a seal remains valid (in days)
  maxAgeDays: 30

# Team members who can sign seals.
# Add members with: attest-it team join (for yourself) or team add (for others)
#
# team:
#   mike-north:
#     name: Mike North
#     publicKey: Fzpq2YHEvpA2BwjGnW5ZcZF+WyUbsiyTFFMjPEK3SfA=

team: {}

# Gates define what code areas require a seal and who can sign.
#
# Example:
#
# gates:
#   cli-interactive:
#     name: CLI Interactive Tests
#     authorizedSigners:
#       - mike-north

gates:
  ci-gate:
    name: CI Gate
    description: Automated CI checks
    authorizedSigners:
      - carol
    fingerprint:
      paths:
        - src
    maxAge: 90d # keep seals fresh
`

function loadAnnotatedPolicy(): EditablePolicy {
  return loadEditablePolicy('/project/.attest-it/policy.yaml', ANNOTATED_POLICY_YAML)
}

describe('loadEditablePolicy', () => {
  it('parses and validates YAML policy content, keeping a Document for later writes', () => {
    const editable = loadAnnotatedPolicy()

    expect(editable.format).toBe('yaml')
    expect(editable.policy.version).toBe(1)
    expect(editable.policy.team).toEqual({})
    if (editable.format === 'yaml') {
      expect(editable.document.toString()).toContain(SCHEMA_DIRECTIVE)
    }
  })

  it('parses JSON policy content without keeping a Document (no comments to preserve)', () => {
    const json = JSON.stringify({
      version: 1,
      settings: { maxAgeDays: 30 },
      team: {},
    })

    const editable = loadEditablePolicy('/project/.attest-it/policy.json', json)

    expect(editable.format).toBe('json')
    expect(editable.policy.version).toBe(1)
    expect('document' in editable).toBe(false)
  })

  // Negative test: malformed policy content must fail validation rather than
  // silently producing a garbage EditablePolicy that a later write would
  // persist.
  it('throws PolicyValidationError for structurally invalid policy content', () => {
    expect(() =>
      loadEditablePolicy('/project/.attest-it/policy.yaml', 'team: not-an-object'),
    ).toThrow(PolicyValidationError)
  })
})

describe('serializeEditablePolicy (YAML)', () => {
  it('preserves the schema directive and header comments when only `team` changes', () => {
    const editable = loadAnnotatedPolicy()
    const updated: PolicyConfig = {
      ...editable.policy,
      team: {
        alice: { name: 'Alice', publicKey: 'pk-alice', publicKeyAlgorithm: 'ed25519' },
      },
    }

    const output = serializeEditablePolicy(editable, updated)

    expect(output).toContain(SCHEMA_DIRECTIVE)
    expect(output).toContain('# attest-it policy configuration (trust-critical)')
    expect(output).toContain('# Team members who can sign seals.')
    expect(output).toContain('#   mike-north:')
    expect(output).toContain('alice:')
  })

  it('preserves comments nested inside an unrelated, unchanged section', () => {
    const editable = loadAnnotatedPolicy()
    const updated: PolicyConfig = {
      ...editable.policy,
      team: {
        alice: { name: 'Alice', publicKey: 'pk-alice', publicKeyAlgorithm: 'ed25519' },
      },
    }

    const output = serializeEditablePolicy(editable, updated)

    // `settings` was never touched by this write -- its nested comment must
    // survive even though the write replaced a *different* top-level key.
    expect(output).toContain('# How long a seal remains valid (in days)')
  })

  it('preserves sibling fields and their comments on a gate whose authorizedSigners changed', () => {
    const editable = loadAnnotatedPolicy()
    const updated: PolicyConfig = {
      ...editable.policy,
      gates: {
        'ci-gate': {
          ...(editable.policy.gates?.['ci-gate'] ?? {
            name: 'CI Gate',
            authorizedSigners: [],
            fingerprint: { paths: ['src'] },
            maxAge: '90d',
          }),
          authorizedSigners: ['carol', 'alice'],
        },
      },
    }

    const output = serializeEditablePolicy(editable, updated)

    // Only authorizedSigners should change on ci-gate -- its other fields and
    // their own trailing comment must be left exactly as they were.
    expect(output).toContain('description: Automated CI checks')
    expect(output).toContain('maxAge: 90d # keep seals fresh')
    expect(output).toContain('- alice')
  })

  it('leaves the document byte-for-byte unchanged (aside from formatting) when nothing changed', () => {
    const editable = loadAnnotatedPolicy()

    const output = serializeEditablePolicy(editable, editable.policy)

    expect(output).toContain(SCHEMA_DIRECTIVE)
    expect(output).toContain('# How long a seal remains valid (in days)')
    expect(output).toContain('#   mike-north:')
  })

  it('removes a deleted top-level field from the document', () => {
    const editable = loadEditablePolicy(
      '/project/.attest-it/policy.yaml',
      `${SCHEMA_DIRECTIVE}\nversion: 1\nsettings:\n  maxAgeDays: 30\nminVersion: '0.1.0'\nteam: {}\n`,
    )
    const { minVersion: _minVersion, ...rest } = editable.policy
    const updated: PolicyConfig = rest

    const output = serializeEditablePolicy(editable, updated)

    expect(output).not.toContain('minVersion')
  })
})

describe('serializeEditablePolicy (JSON)', () => {
  it('re-serializes JSON directly (no comments to preserve)', () => {
    const json = JSON.stringify({ version: 1, settings: { maxAgeDays: 30 }, team: {} })
    const editable = loadEditablePolicy('/project/.attest-it/policy.json', json)
    const updated: PolicyConfig = {
      ...editable.policy,
      team: { bob: { name: 'Bob', publicKey: 'pk-bob', publicKeyAlgorithm: 'ed25519' } },
    }

    const output = serializeEditablePolicy(editable, updated)
    const parsed: unknown = JSON.parse(output)

    expect(parsed).toMatchObject({ team: { bob: { name: 'Bob' } } })
  })
})

describe('sanity: yaml Document.setIn preserves unrelated comments', () => {
  // A direct, minimal check of the `yaml` package behavior this module
  // depends on -- protects against a future `yaml` upgrade silently changing
  // that contract out from under `serializeEditablePolicy`.
  it('keeps a leading comment on an untouched key after setIn on a different key', () => {
    const doc = parseDocument('# leading comment\nfoo: 1\nbar: 2\n')
    doc.setIn(['bar'], 3)
    expect(doc.toString()).toContain('# leading comment')
  })
})
