#!/usr/bin/env -S npx tsx
/**
 * Data Forge MCP server: lets Claude read and write your notes as tools. It's
 * a thin bridge over the forge-server HTTP API — no direct file access — so it
 * respects the same validation and sync as every other client. Launched over
 * stdio by an MCP host (Claude Code / Desktop); point it at the server with
 * FORGE_URL.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BASE = (process.env.FORGE_URL ?? 'http://localhost:5040').replace(/\/$/, '');

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  if (!res.ok) throw new Error(`forge ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

const text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] });

const server = new McpServer({ name: 'data-forge', version: '0.1.0' });

server.tool(
  'search_notes',
  "Full-text search the user's Data Forge notes. Returns matching note ids, titles, and snippets.",
  { query: z.string().describe('search terms') },
  async ({ query }) => {
    const { results } = await api<{
      results: Array<{ id: string; title: string; snippet: string }>;
    }>(`/api/search?q=${encodeURIComponent(query)}`);
    if (results.length === 0) return text('No matching notes.');
    return text(results.map((r) => `${r.id}\t${r.title}\n\t${r.snippet}`).join('\n'));
  },
);

server.tool(
  'create_note',
  "Create a new note in Data Forge. It syncs to all the user's devices.",
  { body: z.string().describe('the note content, markdown allowed') },
  async ({ body }) => {
    // Post to the ungated /api/docs, not the token-gated /api/inbox, so
    // create_note keeps working when the inbox token is set (review L2).
    const doc = await api<{ id: string; title: string }>('/api/docs', {
      method: 'POST',
      body: JSON.stringify({ body, source: 'api:claude' }),
    });
    return text(`Created note ${doc.id} — ${doc.title}`);
  },
);

server.tool('get_note', 'Read one note by id.', { id: z.string() }, async ({ id }) => {
  const doc = await api<{ title: string; body: string }>(`/api/docs/${id}`);
  return text(`# ${doc.title}\n\n${doc.body}`);
});

server.tool(
  'list_agenda',
  "List the user's upcoming and overdue reminders, soonest first.",
  {},
  async () => {
    const { entries } = await api<{
      entries: Array<{
        docId: string;
        reminderIndex: number;
        title: string;
        at: string;
        overdue: boolean;
      }>;
    }>('/api/agenda');
    if (entries.length === 0) return text('Nothing scheduled.');
    return text(
      entries
        .map(
          (e) =>
            `${e.overdue ? '[overdue] ' : ''}${e.at}\t${e.title}\t(${e.docId}#${e.reminderIndex})`,
        )
        .join('\n'),
    );
  },
);

server.tool(
  'complete_reminder',
  'Mark a reminder done (recurring ones roll forward). Use ids from list_agenda.',
  { docId: z.string(), reminderIndex: z.number().int().min(0) },
  async ({ docId, reminderIndex }) => {
    await api(`/api/reminders/complete?doc=${docId}&index=${reminderIndex}`, { method: 'POST' });
    return text('Done.');
  },
);

await server.connect(new StdioServerTransport());
