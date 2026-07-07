.PHONY: dev tokens verify typecheck format

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
