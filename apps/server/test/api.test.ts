import { mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { type ServerDoc, type UpdateDocResponse, newId, nowIso, serializeDoc } from '@forge/core';
import { describe, expect, it } from 'vitest';
import { type ForgeApp, createForgeApp } from '../src/app.js';
import { git } from '../src/gitops.js';
import { docRelPath } from '../src/store.js';

async function makeApp(): Promise<ForgeApp> {
  const dataDir = join(mkdtempSync(join(tmpdir(), 'forge-api-')), 'data');
  return createForgeApp({ dataDir, gitQuietMs: 600_000 });
}

const HEADERS = { 'content-type': 'application/json' };

async function create(fa: ForgeApp, body: string, extra: object = {}): Promise<ServerDoc> {
  const res = await fa.app.request('/api/docs', {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ body, source: 'test', ...extra }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as ServerDoc;
}

async function update(
  fa: ForgeApp,
  id: string,
  patch: object,
): Promise<{ status: number; body: UpdateDocResponse }> {
  const res = await fa.app.request(`/api/docs/${id}`, {
    method: 'PUT',
    headers: HEADERS,
    body: JSON.stringify(patch),
  });
  return { status: res.status, body: (await res.json()) as UpdateDocResponse };
}

describe('doc lifecycle over the API', () => {
  it('creates, reads, lists, searches, updates, deletes', async () => {
    const fa = await makeApp();

    const doc = await create(fa, '# Groceries\nbuy milk and eggs');
    expect(doc.rev).toBe(1);
    expect(doc.title).toBe('Groceries');
    expect(doc.durability).toBe('ephemeral');

    const got = (await (await fa.app.request(`/api/docs/${doc.id}`)).json()) as ServerDoc;
    expect(got.body).toBe('# Groceries\nbuy milk and eggs');

    const changes = await (await fa.app.request('/api/changes?since=0')).json();
    expect(changes.changes).toHaveLength(1);
    expect(changes.changes[0].doc.id).toBe(doc.id);

    const found = await (await fa.app.request('/api/search?q=milk')).json();
    expect(found.results.map((r: { id: string }) => r.id)).toContain(doc.id);

    const upd = await update(fa, doc.id, { baseRev: 1, body: '# Groceries\nbuy oat milk' });
    expect(upd.status).toBe(200);
    expect(upd.body.doc.rev).toBe(2);
    expect(upd.body.merged).toBe(false);

    const del = await fa.app.request(`/api/docs/${doc.id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    const after = await (await fa.app.request(`/api/changes?since=${changes.latestSeq}`)).json();
    const tomb = after.changes.find((e: { id: string }) => e.id === doc.id);
    expect(tomb.deleted).toBe(true);

    const file = join(fa.forge.dataDir, docRelPath(doc.id));
    expect(() => readFileSync(file)).toThrow();
  });

  it('rejects invalid input', async () => {
    const fa = await makeApp();
    const bad = async (payload: object) =>
      (
        await fa.app.request('/api/docs', {
          method: 'POST',
          headers: HEADERS,
          body: JSON.stringify(payload),
        })
      ).status;
    expect(await bad({ source: 'test' })).toBe(400);
    expect(await bad({ body: '   ', source: 'test' })).toBe(400);
    expect(await bad({ body: 'x', source: 'bad source with spaces' })).toBe(400);
    expect(await bad({ body: 'x', source: 'test', durability: 'forever' })).toBe(400);
    expect(await bad({ body: 'x', source: 'test', id: 'not-a-ulid' })).toBe(400);
  });

  it('treats a retried create with the same id and body as idempotent', async () => {
    const fa = await makeApp();
    const id = newId();
    const first = await create(fa, 'offline note', { id });
    const res = await fa.app.request('/api/docs', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ id, body: 'offline note', source: 'test' }),
    });
    expect(res.status).toBe(201);
    expect(((await res.json()) as ServerDoc).rev).toBe(first.rev);

    const clash = await fa.app.request('/api/docs', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ id, body: 'different content', source: 'test' }),
    });
    expect(clash.status).toBe(409);
  });
});

describe('diverged edits', () => {
  it('merges non-overlapping stale edits cleanly', async () => {
    const fa = await makeApp();
    const doc = await create(fa, 'alpha\nbeta\ngamma');
    await update(fa, doc.id, { baseRev: 1, body: 'ALPHA\nbeta\ngamma' });
    const second = await update(fa, doc.id, { baseRev: 1, body: 'alpha\nbeta\nGAMMA' });
    expect(second.body.merged).toBe(true);
    expect(second.body.conflictDocId).toBeUndefined();
    expect(second.body.doc.body).toBe('ALPHA\nbeta\nGAMMA');
    expect(second.body.doc.rev).toBe(3);
  });

  it('forks a conflict doc on overlapping stale edits, losing nothing', async () => {
    const fa = await makeApp();
    const reminder = { at: '2026-07-09T09:00:00+05:30', status: 'active' };
    const doc = await create(fa, 'hello', {
      importance: 'critical',
      pinned: true,
      reminders: [reminder],
    });
    await update(fa, doc.id, { baseRev: 1, body: 'hello from A' });
    const second = await update(fa, doc.id, { baseRev: 1, body: 'hello from B' });
    expect(second.body.merged).toBe(true);
    expect(second.body.doc.body).toBe('hello from B');
    expect(second.body.conflictDocId).toBeDefined();

    // The losing side survives whole: body + axes + pinned. But NOT reminders —
    // the surviving head keeps those, so the reminder never lives on two docs
    // and can't fire twice (review M4).
    const conflict = fa.forge.getDoc(second.body.conflictDocId as string);
    expect(conflict?.body).toBe('hello from A');
    expect(conflict?.source).toBe(`conflict:${doc.id}`);
    expect(conflict?.importance).toBe('critical');
    expect(conflict?.pinned).toBe(true);
    expect(conflict?.reminders).toEqual([]);
    // The head still carries the reminder.
    expect(fa.forge.getDoc(doc.id)?.reminders).toEqual([reminder]);
  });

  it('accepts a canvas body larger than the 1MB prose cap', async () => {
    const fa = await makeApp();
    const big = `<!-- forge:canvas v1 -->\n{"blob":"${'x'.repeat(2_000_000)}"}`;
    const res = await fa.app.request('/api/docs', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ body: big, source: 'test' }),
    });
    expect(res.status).toBe(201);
    // A 2MB plain-text (non-canvas) body is still rejected.
    const prose = await fa.app.request('/api/docs', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ body: 'x'.repeat(2_000_000), source: 'test' }),
    });
    expect(prose.status).toBe(400);
  });

  it('applies frontmatter-only stale updates without touching the newer body', async () => {
    const fa = await makeApp();
    const doc = await create(fa, 'original');
    await update(fa, doc.id, { baseRev: 1, body: 'newer body' });
    const res = await update(fa, doc.id, { baseRev: 1, importance: 'critical' });
    expect(res.body.merged).toBe(true);
    expect(res.body.doc.body).toBe('newer body');
    expect(res.body.doc.importance).toBe('critical');
  });
});

describe('external edits', () => {
  it('indexes a well-formed file dropped into the tree', async () => {
    const fa = await makeApp();
    const id = newId();
    const rel = docRelPath(id);
    const abs = join(fa.forge.dataDir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    const now = nowIso();
    writeFileSync(
      abs,
      serializeDoc({
        id,
        created: now,
        updated: now,
        durability: 'durable',
        formality: 'polished',
        importance: 'normal',
        pinned: false,
        reminders: [],
        source: 'api:claude',
        body: '# Dropped in\nby an external agent',
      }),
    );
    fa.forge.applyExternalFile(rel, readFileSync(abs, 'utf8'));
    const doc = fa.forge.getDoc(id);
    expect(doc?.title).toBe('Dropped in');
    expect(doc?.durability).toBe('durable');
  });

  it('heals a frontmatter-less file into a canonical doc', async () => {
    const fa = await makeApp();
    const rel = join('notes', '2026', '07', 'loose-thought.md');
    const abs = join(fa.forge.dataDir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, 'just a loose thought\n');
    fa.forge.applyExternalFile(rel, 'just a loose thought\n');

    const healed = readFileSync(abs, 'utf8');
    expect(healed.startsWith('---\n')).toBe(true);
    const changes = fa.forge.changes(0);
    const entry = changes.changes.find((e) => e.doc?.body === 'just a loose thought');
    expect(entry).toBeDefined();
    expect(entry?.doc?.source).toBe('external');
  });

  it('reconcile tombstones docs whose files vanished', async () => {
    const fa = await makeApp();
    const doc = await create(fa, 'to be removed on disk');
    unlinkSync(join(fa.forge.dataDir, docRelPath(doc.id)));
    const counts = fa.forge.reconcile();
    expect(counts.removed).toBe(1);
    expect(fa.forge.getDoc(doc.id)).toBeNull();
  });
});

describe('auto-archive sweep', () => {
  // Rewrites a note's file with an older `updated`, reindexing both file and
  // index so the doc is genuinely stale end-to-end (not just in the index).
  const backdate = (fa: ForgeApp, id: string, iso: string): void => {
    const rel = docRelPath(id);
    const text = readFileSync(join(fa.forge.dataDir, rel), 'utf8').replace(
      /^updated: .*$/m,
      `updated: ${iso}`,
    );
    writeFileSync(join(fa.forge.dataDir, rel), text);
    fa.forge.applyExternalFile(rel, text);
  };

  it('archives stale ephemerals but spares fresh, pinned, reminded, and durable notes', async () => {
    const fa = await makeApp();
    const stale = await create(fa, 'old scratch');
    const pinned = await create(fa, 'old but pinned', { pinned: true });
    const reminded = await create(fa, 'old with reminder', {
      reminders: [{ at: '2026-08-01T09:00:00+05:30', status: 'active' }],
    });
    const durable = await create(fa, 'kept reference', { durability: 'durable' });
    const fresh = await create(fa, 'just now');

    const old = '2026-05-01T09:00:00+05:30';
    for (const id of [stale.id, pinned.id, reminded.id, durable.id]) backdate(fa, id, old);

    const n = fa.forge.archiveStale(30 * 86_400_000, Date.parse('2026-07-07T09:00:00+05:30'));
    expect(n).toBe(1);
    expect(fa.forge.getDoc(stale.id)?.archived).toBe(true);
    expect(fa.forge.getDoc(pinned.id)?.archived).toBe(false);
    expect(fa.forge.getDoc(reminded.id)?.archived).toBe(false);
    expect(fa.forge.getDoc(durable.id)?.archived).toBe(false);
    expect(fa.forge.getDoc(fresh.id)?.archived).toBe(false);

    // Archiving preserves updated (it isn't a user edit) and is idempotent.
    expect(fa.forge.getDoc(stale.id)?.updated).toBe(old);
    expect(fa.forge.archiveStale(30 * 86_400_000, Date.parse('2026-07-07T09:00:00+05:30'))).toBe(0);
  });
});

describe('inbox webhook', () => {
  it('creates a note from a one-field POST', async () => {
    const fa = await makeApp();
    const res = await fa.app.request('/api/inbox', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ text: 'from an automation' }),
    });
    expect(res.status).toBe(201);
    const doc = (await res.json()) as ServerDoc;
    expect(doc.body).toBe('from an automation');
    expect(doc.source).toBe('api:inbox');
    expect(
      (await fa.app.request('/api/inbox', { method: 'POST', headers: HEADERS, body: '{}' })).status,
    ).toBe(400);
  });

  it('enforces a bearer token when one is configured', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'forge-inbox-')), 'data');
    const fa = await createForgeApp({ dataDir: dir, gitQuietMs: 600_000, inboxToken: 'secret' });
    const noAuth = await fa.app.request('/api/inbox', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ text: 'x' }),
    });
    expect(noAuth.status).toBe(401);
    const withAuth = await fa.app.request('/api/inbox', {
      method: 'POST',
      headers: { ...HEADERS, authorization: 'Bearer secret' },
      body: JSON.stringify({ text: 'x' }),
    });
    expect(withAuth.status).toBe(201);
  });
});

describe('attachments', () => {
  it('stores content-addressed, serves back the exact bytes, and dedupes', async () => {
    const fa = await makeApp();
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5]);

    const up = await fa.app.request('/api/attachments?ext=png', {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: bytes,
    });
    expect(up.status).toBe(201);
    const { name, url } = (await up.json()) as { name: string; url: string };
    expect(name).toMatch(/^[0-9a-f]{64}\.png$/);

    const got = await fa.app.request(url);
    expect(got.status).toBe(200);
    expect(got.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(bytes);

    // Same bytes -> same hash -> same name (dedup).
    const again = await fa.app.request('/api/attachments?ext=png', {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: bytes,
    });
    expect(((await again.json()) as { name: string }).name).toBe(name);
  });

  it('rejects empty uploads and path-traversal names', async () => {
    const fa = await makeApp();
    const empty = await fa.app.request('/api/attachments', {
      method: 'POST',
      body: new Uint8Array(),
    });
    expect(empty.status).toBe(400);
    expect((await fa.app.request('/api/attachments/..%2f..%2fetc%2fpasswd')).status).toBe(404);
  });
});

describe('per-note history', () => {
  it('lists commits for a note and reads its body at an old revision', async () => {
    const fa = await makeApp();
    const doc = await create(fa, 'version one');
    await fa.forge.flush();
    await update(fa, doc.id, { baseRev: 1, body: 'version two' });
    await fa.forge.flush();

    const hist = await (await fa.app.request(`/api/docs/${doc.id}/history`)).json();
    expect(hist.history.length).toBeGreaterThanOrEqual(2);

    // Oldest commit holds the original body.
    const oldest = hist.history[hist.history.length - 1].commit;
    const rev = await (await fa.app.request(`/api/docs/${doc.id}/history/${oldest}`)).json();
    expect(rev.body).toBe('version one');
  });

  it('rejects a malformed commit ref', async () => {
    const fa = await makeApp();
    const doc = await create(fa, 'x');
    const res = await fa.app.request(`/api/docs/${doc.id}/history/not-a-hash`);
    expect(res.status).toBe(404);
  });
});

describe('agenda + reminder endpoints', () => {
  it('serves an agenda and completes a reminder over HTTP', async () => {
    const fa = await makeApp();
    await create(fa, 'far future', {
      reminders: [{ at: '2027-01-01T09:00:00+05:30', status: 'active' }],
    });
    const due = await create(fa, 'due soon', {
      reminders: [{ at: new Date(Date.now() + 3_600_000).toISOString(), status: 'active' }],
    });

    const agenda = await (await fa.app.request('/api/agenda')).json();
    // far-future reminder is beyond the 30-day horizon; only "due soon" shows.
    expect(agenda.entries).toHaveLength(1);
    expect(agenda.entries[0].docId).toBe(due.id);

    const res = await fa.app.request(`/api/reminders/complete?doc=${due.id}&index=0`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const doc = (await res.json()) as ServerDoc;
    expect(doc.reminders[0]?.status).toBe('done');

    const after = await (await fa.app.request('/api/agenda')).json();
    expect(after.entries).toHaveLength(0);
  });

  it('rejects bad complete params', async () => {
    const fa = await makeApp();
    expect(
      (await fa.app.request('/api/reminders/complete?index=0', { method: 'POST' })).status,
    ).toBe(400);
    const missing = await fa.app.request('/api/reminders/complete?doc=01MISSING&index=0', {
      method: 'POST',
    });
    expect(missing.status).toBe(404);
  });
});

describe('git batching', () => {
  it('commits accepted writes and leaves the repo clean', async () => {
    const fa = await makeApp();
    await create(fa, 'first');
    await create(fa, 'second');
    await fa.forge.flush();
    const log = await git(fa.forge.dataDir, 'log', '--oneline');
    expect(log.split('\n').filter(Boolean).length).toBeGreaterThanOrEqual(2);
    const status = await git(fa.forge.dataDir, 'status', '--porcelain');
    expect(status.trim()).toBe('');
  });
});
