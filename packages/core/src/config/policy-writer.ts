/**
 * Comment-preserving read/write round-trip for policy.yaml.
 *
 * `policy.yaml` is scaffolded by `attest-it init` with a
 * `# yaml-language-server: $schema=...` directive, a trust-model header, and
 * commented onboarding examples. Commands that mutate the file in place
 * (`team join`, `team add`, `team remove`, and any future policy-mutating
 * command) must not silently strip that human-authored content on write.
 *
 * This module provides a document/AST-level edit path -- using the `yaml`
 * package's `Document` API -- instead of the "parse to plain object, then
 * `stringify()` the whole thing" pattern that destroys comments.
 *
 * @module
 */

import { Document, parseDocument } from 'yaml'
import { parsePolicyContent, type PolicyConfig } from './policy-schema.js'

/**
 * A policy file loaded for editing, retaining enough state (a parsed YAML
 * `Document` for `.yaml`/`.yml` files) to write updates back without losing
 * comments.
 * @public
 */
export type EditablePolicy =
  | {
      policy: PolicyConfig
      path: string
      format: 'yaml'
      document: Document.Parsed
    }
  | {
      policy: PolicyConfig
      path: string
      format: 'json'
    }

/**
 * Load a policy file's content for editing.
 *
 * For YAML policy files, this also parses a `Document` so that
 * {@link serializeEditablePolicy} can perform a comment-preserving write.
 * JSON policy files have no comments to preserve, so no document is kept.
 *
 * @param path - Path the policy content was read from (used to pick the
 * format and returned unchanged for later writes).
 * @param content - Raw file content, as read from `path`.
 * @returns The parsed, validated policy plus the state needed to write it
 * back losslessly.
 * @throws {@link PolicyValidationError} If validation fails.
 * @public
 */
export function loadEditablePolicy(path: string, content: string): EditablePolicy {
  const format = path.endsWith('.json') ? 'json' : 'yaml'
  const policy = parsePolicyContent(content, format)

  if (format === 'json') {
    return { policy, path, format }
  }

  return { policy, path, format, document: parseDocument(content) }
}

/**
 * Deep-equality for JSON-shaped values (arrays/plain objects/primitives).
 */
function deepEqualJson(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, i) => deepEqualJson(item, b[i]))
    )
  }
  if (isPlainRecord(a) && isPlainRecord(b)) {
    const aKeys = Object.keys(a)
    const bKeys = Object.keys(b)
    if (aKeys.length !== bKeys.length) {
      return false
    }
    return aKeys.every((key) => Object.hasOwn(b, key) && deepEqualJson(a[key], b[key]))
  }
  return false
}

/**
 * A plain JSON-shaped object (not an array, not a class instance).
 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  )
}

/**
 * Recursively set only the leaves that changed between `before` and `after`
 * onto `document` at `path`, leaving every untouched node -- and therefore
 * every comment attached to it -- exactly as it was.
 *
 * Recursion descends through plain objects (so an unrelated sibling, like an
 * untouched gate's `name`/`description`/`fingerprint`, is never re-written
 * just because a *different* field on the same object changed). Arrays and
 * primitives are replaced wholesale once a difference is found, since the
 * `yaml` package has no meaningful notion of a "diff" within a scalar or
 * array value.
 */
function applyPolicyDiff(
  document: Document.Parsed,
  path: (string | number)[],
  before: unknown,
  after: unknown,
): void {
  if (deepEqualJson(before, after)) {
    return
  }

  if (isPlainRecord(before) && isPlainRecord(after)) {
    const beforeKeys = Object.keys(before)
    const afterKeys = Object.keys(after)

    // A record transitioning from empty to populated (e.g. the scaffolded
    // `team: {}` gaining its first member) must not be edited key-by-key.
    // `document.setIn` on a *nested* path reuses the existing node in place
    // (YAMLMap#set), which keeps whatever collection style that node already
    // had -- and an empty mapping like `{}` is parsed as flow style. The
    // result was a trust-critical file where `team:` silently became
    // flow-style JSON-like YAML (`team: {alice: {...}}`) the moment someone
    // ran `team join`, while every other block-style section (including the
    // untouched `gates:`) stayed block-style. See issue #134.
    //
    // Replacing the node wholesale instead (the same path used for scalar/
    // array changes below) makes `yaml` synthesize a brand-new node for
    // `after`, which defaults to block style -- matching the scaffold and
    // every doc example.
    if (beforeKeys.length === 0 && afterKeys.length > 0) {
      document.setIn(path, after)
      return
    }

    const keys = new Set([...beforeKeys, ...afterKeys])
    for (const key of keys) {
      applyPolicyDiff(document, [...path, key], before[key], after[key])
    }
    return
  }

  if (after === undefined) {
    document.deleteIn(path)
  } else {
    document.setIn(path, after)
  }
}

/**
 * Serialize an updated policy for writing back to disk.
 *
 * For YAML policy files, this recursively diffs `editable.policy` against
 * `updatedPolicy` and sets only the leaves that actually changed on the
 * original parsed `Document` -- an AST-level edit -- rather than
 * re-serializing the whole object from scratch. A comment survives unless
 * it's attached to a node that was itself replaced by the diff; in
 * particular, the leading `# yaml-language-server:` schema directive and
 * trust-model header (which precede every top-level key) are never touched,
 * and sibling fields on a partially-changed object (e.g. an unrelated gate's
 * `name`/`fingerprint` when only its `authorizedSigners` array changed) keep
 * their own comments too. This also keeps the file's shape stable so
 * security-reviewed diffs stay reviewable (issue #102).
 *
 * JSON policy files have no comments to preserve, so they're re-serialized
 * directly.
 *
 * @param editable - The policy as loaded by {@link loadEditablePolicy}.
 * @param updatedPolicy - The new policy value to persist.
 * @returns The file content to write back to `editable.path`.
 * @public
 */
export function serializeEditablePolicy(
  editable: EditablePolicy,
  updatedPolicy: PolicyConfig,
): string {
  if (editable.format === 'json') {
    return JSON.stringify(updatedPolicy, null, 2) + '\n'
  }

  applyPolicyDiff(editable.document, [], editable.policy, updatedPolicy)

  return String(editable.document)
}
