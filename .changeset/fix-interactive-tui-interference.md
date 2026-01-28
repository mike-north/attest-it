---
'@attest-it/cli': patch
---

Fix interactive TUI interference with test output. The status bar was appearing multiple times on screen because Ink's re-renders were conflicting with child process stdout. The TestRunner component now returns null while tests are executing, preventing TUI interference while preserving React state.
