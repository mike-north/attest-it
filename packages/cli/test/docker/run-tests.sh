#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "Building CLI..."
cd "$CLI_DIR"
pnpm run build

echo "Building Docker images..."
docker compose -f test/docker/docker-compose.yml build

echo "Running all Docker tests..."
docker compose -f test/docker/docker-compose.yml up --abort-on-container-exit

echo "All Docker tests completed successfully!"
