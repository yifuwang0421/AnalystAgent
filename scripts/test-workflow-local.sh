#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Load API key from the environment instead of a developer-specific local file.
API_KEY="${ANTHROPIC_API_KEY:-}"
if [ -z "$API_KEY" ]; then
  echo "Error: ANTHROPIC_API_KEY is not set"
  exit 1
fi

cd "$REPO_ROOT"

echo "==> Installing dependencies..."
bun install

echo "==> Running validate-daily-note locally..."
ANTHROPIC_API_KEY="$API_KEY" bun run apps/cli/src/index.ts run \
  --workspace-dir .github/agents \
  --source craft-public \
  --output-format stream-json \
  "Read today's daily note from the Craft source and print its contents. Do not modify anything."
