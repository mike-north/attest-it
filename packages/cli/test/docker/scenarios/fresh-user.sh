#!/bin/bash
set -e

echo "=== Testing Fresh User Scenario ==="

# Verify no config exists at start
CONFIG_DIR="$HOME/.config/attest-it"
CONFIG_PATH="$CONFIG_DIR/config.yaml"
if [ -f "$CONFIG_PATH" ]; then
  echo "ERROR: Config file already exists at $CONFIG_PATH"
  exit 1
fi
echo "✓ Verified no existing config"

# Test that CLI runs without crashing when no config exists
echo "Testing CLI with no config..."

# Test version command (should always work)
VERSION_OUTPUT=$(node dist/bin/attest-it.js --version 2>&1)
if [ -z "$VERSION_OUTPUT" ]; then
  echo "ERROR: version command returned empty output"
  exit 1
fi
echo "✓ Version command works: $VERSION_OUTPUT"

# Test whoami command - should indicate no active identity
echo "Testing whoami with no identity..."
set +e
WHOAMI_OUTPUT=$(node dist/bin/attest-it.js whoami 2>&1)
WHOAMI_EXIT=$?
set -e

# whoami should fail gracefully or indicate no identity
echo "Whoami output (exit $WHOAMI_EXIT): $WHOAMI_OUTPUT"

# Test identity list - should show empty list or appropriate message
echo "Testing identity list with no identities..."
set +e
LIST_OUTPUT=$(node dist/bin/attest-it.js identity list 2>&1)
LIST_EXIT=$?
set -e
echo "Identity list output (exit $LIST_EXIT): $LIST_OUTPUT"

# Create config directory and manually create a minimal identity config
echo "Creating minimal identity config manually..."
mkdir -p "$CONFIG_DIR"
cat > "$CONFIG_PATH" << 'YAML'
version: 1
activeIdentity: docker-test
identities:
  docker-test:
    name: Docker Test User
    email: docker@test.local
    github: dockertest
    publicKey: ZG9ja2VyLXRlc3QtcHVibGljLWtleQ==
    privateKey:
      type: file
      path: /home/testuser/.config/attest-it/keys/docker-test.pem
YAML

echo "✓ Created test identity config"

# Now verify whoami works with the config
WHOAMI_OUTPUT=$(node dist/bin/attest-it.js whoami 2>&1)
if ! echo "$WHOAMI_OUTPUT" | grep -q "docker-test"; then
  echo "ERROR: whoami doesn't show expected identity"
  echo "Output: $WHOAMI_OUTPUT"
  exit 1
fi
echo "✓ Whoami shows correct identity"

echo "=== Fresh User Test PASSED ==="
