# ADR-0002: git runs only on the server; clients speak a small HTTP protocol

Status: accepted · Date: 2026-07-07

## Context

Git gives history, diffs, and backup, but running it on Android or in a
browser (isomorphic-git) is slow and complex, and single-user sync does not
need distributed version control on every device.

## Decision

The server is the sole git user. Clients sync via per-doc `rev` + global
monotonic `seq`: pull `GET /api/changes?since=seq`, push
`PUT /api/docs/:id {baseRev, content}`, SSE nudge. Diverged pushes get a
server-side three-way merge (`git merge-file`); dirty merges fork a sibling
conflict file surfaced in the UI. Deletes are tombstones.

## Consequences

- Offline works via a client outbox; no git on clients ever.
- Conflicts never destroy content; the rare dirty merge becomes a visible
  sibling note.
- CRDTs are explicitly out until a real live-co-editing need appears; Yjs
  would slot in as another body format without protocol changes.
