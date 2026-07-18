---
'@attest-it/core': minor
'@attest-it/cli': minor
'attest-it': minor
---

Add a sealed **root gate** that trust-anchors `.attest-it/policy.yaml`.

The policy file (which holds the trust-critical `team` and `gates`) is now itself
a gated, sealed artifact. A reserved top-level `rootGate` section names the root
signers — the only identities allowed to authorize a change to `policy.yaml` — and
verification checks the policy's own seal chain **first**, before evaluating any
other gate. A gate is never evaluated against a policy whose own root-gate seal
did not verify. This closes the headline trust gap: a pull request can no longer
add itself to `team`, authorize itself on a gate, and pass verification.

**Behavior change — trust-critical:**

- **New verification pre-step.** When `policy.yaml` defines a `rootGate`,
  `attest-it verify` (and the GitHub Action) verify the root seal over the policy
  before evaluating gates. If the policy was modified without a fresh root seal
  from an existing root signer, verification **fails**, naming
  `.attest-it/policy.yaml` as the untrusted change.
- **Changing root signers requires an existing root signer.** Editing
  `rootGate.authorizedSigners` changes the policy fingerprint and requires a new
  root seal from a current root signer — a branch cannot bootstrap a new root of
  trust for itself. In a pull-request context the Action loads the root signer set
  from the base branch, so a self-added signer is rejected as `UNKNOWN_SIGNER`.
- **Reserved gate id.** The slug `__root__` is reserved; it cannot be used as an
  ordinary gate in `gates`.
- **The GitHub Action** performs the same root-gate pre-step (it re-verifies on
  the base branch). Configure the verification job as a required status check.

**Migration for existing repositories.** This change is backward compatible: a
repository that has not defined a `rootGate` is reported as "not trust-anchored"
and continues to verify as before. To adopt the trust anchor, run the one-step
bootstrap ceremony:

```
attest-it identity create --name "…" --slug you   # if you haven't already
attest-it init --root-signer you                   # establishes + seals the root
```

After adopting it, re-seal the root gate with `attest-it seal --root` (as a root
signer) whenever you change the trust-critical policy.

See `docs/threat-model.md` for the full threat model, including the recommended
repository posture (branch protection, base-branch policy loading, CODEOWNERS, and
post-merge re-verification) for workflow-file tampering.
