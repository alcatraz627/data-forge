#!/usr/bin/env bash
# launchd entrypoint for forge-server. launchd starts jobs with a bare
# environment, so PATH and the working directory are set explicitly here;
# everything else comes from the server's own defaults (FORGE_DATA etc).
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
cd "$(dirname "$0")/../apps/server"
exec node_modules/.bin/tsx src/index.ts
