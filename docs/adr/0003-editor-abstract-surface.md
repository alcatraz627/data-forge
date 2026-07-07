# ADR-0003: The editor is an abstract surface; TipTap is only the first implementation

Status: accepted · Date: 2026-07-07

## Context

User accepts TipTap only if it stays fast, and explicitly wants the option to
swap editors later without a rewrite.

## Decision

All editing goes through a `NoteEditor` React contract:
`{ value: markdown, onChange(markdown), mode: 'rich' | 'raw', autofocus }`.
Implementations live in `apps/web/src/editor/`; TipTap is the first, a
CodeMirror raw-markdown mode the second. Markdown is the only interchange
format; nothing outside the editor directory may import TipTap.

## Consequences

- Swapping editors is a new implementation of one interface, zero data
  migration.
- Editor bundles are code-split so the capture path never pays for them.
