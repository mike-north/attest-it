---
"@attest-it/cli": minor
---

Improve attestation prompt visibility and remove unsafe --yes flag

**Visual Improvements:**
- Add visually distinctive yellow box border around attestation confirmation prompt
- Use box-drawing characters for clean, professional appearance
- Makes attestation prompt stand out from test output

**Security Enhancement:**
- Remove `--yes` / `-y` flag that bypassed user confirmation
- All attestations now require explicit user approval
- Default answer changed to "No" - user must actively confirm with "y"
- Prevents accidental or automated attestation creation

The new prompt appears as:
```
┌────────────────────────────────────────┐
│ Create attestation? (y/N)              │
└────────────────────────────────────────┘
```

This ensures that human verification - the core principle of attest-it - cannot be bypassed programmatically.
