#!/usr/bin/env -S npx tsx
/**
 * `forge` — a small command-line front door to a running forge-server, for
 * shell use and automations. It only wraps the HTTP API (the same one every
 * client speaks), so it needs no access to the data files directly. Server
 * URL comes from FORGE_URL, defaulting to the local server.
 *
 * Usage:
 *   forge capture "a thought"        # or: echo "..." | forge capture
 *   forge search <query>
 *   forge agenda
 *   forge ls [n]
 */

const BASE = (process.env.FORGE_URL ?? 'http://localhost:5040').replace(/\/$/, '');

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status}: ${msg.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8').trim();
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);

  switch (cmd) {
    case 'capture':
    case 'c': {
      const body = rest.join(' ').trim() || (await readStdin());
      if (!body) throw new Error('nothing to capture (pass text or pipe stdin)');
      const doc = await api<{ id: string; title: string }>('/api/docs', {
        method: 'POST',
        body: JSON.stringify({ body, source: 'api:cli' }),
      });
      console.log(`captured ${doc.id}  ${doc.title}`);
      break;
    }
    case 'search':
    case 's': {
      const q = rest.join(' ');
      const { results } = await api<{
        results: Array<{ id: string; title: string; snippet: string }>;
      }>(`/api/search?q=${encodeURIComponent(q)}`);
      if (results.length === 0) console.log('no matches');
      for (const r of results) console.log(`${r.id}  ${r.title}\n    ${r.snippet}`);
      break;
    }
    case 'agenda':
    case 'a': {
      const { entries } = await api<{
        entries: Array<{ title: string; at: string; overdue: boolean }>;
      }>('/api/agenda');
      if (entries.length === 0) console.log('nothing scheduled');
      for (const e of entries) {
        const when = new Date(e.at).toLocaleString();
        console.log(`${e.overdue ? '! ' : '  '}${when}  ${e.title}`);
      }
      break;
    }
    case 'ls': {
      const n = Number(rest[0] ?? 20);
      const { changes } = await api<{
        changes: Array<{ deleted: boolean; doc?: { title: string; updated: string } }>;
      }>('/api/changes?since=0');
      const docs = changes
        .filter((c) => !c.deleted && c.doc)
        .map((c) => c.doc as { title: string; updated: string })
        .sort((a, b) => (a.updated < b.updated ? 1 : -1))
        .slice(0, n);
      for (const d of docs) console.log(`${new Date(d.updated).toLocaleDateString()}  ${d.title}`);
      break;
    }
    default:
      console.log('forge <capture|search|agenda|ls>   (server: ' + BASE + ')');
      process.exit(cmd ? 1 : 0);
  }
}

main().catch((e) => {
  console.error(`forge: ${(e as Error).message}`);
  process.exit(1);
});
