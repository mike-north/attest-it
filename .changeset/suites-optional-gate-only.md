---
'@attest-it/core': minor
'attest-it': minor
---

Make suites optional for gate-only / read-only flows.

The operational config (`.attest-it/config.yaml`) previously required at least
one suite — a global precondition enforced at parse time. That rejected an empty
`suites: {}`, which is exactly what `attest-it init` scaffolds, so gate-only
"Direct Sealing" and read-only operations failed on a freshly-initialized repo:
`listGates`, `fingerprint`, `verifyOne`, `verifyAll`, `seal`, `status`, and
`verify` all returned a `malformed` failure ("At least one suite must be
defined") even though they need only policy/gate data, never a suite.

Suites are operational data, not a global precondition. An empty (or omitted)
`suites` map is now a valid operational config, so those flows load cleanly
against `suites: {}`. Suite-**dependent** operations are unchanged: `run --suite
<name>` still validates that the named suite exists and fails cleanly when it
does not — this relaxes the global precondition, not per-operation suite
resolution.

The relaxation is purely additive: every previously-valid config remains valid,
and root-gate trust anchoring is unaffected (a gate-only config can still be
root-anchored and still enforces the root gate on verify).
