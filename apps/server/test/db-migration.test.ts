import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { emptyCanvasBody } from '@forge/core';
import { describe, expect, it } from 'vitest';
import { createForgeApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { Forge } from '../src/forge.js';

/** An index written by a build predating the `archived` column must be
 * migrated in place, not rebuilt — rebuilding would reset the change-feed
 * seq and force every client to re-pull. This reproduces the "SQL logic
 * error" boot crash found when the live index lacked the column. */
describe('additive column migration', () => {
  it('adds a missing column to a pre-existing docs table and preserves rows', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'forge-mig-')), 'index.sqlite');

    const old = new DatabaseSync(path);
    old.exec(`
      CREATE TABLE docs (
        id TEXT PRIMARY KEY, path TEXT NOT NULL, rev INTEGER NOT NULL,
        seq INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0,
        title TEXT NOT NULL DEFAULT '', preview TEXT NOT NULL DEFAULT '',
        created TEXT NOT NULL DEFAULT '', updated TEXT NOT NULL DEFAULT '',
        durability TEXT NOT NULL, formality TEXT NOT NULL, importance TEXT NOT NULL,
        pinned INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT '',
        reminders TEXT NOT NULL DEFAULT '[]', hash TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO kv (key, value) VALUES ('seq', '42');
      INSERT INTO docs (id, path, rev, seq, durability, formality, importance)
        VALUES ('01OLD', 'notes/x.md', 3, 42, 'ephemeral', 'scratch', 'normal');
    `);
    old.close();

    const db = openDb(path);
    // The new column exists and inserts that reference it now succeed.
    const cols = (
      db.prepare('PRAGMA table_info(docs)').all() as unknown as Array<{ name: string }>
    ).map((r) => r.name);
    expect(cols).toContain('archived');

    const row = db
      .prepare('SELECT archived, rev FROM docs WHERE id = ?')
      .get('01OLD') as unknown as {
      archived: number;
      rev: number;
    };
    expect(row.archived).toBe(0);
    expect(row.rev).toBe(3);
    const seq = db.prepare("SELECT value FROM kv WHERE key = 'seq'").get() as unknown as {
      value: string;
    };
    expect(seq.value).toBe('42');
    db.close();
  });
});

/** Titles/previews are derived data stored in the index at write time, so
 * rows written before a derivation change keep the old text (the live bug:
 * canvas notes titled with their raw marker). Boot must re-derive stale rows
 * AND bump their seq — without the seq bump, synced clients never see the
 * corrected title. */
describe('boot re-derivation of stored titles', () => {
  it('heals stale titles through the change feed on reopen', async () => {
    const dataDir = join(mkdtempSync(join(tmpdir(), 'forge-rederive-')), 'data');
    const { forge } = await createForgeApp({ dataDir, gitQuietMs: 600_000 });
    const created = forge.createDoc({ body: emptyCanvasBody(), source: 'test' });
    if (!('ok' in created)) throw new Error('create failed');
    const id = created.ok.id;

    // Simulate a row written by an old build: raw marker as title, JSON as
    // preview, and no derive stamp.
    forge.db
      .prepare("UPDATE docs SET title = '<!-- forge:canvas v1 -->', preview = '{}' WHERE id = ?")
      .run(id);
    forge.db.prepare("DELETE FROM kv WHERE key = 'derive_version'").run();
    const staleSeq = (
      forge.db.prepare('SELECT seq FROM docs WHERE id = ?').get(id) as unknown as { seq: number }
    ).seq;

    const reopened = new Forge(dataDir, { gitQuietMs: 600_000 });
    const row = reopened.db
      .prepare('SELECT title, preview, seq FROM docs WHERE id = ?')
      .get(id) as unknown as { title: string; preview: string; seq: number };
    expect(row.title).toBe('Canvas');
    expect(row.preview).toBe('');
    expect(row.seq).toBeGreaterThan(staleSeq);

    // A client synced to the stale seq pulls the corrected doc.
    const feed = reopened.changes(staleSeq);
    const entry = feed.changes.find((c) => c.id === id);
    expect(entry?.doc?.title).toBe('Canvas');

    // Second boot with a current stamp is a no-op (no seq churn).
    const seqAfter = reopened.db
      .prepare('SELECT seq FROM docs WHERE id = ?')
      .get(id) as unknown as { seq: number };
    const again = new Forge(dataDir, { gitQuietMs: 600_000 });
    const rowAgain = again.db.prepare('SELECT seq FROM docs WHERE id = ?').get(id) as unknown as {
      seq: number;
    };
    expect(rowAgain.seq).toBe(seqAfter.seq);
  });
});
