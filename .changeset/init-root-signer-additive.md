---
'@attest-it/cli': minor
'attest-it': minor
---

`init --root-signer` is now non-destructive, and `init --force` refuses to silently discard a populated config.

Following the CLI's own printed "Next steps" could previously destroy configuration. After `init` → `team join`, the CLI recommends `attest-it init --root-signer <slug>`; if gates/suites already existed, the bare form failed ("Config already exists … Pass --force"), and the suggested `--force` then re-scaffolded `policy.yaml`/`config.yaml` from empty templates — wiping `gates:`/`suites:` and orphaning any existing seal — while still printing "Trust anchor established" and exiting 0.

- **`init --root-signer <slug>` is now additive.** On an already-initialized repo it merges in only the `rootGate` (and the signer's `team` entry) and leaves existing `gates:`, `suites:`, `team:`, and seals untouched. It needs no `--force`.
- **`init --force` (the full re-scaffold) refuses to silently empty a populated config.** When existing `gates:`/`suites:` would be discarded, it prints exactly what is at stake and requires an explicit confirmation; non-interactively it refuses rather than wiping.
- **"Next steps" wording updated** so the recommended bootstrap sequence is safe and notes the root-signer step is non-destructive.
