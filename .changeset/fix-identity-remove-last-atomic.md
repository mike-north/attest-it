---
'@attest-it/cli': minor
---

**Fixed `identity remove` of the last identity leaving an orphaned config reference after deleting its private key (issue #133).**

Removing the last identity in a repo is refused (`✗ Cannot remove last identity`, exit code 3) --
but the command previously deleted the private key from storage _before_ checking whether the
removal would be refused. A refused `identity remove <slug> -y` on the last identity left `whoami`
reporting the identity as healthy while the underlying private key was already gone, so any
operation needing it (e.g. `init --root-signer <slug>`) later failed with "Secret not found in
file store".

The last-identity guard (and other preconditions) now run before any destructive key deletion, so
a refused removal never half-applies: the private key remains in place and fully usable. The
last-identity policy itself is unchanged -- a repo must always retain at least one identity.
