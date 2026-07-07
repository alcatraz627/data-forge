# Environment variable access

Two shapes in this repo, by the file's role:

1. **Server and web** read env through a central config module, never scattered:
   - `apps/server/src/config.ts` — the one place server env is read
     (`FORGE_PORT`, `FORGE_DATA`, `FORGE_ARCHIVE_DAYS`, `FORGE_PUSH_REMOTE`,
     `FORGE_INBOX_TOKEN`, `FORGE_WEB_DIST`). Add new server env there.
   - Web uses Vite `import.meta.env`; no raw `process.env`.

2. **Standalone client entry points** read their single connection variable at
   the top of the entry file, because they run as their own process (often
   outside the monorepo, launched by a shell or an MCP host) and cannot import
   the server's config:
   - `apps/cli/src/forge.ts` and `apps/mcp/src/index.ts` read `FORGE_URL`
     (default `http://localhost:5040`) once at module top.
   - The Android app reads its server URL from `SharedPreferences`, the
     SwiftBar plugin from `FORGE_URL` in its environment — same principle.

The rule (`~/.claude/rules/env-var-config-pattern.md`) says route reads through
the project's config module; the audit that rule also asks for is: an
entry-point script is a different file character than a server module, so a
single connection-URL read at its top is the correct pattern, not a violation.
