---
'@attest-it/cli': minor
'attest-it': minor
---

Fix `run`/`seal` reporting success for an unauthorized signer. An unauthorized-signer `attest-it run --suite ... --yes` previously printed `✓ Suite completed!`, exited `0`, and suggested a "To commit" hint for a seal that was never created; `attest-it seal --json` similarly reported `ok: true`. No seal was ever written in either case (verified: this was a reporting bug, not a trust hole — `verify` always correctly reported `MISSING` for the unsealed gate). Both commands now treat an unauthorized-signer attempt as a hard failure: a nonzero exit code, an unambiguous error banner with no `✓`, `ok: false` in `seal --json`, and no "To commit" hint. Authorized signers are unaffected.
