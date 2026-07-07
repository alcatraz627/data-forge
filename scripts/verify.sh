#!/usr/bin/env bash
# Scaffold-level verification: compiles, boots, and serves.
# This script grows with the project (sync replay tests, Playwright smoke);
# the contract is in docs/plan.md under "Verification".
set -euo pipefail
cd "$(dirname "$0")/.."

pnpm --filter @forge/tokens build
pnpm -r typecheck
pnpm -r test

# Boot the server against a throwaway data dir. This exercises the git
# bootstrap path end-to-end without touching real data in ~/DataForge.
TMP="$(mktemp -d)"
FORGE_DATA="$TMP/data" FORGE_PORT=5949 pnpm --filter @forge/server exec tsx src/index.ts &
PID=$!
trap 'kill "$PID" 2>/dev/null || true' EXIT

for _ in $(seq 1 20); do
  curl -fsS http://localhost:5949/health >/dev/null 2>&1 && break
  sleep 0.25
done
curl -fsS http://localhost:5949/health | grep -q '"ok":true'
test -d "$TMP/data/.git"
git -C "$TMP/data" log --oneline | grep -q 'init'

pnpm --filter @forge/web build >/dev/null

echo "verify: OK (typecheck, server boots + data dir bootstraps as git repo, web builds)"
