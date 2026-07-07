## session: M0 build, plan to working app [forge-plan-d4] — 2026-07-07

Purpose: choose stack, scaffold monorepo, build full M0 (server store, web
client, deploy prep), fresh-eyes review + fixes.

Insights:
- node:sqlite (runtime built-in, FTS5 included) beat better-sqlite3, whose
  native build fails on Node 26. Zero native deps is now a project property
  worth defending.
- The reviewer paid for itself: runtime-verified that `pullToHead` dropped
  changes past the 500-row page cap (cursor jumped to `latestSeq` on full
  pages). Fix: advance by last received seq; only trust `latestSeq` on a
  short page. Regression-tested at 620 docs.
- Editors must capture `baseRev` at open, not read it at save: background
  pulls advance the store's rev and turn real concurrent edits into silent
  clean overwrites, bypassing the conflict fork (invariant 4).
- WAL-mode sqlite inside a git-tracked dir needs `meta/index.sqlite*` in the
  ignore file: the -wal/-shm sidecars otherwise ship binary churn in every
  batch commit. `ensureIgnores()` heals existing repos additively at boot.
- Playwright `fill()` on controlled React inputs races with SSE-driven
  re-renders; `pressSequentially` (real keystrokes) is the reliable test
  path. Real user typing is unaffected.
- The server write path is a synchronous critical section (no await between
  file write and index update). Keep it that way; it is the torn-write
  defense the reviewer called out as a strength.

---
