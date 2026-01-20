---
'@attest-it/core': patch
'@attest-it/cli': patch
---

Security hardening for YubiKey key provider

**Core Package:**

- Add Zod schema validation for encrypted key file structure with runtime type checking
- Add Additional Authenticated Data (AAD) to AES-256-GCM encryption, binding metadata to ciphertext
- Add path traversal protection - encrypted key paths must be within the config directory
- Add serial number verification with security warnings when not specified
- Add process exit handlers for temp file cleanup on SIGINT/SIGTERM
- Remove TOCTOU (time-of-check/time-of-use) vulnerabilities in file operations
- Sanitize error messages to prevent information leakage
- Add buffer size validation for IV, auth tag, salt, and challenge
- Document memory security limitations for JavaScript string handling in JSDoc

**CLI Package:**

- Integrate YubiKey provider into identity creation flow
- Add YubiKey device selection when multiple keys are connected
- Add challenge-response slot configuration guidance
