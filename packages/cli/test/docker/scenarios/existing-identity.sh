#!/bin/bash
set -e

echo "=== Testing Existing Identity Scenario ==="

# Verify config file exists (mounted from fixture)
CONFIG_PATH="$HOME/.config/attest-it/config.yaml"
if [ ! -f "$CONFIG_PATH" ]; then
  echo "ERROR: Config file not found at $CONFIG_PATH (should be mounted from fixture)"
  exit 1
fi
echo "✓ Config file exists at $CONFIG_PATH"

# Show config content for debugging
echo "Config content:"
cat "$CONFIG_PATH"
echo ""

# List identities and verify output
echo "Listing identities..."
LIST_OUTPUT=$(node dist/bin/attest-it.js identity list 2>&1)
echo "Identity list output: $LIST_OUTPUT"

if [ -z "$LIST_OUTPUT" ]; then
  echo "ERROR: identity list command returned empty output"
  exit 1
fi

# Check that output contains the expected identity
if ! echo "$LIST_OUTPUT" | grep -q "existing-user"; then
  echo "ERROR: identity list doesn't contain 'existing-user'"
  exit 1
fi
echo "✓ Found existing identity in list"

# Verify with whoami (config has activeIdentity set)
echo "Verifying active identity with whoami..."
WHOAMI_OUTPUT=$(node dist/bin/attest-it.js whoami 2>&1)
echo "Whoami output: $WHOAMI_OUTPUT"

if [ -z "$WHOAMI_OUTPUT" ]; then
  echo "ERROR: whoami command returned empty output"
  exit 1
fi

# Verify the active identity is shown correctly
if ! echo "$WHOAMI_OUTPUT" | grep -q "existing-user"; then
  echo "ERROR: whoami doesn't show 'existing-user' as active"
  exit 1
fi
echo "✓ Active identity verified with whoami"

echo "=== Existing Identity Test PASSED ==="
