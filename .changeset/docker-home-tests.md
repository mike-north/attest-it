---
'@attest-it/cli': patch
---

Add Docker-based containerized tests for home folder state testing. These tests verify CLI behavior with different home directory states (fresh user, existing identity, corrupted config) in isolated Docker containers, preventing interference with the host system.
