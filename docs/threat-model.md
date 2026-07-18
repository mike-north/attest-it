# attest-it Threat Model

This document describes the threats attest-it defends against, the mechanisms that
provide those defenses, and the residual risks that are explicitly out of scope
(the embedder's or repository operator's responsibility).

The central invariant is the PRD's Goal 3 and the integration contract's
invariant 5:

> **No sequence of writes an agent can make inside a proposal branch — artifact,
> gate entry, config edit, seal file, workflow edit — may yield a passing
> verification without a signature from a key behind a human-presence backend.**

attest-it answers _"does a valid, current seal exist for this content, signed by
an authorized key?"_ — it never answers _"is this action permitted."_ Permission
and human-presence enforcement live in the key backend (a signer's private key is
only reachable with human presence); attest-it verifies the resulting signatures.

## Trust anchor: the sealed root gate over `policy.yaml`

`.attest-it/policy.yaml` holds the trust-critical data: the `team` (public keys)
and `gates` (who may sign what). Before this mechanism, nothing verified the
_provenance_ of `policy.yaml` itself — a branch could add itself to `team`,
authorize itself on a gate, and pass verification.

The **root gate** closes this: `policy.yaml` is itself a gated, sealed artifact.

- A reserved top-level `rootGate` section names the **root signers** — the only
  identities allowed to authorize a change to `policy.yaml`.
- `rootGate` is deliberately _not_ an entry in the user-editable `gates` map, and
  the reserved gate id `__root__` may not be used as an ordinary gate. A pull
  request therefore cannot redefine _which_ gate is root.
- The artifact the root gate covers is fixed to `policy.yaml`; it is not
  user-configurable, so a branch cannot repoint the root gate at empty content.
- Verification order is mandatory: **load config → verify the config's own seal
  chain against the root gate → only then evaluate every other gate.** A gate is
  never evaluated against a policy whose own root-gate seal did not verify.
- Changing `rootGate.authorizedSigners` changes the policy's content, which
  changes its fingerprint, which requires a **fresh root seal from an existing
  root signer**. A branch cannot bootstrap a new root of trust for itself.

The root seal is created and verified with the _same_ primitives as any other
gate seal (`createSeal` / `verifyGateSeal`), so there is one trust system to
audit.

### Bootstrap ceremony

The first root signer is established by an explicit, human-run step — never
silently defaulted:

```
attest-it identity create --name "…" --slug you        # once, general onboarding
attest-it init --root-signer you                        # THE ceremony
```

`attest-it init --root-signer <slug>` (or the interactive confirmation `init`
offers when a TTY and an active identity are present) records the signer in
`rootGate`, adds their public key to `team`, and creates the anchoring seal over
`policy.yaml` — all in a single invocation. From then on, `attest-it verify`
treats the policy as trust-anchored, and any change to it requires a fresh root
seal (`attest-it seal --root`) from a current root signer.

## Threats and mitigations

### T1 — An agent edits the config to authorize itself

_Threat:_ a proposal branch edits `policy.yaml` to add a new public key to `team`
and authorize it on a gate (or modifies an existing gate's `authorizedSigners`),
then seals an artifact with the newly-added key.

_Mitigation:_ the edit changes the policy's fingerprint. The existing root seal
covers the _previous_ fingerprint, so the mandatory root-gate pre-step reports
`FINGERPRINT_MISMATCH` and `attest-it verify` fails **before** any gate is
evaluated — naming `.attest-it/policy.yaml` as the untrusted change rather than
emitting a generic failure. The only way to pass is a fresh root seal over the new
policy from an **existing** root signer, whose private key is behind a
human-presence backend.

_Adversarial tests (run in CI):_
`packages/core/test/root-gate.test.ts` ("adversarial AC 1", "adversarial AC 2",
"AC 5") and
`packages/cli/test/integration/root-gate.integration.test.ts` ("ADVERSARIAL 1",
"ADVERSARIAL 2") exercise this end-to-end against tampered `policy.yaml`.

### T2 — An agent edits the workflow file

_Threat:_ a proposal branch edits the CI workflow (`.github/workflows/*.yml`) so
that attest-it's Action runs with weakened inputs (e.g. an attacker-controlled
`policy-ref`), or is skipped entirely.

_Mitigation posture (PRD Q2 — recommended repository configuration):_

1. **Branch protection with a required status check.** Mark the attest-it
   verification job as a required check on the protected branch. A PR that removes
   or renames the job cannot satisfy the required check, so it cannot merge.
2. **`policy-ref` is loaded from the base branch, not the PR.** In a pull-request
   context the Action fetches `policy.yaml` — and therefore the root signer set —
   from the **base branch**, the trusted source. A branch that rewrites its own
   `policy.yaml` (adding itself as a root signer and self-sealing) is rejected as
   `UNKNOWN_SIGNER`, because the base branch does not list it. The repository's CI
   workflow guard (`scripts/check-policy-ref-guard.mjs`) additionally rejects
   unsafe `policy-ref` overrides in workflow definitions.
3. **CODEOWNERS on trust-critical paths.** Require a human code owner's review for
   changes to `.github/workflows/**` and `.attest-it/policy.yaml`, so workflow or
   policy edits cannot merge without human approval.
4. **Post-merge base-branch re-verification.** Run attest-it on `push` to the
   protected branch (not only on PRs), so a merge that slipped through is caught
   on the branch that matters.

_Recommendation & scope:_ attest-it documents this posture and recommends
enabling all four. It does **not** configure a specific repository's branch
protection or CODEOWNERS (operational, repo-owner-owned). Whether attest-it's
Action should additionally _self-check_ that it ran from base-branch workflow
definitions is a deliberate **non-goal** of the root-gate work and is **not
implemented** here; the recommended posture above (required check + base-branch
policy load + CODEOWNERS + post-merge re-verify) covers the threat. If the PRD
owner decides the Action should self-verify its own invocation, that is tracked
as a follow-up.

### T3 — An agent replays a seal against different content

_Threat:_ a proposal branch reuses a previously-valid seal for content that has
since changed (a stale or moved seal), hoping verification treats it as current.

_Mitigation:_ every seal binds an authorized signer's signature to the content's
**SHA-256 fingerprint** and a timestamp (`gateId:fingerprint:timestamp`). If the
content changes, the current fingerprint no longer matches the sealed one and
verification reports `FINGERPRINT_MISMATCH`. Seals also expire (`maxAge`), so a
replayed old seal is additionally rejected as `STALE`. This applies to both
ordinary gates and the root gate over `policy.yaml`.

### T4 — An agent PATH-shadows the attest-it binary

_Threat:_ an agent places a malicious `attest-it` earlier on `PATH` (or otherwise
substitutes the binary) so that "verification" is a no-op that always succeeds.

_Mitigation posture:_ **out of scope — the embedder's / consumer's duty.**
attest-it cannot defend against an attacker who already controls the execution
environment that invokes it. The embedder is responsible for invoking a trusted,
pinned attest-it (e.g. a pinned Action `uses:` SHA, a locked dependency in CI, or
an absolute path to a verified binary) from an environment the proposal branch
cannot alter. This is the same trust boundary every CI tool relies on and is
noted here so the boundary is explicit rather than assumed.

## Residual risks and boundaries

- **Local `attest-it verify` trusts the local policy.** On a developer's own
  machine there is no trusted base branch to compare against, so a locally-edited
  `policy.yaml` that is re-anchored locally will verify locally. The enforcement
  boundary that matters is the **merge gate** (the Action, which loads policy from
  the base branch) plus branch protection / CODEOWNERS. Local verification is a
  fast pre-check, not the trust boundary.
- **attest-it proves existence of a valid seal, never permission.** Usage grants,
  session scoping, and human-presence enforcement are the key backend's / the
  toolsmith's responsibility; attest-it verifies the resulting signatures.
