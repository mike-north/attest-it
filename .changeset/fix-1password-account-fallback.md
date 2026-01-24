---
'@attest-it/cli': patch
---

Fix 1Password account name display when vault is locked. Previously showed confusing output like "my.1password.com (my.1password.com)" - now shows "[Could not read account name] (my.1password.com)" to clearly indicate when account details cannot be retrieved.
