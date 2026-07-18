---
'@attest-it/cli': minor
'attest-it': minor
---

Add `attest-it verify --base <ref>`: a trusted-ref mode that makes the CLI a
genuine CI trust boundary for non-GitHub CI.

Without `--base`, `attest-it verify` trusts the working-tree `.attest-it/policy.yaml`
(a fast local pre-check). A pull request could rewrite its own `rootGate`/`team`,
re-seal, and still pass — only the GitHub Action caught this, because it loads
authorization from the pull request's base branch.

`verify --base <ref>` closes that gap. It sources `rootGate`, `team`, and `gates`
from `<ref>`'s copy of `policy.yaml` (via `git show`) while computing fingerprints
and reading seals from the working tree — the same base-vs-worktree check the
Action performs. A branch that self-adds a root signer and re-seals is rejected as
`UNKNOWN_SIGNER`, because the trusted ref does not list it. `--base` fails **closed**:
an unreadable ref or a missing policy at the ref is a configuration error with
actionable guidance, never a silent pass on the working-tree policy.

Non-GitHub CI can now enforce the trust boundary directly:

```bash
git fetch origin main
npx attest-it verify --base origin/main
```

Documentation is reconciled to match: README, getting-started, and the GitHub
integration guide now state plainly that plain `verify` is a local pre-check, and
that the CI trust boundary is the GitHub Action (base branch) or `verify --base <ref>`.
