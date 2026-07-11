# ADR-0006: One data kind — canvases are blocks inside markdown notes

Status: accepted · Date: 2026-07-11

## Context

M5c introduced canvas notes as a second content shape: a whole-note format
(`<!-- forge:canvas v1 -->` + tldraw JSON) that six call sites had to branch
on, and that could never mix prose with a drawing. The TEMPERED design
handoff (§6) requires one data kind: every note is markdown, and a drawing
is something a note *contains*, not something a note *is*.

## Decision

A canvas is a fenced block inside an ordinary markdown body, 0…n per note:

````markdown
```forge-canvas v1
{"tldraw":"snapshot as single-line JSON"}
```
````

- `JSON.stringify` never emits raw newlines, so the snapshot cannot break
  out of its fence, and any markdown renderer degrades it to a code block.
- Titles, previews, and full-text search see the body with fences stripped
  (`stripCanvasBlocks`); a note that is only a canvas titles as "Canvas".
- The server migrates legacy whole-note canvases at boot, once, stamped in
  the index kv store (`canvas_block_version`). Files change, rev+seq bump,
  git records it; `updated` is preserved so recency order doesn't shuffle.
  Corrupt legacy bodies are left untouched.
- `tags` joined the frontmatter in the same change: a normalized word list,
  omitted when empty, always-quoted (YAML would eat `true` or `2026`).
  Search and filters use the union of frontmatter tags and body `#tags`;
  frontmatter stays explicit-only.

## Consequences

- Notes can mix prose and drawings; the editor renders canvas blocks inline
  and opens tldraw fullscreen per block.
- The whole pipeline (outbox, merge, history, git) keeps working on
  canvases for free — same one-file property as before.
- Clients older than the block format still sync legacy bodies during the
  migration window; readers keep a legacy guard (`isLegacyCanvas`) until
  the Android/menubar companions are confirmed past it.
