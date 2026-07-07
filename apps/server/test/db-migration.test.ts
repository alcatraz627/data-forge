import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db.js';

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
