---
'@attest-it/core': patch
'attest-it': patch
---

Fix passphrase-encrypted key generation and signing failing under OpenSSL 3.6.x when the passphrase is piped via Node's `spawn` stdio. `generateKeyPair`'s public-key extraction step and `sign`'s `dgst` step now supply the passphrase through a dedicated pipe on file descriptor 3 (`-passin fd:3` / `-pass fd:3`) with stdin left as `'ignore'`, instead of `-passin stdin` / `-pass stdin`. OpenSSL 3.6.x's passphrase-reading UI routine falls back to an interactive console prompt (fatal outside a TTY) whenever fd 0 is a Node-created pipe, regardless of which fd actually carries the passphrase — this sidesteps that fallback.
