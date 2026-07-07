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
    const doc = await create(fa, 'hello');
    await update(fa, doc.id, { baseRev: 1, body: 'hello from A' });
    const second = await update(fa, doc.id, { baseRev: 1, body: 'hello from B' });
    expect(second.body.merged).toBe(true);
    expect(second.body.doc.body).toBe('hello from B');
    expect(second.body.conflictDocId).toBeDefined();

    const conflict = fa.forge.getDoc(second.body.conflictDocId as string);
    expect(conflict?.body).toBe('hello from A');
    expect(conflict?.source).toBe(`conflict:${doc.id}`);
    expect(conflict?.importance).toBe('high');
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
