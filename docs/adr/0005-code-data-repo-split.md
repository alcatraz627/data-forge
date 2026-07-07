# ADR-0005: Code and data live in separate repos

Status: accepted · Date: 2026-07-07

## Context

The server auto-commits user data on a ~60s debounce; mixed into the code repo
that would drown code history. Privacy also differs: notes are private
forever; code need not be.

## Decision

- Code: `github.com/alcatraz627/data-forge` (public by default; flip anytime).
- Data: `~/DataForge`, its own git repo, private remote
  `github.com/alcatraz627/data-forge-sync`.
- The server bootstraps the data dir if missing (`ensureDataDir`), so a fresh
  machine needs no manual setup; remotes are configured by the human/agent
  once.

## Consequences

- Code history stays reviewable; data history stays private.
- Backup cadence and retention can differ per repo.
- `FORGE_DATA` env var points the server anywhere (tests use throwaway dirs).
