---
'@attest-it/core': minor
'@attest-it/wasm': minor
---

Add optional WASM backend support via `initWasm`.

Calling `initWasm()` switches verification, authorization, and fingerprint
operations in `@attest-it/core` to the Rust/WASM implementation. When WASM
is not initialized, the TypeScript implementations continue to be used as
the fallback. The new `@attest-it/wasm` package provides the WASM module and
Node.js host platform bridge.
