# Data Forge MCP server

Lets Claude (Code or Desktop) read and write your notes as tools. It's a thin
bridge over the forge-server HTTP API — no direct file access — so agent writes
go through the same validation and sync as every other client.

## Tools

- `search_notes(query)` — full-text search
- `create_note(body)` — add a note (syncs to all devices)
- `get_note(id)` — read one note
- `list_agenda()` — upcoming + overdue reminders
- `complete_reminder(docId, reminderIndex)` — mark done (recurring rolls forward)

## Wire it into Claude Code

Add to your project or global `.mcp.json`:

```json
{
  "mcpServers": {
    "data-forge": {
      "command": "npx",
      "args": ["tsx", "/Users/alcatraz627/Code/Claude/data-forge/apps/mcp/src/index.ts"],
      "env": { "FORGE_URL": "https://your-mac.ts.net" }
    }
  }
}
```

`FORGE_URL` defaults to `http://localhost:5040`. Note the running forge-server
is a hard dependency — the MCP server has no data of its own.

Verified end-to-end: an MCP client lists the five tools and `create_note` +
`search_notes` round-trip against a live server.
