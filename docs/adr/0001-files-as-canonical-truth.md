# ADR-0001: Markdown files in git are the canonical store

Status: accepted · Date: 2026-07-07

## Context

The system must sync across devices, stay agent-readable/writable forever, and
never lock data into a proprietary store. Databases make sync and queries easy
but make every external integration a project.

## Decision

Markdown files with YAML frontmatter, in a git repo, are the single source of
truth. SQLite (FTS5) is a derived, gitignored index rebuilt from files at any
time (`forge reindex`).

## Consequences

- Anything that can touch a filesystem is a first-class client; the server
  watcher lifts external edits into the sync feed.
- Index corruption is never data loss.
- The frontmatter serializer must be roundtrip-stable (stable key order, no
  reformat churn), enforced by a contract test.
