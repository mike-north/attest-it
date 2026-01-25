#!/bin/bash
set -e

echo "=== Testing Corrupted Config Scenario ==="

# Config path (mounted from fixture as read-only)
CONFIG_PATH="$HOME/.config/attest-it/config.yaml"

# Verify corrupted config is mounted
if [ ! -f "$CONFIG_PATH" ]; then
  echo "ERROR: Corrupted config not found at $CONFIG_PATH (should be mounted from fixture)"
  exit 1
fi
echo "✓ Corrupted config exists at $CONFIG_PATH"

# Show the corrupted content for debugging
echo "Config content:"
cat "$CONFIG_PATH" || true
echo ""

# Attempt to run CLI command and capture output (expect failure)
echo "Attempting to run CLI with corrupted config..."
set +e  # Temporarily allow failures
ERROR_OUTPUT=$(node dist/bin/attest-it.js whoami 2>&1)
EXIT_CODE=$?
set -e

# Check that command failed
if [ $EXIT_CODE -eq 0 ]; then
  echo "ERROR: CLI command succeeded with corrupted config (should have failed)"
  exit 1
fi
echo "✓ CLI command failed as expected (exit code: $EXIT_CODE)"

# Verify error message mentions config/yaml/parse issue
if ! echo "$ERROR_OUTPUT" | grep -qiE "(config|yaml|parse|invalid|corrupted|malformed|error)"; then
  echo "ERROR: Error message doesn't mention config/yaml/parse issue"
  echo "Error output: $ERROR_OUTPUT"
  exit 1
fi
echo "✓ Error message contains expected keywords"
echo "Error message: $ERROR_OUTPUT"

echo "=== Corrupted Config Test PASSED ==="
