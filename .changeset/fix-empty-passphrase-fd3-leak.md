---
'@attest-it/core': patch
'attest-it': patch
---

Fix an unhandled `ECONNRESET` that could crash `generateKeyPair` when called with an empty-string passphrase (`passphrase: ''`). The internal `runOpenSSL` helper decided whether to open an extra stdio pipe (fd 3) for the passphrase using `passphrase !== undefined`, while `generateKeyPair` decided whether to reference that fd in OpenSSL's arguments (`-pass fd:3` / `-passin fd:3`) using `if (passphrase)`. Since `''` is not `undefined` but is falsy, an empty passphrase opened fd 3 without any OpenSSL argument reading it — an unconsumed pipe that could raise an unhandled error when the OpenSSL child process exited. Both checks now consistently treat an empty string the same as no passphrase, and the passphrase pipe now has a defensive `'error'` listener.
