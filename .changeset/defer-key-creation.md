---
'@attest-it/cli': patch
---

Defer key pair generation until after all user prompts complete during identity creation. This prevents creating orphaned keys when users abort the process and minimizes how long private key material is held in memory.
