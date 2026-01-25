---
'@attest-it/core': patch
---

Add glob pattern support for fingerprint paths. Paths containing glob characters (`*`, `?`, `{}`, `[]`) are now expanded using tinyglobby instead of being validated as literal paths. Glob patterns that match no files will throw an error to catch typos early.
