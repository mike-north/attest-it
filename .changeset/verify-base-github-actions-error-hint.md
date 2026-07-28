---
'@attest-it/cli': patch
'attest-it': patch
---

`verify --base <ref>` now names the specific cause when the base ref can't be read under a default GitHub Actions `pull_request` checkout, instead of only hinting at a shallow clone. `actions/checkout@v4` on a `pull_request` event leaves no local base-branch ref regardless of fetch depth; the error now says so and gives the exact fix (`git fetch --depth=1 origin <base-branch>`). Fail-closed behavior and exit code are unchanged.
