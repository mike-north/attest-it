---
'@attest-it/core': minor
'@attest-it/cli': minor
---

Adopt VaultKeeper's delegated-signing (`SigningBackend`) and presence-capability surface.

- **Delegated signing for signing-capable backends.** `VaultKeyProvider` now uses VaultKeeper's `SigningBackend` contract (`generateSigningKey` / `getPublicKey` / `signWithKey`) when the underlying backend implements it (guarded by `isSigningBackend`). For such backends the private key is generated and held inside the backend and signing is delegated — the raw key never reaches attest-it's process memory as a file, let alone disk. Backends that only implement the base `SecretBackend` contract keep the existing `getPrivateKey()` temp-file path unchanged (additive, not a removal).
- **`KeyProvider` interface extension (additive, optional).** Three optional members were added: `signDirectly?(keyRef, data)`, `supportsDelegatedSigning?(keyRef)`, and `getPresenceCapability?()`. Existing implementers and callers are unaffected — hence a **minor** bump, not major.
- **Presence capability surfaced.** `attest-it identity show` now reports whether the active identity's backend enforces a fresh per-use human-presence check, fail-closed for backends that cannot prove it. New helper `getIdentityPresenceCapability()` is exported from `@attest-it/core`.
- **New seal-signing helpers.** `createSealWithProvider()` (prefers delegated signing, falls back to the temp-file PEM path) and `createSealWithSigner()` are exported; the `seal`/`run` commands and the embeddable `seal()` API route through them.
- **Root gate anchors with delegated keys too.** `createRootSealWithProvider()` lets a root signer whose key lives in a signing backend anchor `policy.yaml` without ever materializing the raw key; `seal --root` and `init`'s bootstrap ceremony use it, so a delegated-key identity can be a root signer.
- **`@1password/sdk` is now an explicit dependency of `@attest-it/core`.** VaultKeeper 0.7.0 made it an optional peer for the 1Password backend (replacing the `op` CLI); declaring it keeps the VaultKeeper-backed 1Password path resolvable. Documented in the README and `docs/configuration.md`.
