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

# Perf budget: the main JS bundle (gzipped) must stay under 250KB, or the
# capture path starts paying for weight that belongs behind a code-split.
MAIN_JS="$(ls apps/web/dist/assets/index-*.js | head -1)"
GZ_BYTES="$(gzip -c "$MAIN_JS" | wc -c | tr -d ' ')"
if [ "$GZ_BYTES" -gt 256000 ]; then
  echo "verify: FAIL — main bundle ${GZ_BYTES}B gz exceeds 250KB budget" >&2
  exit 1
fi

echo "verify: OK (typecheck, tests, server boots + git bootstrap, web builds, bundle ${GZ_BYTES}B gz < 250KB)"
