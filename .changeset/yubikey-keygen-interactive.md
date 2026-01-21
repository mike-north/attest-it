---
'@attest-it/cli': minor
---

Add YubiKey as a key storage option in interactive keygen flow

Users can now select YubiKey as a private key storage provider when running
`attest-it keygen`. The private key is encrypted using YubiKey's HMAC-SHA1
challenge-response feature, requiring physical touch of the YubiKey to sign
attestations.

Features:
- Auto-detects connected YubiKeys when ykman CLI is installed
- Supports multiple YubiKey devices (prompts user to select)
- Auto-selects slot if only one is configured for challenge-response
- Offers to automatically configure HMAC-SHA1 on slot 2 if not set up
