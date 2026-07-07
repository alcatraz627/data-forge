.PHONY: dev tokens verify typecheck format deploy logs

dev: tokens
	pnpm -r --parallel dev

tokens:
	pnpm --filter @forge/tokens build

verify:
	bash scripts/verify.sh

typecheck:
	pnpm -r typecheck

format:
	pnpm exec biome check --write .

deploy: tokens
	pnpm --filter @forge/web build
	launchctl kickstart -k gui/$$(id -u)/com.alcatraz.forge-server

logs:
	tail -f ~/Library/Logs/forge-server.log

# Import a Google Takeout export into the running server.
# Usage: make import DIR=~/Downloads/Takeout
import:
	pnpm --filter @forge/server exec tsx src/import/cli.ts "$(DIR)"
