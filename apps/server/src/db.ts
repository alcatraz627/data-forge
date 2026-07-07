import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

/**
 * The derived index over the note files: fast queries, full-text search, and
 * the change feed that drives sync. Everything here is rebuildable from the
 * files (ADR-0001) — deleting meta/index.sqlite loses nothing but a reindex.
 * Uses the runtime's built-in SQLite, so the server has zero native deps.
 */
export function openDb(path: string): Db {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS docs (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      rev INTEGER NOT NULL,
      seq INTEGER NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0,
      title TEXT NOT NULL DEFAULT '',
      preview TEXT NOT NULL DEFAULT '',
      created TEXT NOT NULL DEFAULT '',
      updated TEXT NOT NULL DEFAULT '',
      durability TEXT NOT NULL,
      formality TEXT NOT NULL,
      importance TEXT NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT '',
      reminders TEXT NOT NULL DEFAULT '[]',
      hash TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS docs_seq ON docs(seq);
    CREATE INDEX IF NOT EXISTS docs_path ON docs(path);
    CREATE TABLE IF NOT EXISTS doc_revs (
      id TEXT NOT NULL,
      rev INTEGER NOT NULL,
      content TEXT NOT NULL,
      PRIMARY KEY (id, rev)
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(id UNINDEXED, title, body);
    CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT OR IGNORE INTO kv (key, value) VALUES ('seq', '0');
  `);
  migrateColumns(db);
  return db;
}

/** Additive column migration for an index created by an older build. The
 * index is derived and rebuildable (ADR-0001), but rebuilding would reset the
 * change-feed seq and force every client to re-pull; adding the missing column
 * in place preserves the seq and all merge bases. Each entry is (column,
 * full definition); a column already present is skipped. */
const EXPECTED_COLUMNS: Array<[string, string]> = [
  ['archived', 'archived INTEGER NOT NULL DEFAULT 0'],
];

function migrateColumns(db: Db): void {
  const have = new Set(
    (db.prepare('PRAGMA table_info(docs)').all() as unknown as Array<{ name: string }>).map(
      (r) => r.name,
    ),
  );
  for (const [name, def] of EXPECTED_COLUMNS) {
    if (!have.has(name)) db.exec(`ALTER TABLE docs ADD COLUMN ${def}`);
  }
}

/** Runs fn atomically; node:sqlite has no transaction helper of its own. */
export function tx<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function currentSeq(db: Db): number {
  const row = db.prepare("SELECT value FROM kv WHERE key = 'seq'").get() as unknown as {
    value: string;
  };
  return Number(row.value);
}

/** Allocates the next global sequence number. Call inside a transaction. */
export function nextSeq(db: Db): number {
  const seq = currentSeq(db) + 1;
  db.prepare("UPDATE kv SET value = ? WHERE key = 'seq'").run(String(seq));
  return seq;
}

/** How many revisions of each doc to keep as merge bases. Old bases beyond
 * this window force the conservative conflict path instead of a clean merge —
 * acceptable, never lossy. */
export const REV_KEEP = 20;
