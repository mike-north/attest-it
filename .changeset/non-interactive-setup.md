---
'@attest-it/core': minor
'@attest-it/cli': minor
'attest-it': minor
---

Make the setup command surface (`identity create`, `init`, `team add`, `team join`, `run`) non-interactive-capable, so CI, embedders, and agent-driven callers no longer hang on a TTY prompt.

- **`identity create`** accepts `--name`, `--slug` (derived from `--name` when omitted), `--email`, `--github`, `--storage <file|keychain|1password|yubikey>`, and backend-specific flags (`--keychain-path`/`--keychain-item`, `--op-account`/`--op-vault`/`--op-item`, `--yubikey-serial`/`--encrypted-key-name`). `--passphrase-stdin` encrypts a file-backed private key with a passphrase piped via stdin (never prompted).
- **`init`** now fails fast naming `--force` when config already exists and stdin is not a TTY, instead of hanging on the overwrite-confirmation prompt.
- **`team add`** and **`team join`** accept `--slug`, `--name`, `--email`, `--github`, `--public-key` (add only), and `--gates` (comma-separated gate IDs); gate authorization defaults to none rather than prompting when non-interactive.
- **`run`** accepts `-y, --yes` to auto-confirm seal creation; without it, a non-interactive run fails fast instead of hanging. Running `run` with no `--suite`/`--all` and no TTY now fails fast instead of launching an interactive UI that can never receive input. Signing with a passphrase-encrypted identity key resolves the passphrase from the `ATTEST_IT_KEY_PASSPHRASE` environment variable, an interactive prompt, or fails fast.
- The shell-completion offer shown after `init`/`identity create` is now skipped (rather than prompting unconditionally) when stdin is not an interactive TTY.
- Interactive mode remains the default for every command above when stdin is a TTY and flags are omitted -- no behavior change for humans running these by hand.
- `@attest-it/core`: `generateEd25519KeyPair`/`signEd25519` gained an optional passphrase parameter, `createSeal` gained an optional `passphrase` option, and a new `isEncryptedPrivateKeyPem` helper detects passphrase-encrypted keys.
