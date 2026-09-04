#!/bin/bash
# One-time setup: point git at the versioned hooks directory so the pre-push
# type-check gate is active. Safe to re-run. Run once per clone:
#
#   bash deploy/setup-hooks.sh
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

git config core.hooksPath .githooks
chmod +x .githooks/* 2>/dev/null || true

echo "✅ Git hooks enabled (core.hooksPath = .githooks)."
echo "   pre-push will now run 'npm run typecheck' before every push."
