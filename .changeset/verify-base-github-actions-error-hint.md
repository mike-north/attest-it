---
'@attest-it/cli': patch
'attest-it': patch
---

`verify --base <ref>` now names the specific cause when the base ref can't be read under a default GitHub Actions `pull_request` checkout, instead of only hinting at a shallow clone. `actions/checkout@v4` on a `pull_request` event leaves no local base-branch ref regardless of fetch depth; the error now says so and gives the exact fix (`git fetch --depth=1 origin <base-branch>`). The generic (non-GitHub-Actions) fallback's suggested fetch command is also fixed: it previously echoed the full `--base` ref (typically `origin/main`) back into `git fetch origin origin/main`, which is not a valid remote ref — it now suggests the bare branch name (`git fetch origin main`). Fail-closed behavior and exit code are unchanged.
