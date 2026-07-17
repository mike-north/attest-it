---
'@attest-it/cli': patch
---

Fix the documented getting-started flow end-to-end:

- **`init` no longer fails on a fresh project's `package.json`.** `npm install <pkg>` in a directory with no prior `package.json` (the README's own Quick Start step 1) leaves behind a file with no `name`/`version`. `init` previously rejected this with an internal-looking error; it now auto-populates the missing field(s) instead and reports which ones it patched.
- **`identity export`'s onboarding guidance now names the real config file.** It used to tell users to add their key to `.attest-it/team-config.yaml` under a `members:` key -- neither of which exist. It now correctly points at `.attest-it/policy.yaml`'s `team:` key.

Also corrects `docs/getting-started.md` to match `init`'s real behavior (an empty `team: {}` / `gates: {}` / `suites: {}` scaffold with commented examples, not an interactive gate/suite wizard), documents the previously-undocumented shell-completions prompt, and adds an explicit "define your first gate and suite" step so the documented command order (`init` → define gate/suite → `team join` → `run`/`seal`) actually works without a hand-added suite. `docs/configuration.md` now notes that `publicKeyPath`/`attestationsPath` are accepted by the schema but not currently read by any code path -- only `sealsPath` governs seal file location.
