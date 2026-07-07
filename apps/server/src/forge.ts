import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  CAPTURE_DEFAULTS,
  CHANGES_PAGE,
  type ChangeEntry,
  type ChangesResponse,
  type CreateDocBody,
  type Doc,
  type SearchResult,
  type ServerDoc,
  type UpdateDocBody,
  type UpdateDocResponse,
  derivePreview,
  deriveTitle,
  docFromExternal,
  isDocId,
  newId,
  nowIso,
  parseDoc,
  serializeDoc,
} from '@forge/core';
import { REV_KEEP, currentSeq, nextSeq, openDb, tx } from './db.js';
import { Events } from './events.js';
import { GitBatcher } from './gitops.js';
import { mergeBodies } from './merge.js';
import { SelfWrites, atomicWrite, docRelPath, removeFile, sha256 } from './store.js';

interface DocRow {
  id: string;
  path: string;
  rev: number;
  seq: number;
  deleted: number;
  title: string;
  preview: string;
  created: string;
  updated: string;
  durability: string;
  formality: string;
  importance: string;
  pinned: number;
  source: string;
  reminders: string;
  hash: string;
}

export type CreateResult = { ok: ServerDoc } | { error: 'id_exists' };

/**
 * The single owner of the data directory. Every mutation flows through here:
 * file write → index update → change-feed seq → git batch → SSE nudge, so
 * clients, external editors, and git history can never disagree about what
 * happened in which order.
 */
export class Forge {
  readonly db;
  readonly events = new Events();
  readonly batcher: GitBatcher;
  readonly selfWrites = new SelfWrites();

  constructor(
    readonly dataDir: string,
    opts: { gitQuietMs?: number } = {},
  ) {
    this.db = openDb(join(dataDir, 'meta', 'index.sqlite'));
    this.batcher = new GitBatcher(dataDir, opts.gitQuietMs);
  }

  abs(rel: string): string {
    return join(this.dataDir, rel);
  }

  private rowById(id: string): DocRow | undefined {
    return this.db.prepare('SELECT * FROM docs WHERE id = ?').get(id) as unknown as
      | DocRow
      | undefined;
  }

  private rowByPath(rel: string): DocRow | undefined {
    return this.db.prepare('SELECT * FROM docs WHERE path = ?').get(rel) as unknown as
      | DocRow
      | undefined;
  }

  private bodyOf(id: string): string {
    const row = this.db.prepare('SELECT body FROM docs_fts WHERE id = ?').get(id) as unknown as
      | { body: string }
      | undefined;
    return row?.body ?? '';
  }

  private toServerDoc(row: DocRow, body: string): ServerDoc {
    return {
      id: row.id,
      created: row.created,
      updated: row.updated,
      durability: row.durability as Doc['durability'],
      formality: row.formality as Doc['formality'],
      importance: row.importance as Doc['importance'],
      pinned: row.pinned === 1,
      reminders: JSON.parse(row.reminders),
      source: row.source,
      body,
      rev: row.rev,
      title: row.title,
      preview: row.preview,
    };
  }

  /** One transaction per accepted write: docs row, search index, and the
   * merge-base snapshot move together or not at all. */
  private indexDoc(doc: Doc, relPath: string, fileText: string): { rev: number; seq: number } {
    return tx(this.db, () => {
      const prev = this.rowById(doc.id);
      const rev = (prev?.rev ?? 0) + 1;
      const seq = nextSeq(this.db);
      this.db
        .prepare(
          `INSERT INTO docs (id, path, rev, seq, deleted, title, preview, created, updated,
             durability, formality, importance, pinned, source, reminders, hash)
           VALUES (@id, @path, @rev, @seq, 0, @title, @preview, @created, @updated,
             @durability, @formality, @importance, @pinned, @source, @reminders, @hash)
           ON CONFLICT(id) DO UPDATE SET path=@path, rev=@rev, seq=@seq, deleted=0,
             title=@title, preview=@preview, created=@created, updated=@updated,
             durability=@durability, formality=@formality, importance=@importance,
             pinned=@pinned, source=@source, reminders=@reminders, hash=@hash`,
        )
        .run({
          id: doc.id,
          path: relPath,
          rev,
          seq,
          title: deriveTitle(doc.body),
          preview: derivePreview(doc.body),
          created: doc.created,
          updated: doc.updated,
          durability: doc.durability,
          formality: doc.formality,
          importance: doc.importance,
          pinned: doc.pinned ? 1 : 0,
          source: doc.source,
          reminders: JSON.stringify(doc.reminders),
          hash: sha256(fileText),
        });
      this.db.prepare('DELETE FROM docs_fts WHERE id = ?').run(doc.id);
      this.db
        .prepare('INSERT INTO docs_fts (id, title, body) VALUES (?, ?, ?)')
        .run(doc.id, deriveTitle(doc.body), doc.body);
      this.db
        .prepare('INSERT OR REPLACE INTO doc_revs (id, rev, content) VALUES (?, ?, ?)')
        .run(doc.id, rev, fileText);
      this.db.prepare('DELETE FROM doc_revs WHERE id = ? AND rev <= ?').run(doc.id, rev - REV_KEEP);
      return { rev, seq };
    });
  }

  private tombstone(id: string): number | null {
    const row = this.rowById(id);
    if (!row || row.deleted === 1) return null;
    return tx(this.db, () => {
      const seq = nextSeq(this.db);
      this.db
        .prepare('UPDATE docs SET deleted = 1, rev = rev + 1, seq = ? WHERE id = ?')
        .run(seq, id);
      this.db.prepare('DELETE FROM docs_fts WHERE id = ?').run(id);
      return seq;
    });
  }

  private persist(doc: Doc, relPath: string): string {
    const text = serializeDoc(doc);
    const abs = this.abs(relPath);
    this.selfWrites.mark(abs);
    atomicWrite(abs, text);
    return text;
  }

  private afterWrite(seq: number): void {
    this.batcher.markDirty();
    this.events.notify(seq);
  }

  createDoc(input: CreateDocBody): CreateResult {
    const id = input.id ?? newId();
    const existing = this.rowById(id);
    if (existing && existing.deleted === 0) {
      if (this.bodyOf(id) === input.body) {
        return { ok: this.toServerDoc(existing, input.body) };
      }
      return { error: 'id_exists' };
    }
    const now = nowIso();
    const doc: Doc = {
      id,
      created: now,
      updated: now,
      durability: input.durability ?? CAPTURE_DEFAULTS.durability,
      formality: input.formality ?? CAPTURE_DEFAULTS.formality,
      importance: input.importance ?? CAPTURE_DEFAULTS.importance,
      pinned: input.pinned ?? false,
      reminders: input.reminders ?? [],
      source: input.source,
      body: input.body,
    };
    const relPath = existing?.path ?? docRelPath(id);
    const text = this.persist(doc, relPath);
    const { rev, seq } = this.indexDoc(doc, relPath, text);
    this.afterWrite(seq);
    return { ok: { ...doc, rev, title: deriveTitle(doc.body), preview: derivePreview(doc.body) } };
  }

  getDoc(id: string): ServerDoc | null {
    const row = this.rowById(id);
    if (!row || row.deleted === 1) return null;
    return this.toServerDoc(row, this.bodyOf(id));
  }

  updateDoc(id: string, input: UpdateDocBody): UpdateDocResponse | null {
    const row = this.rowById(id);
    if (!row || row.deleted === 1) return null;

    const head = this.headDoc(row);
    const now = nowIso();
    const fields: Partial<Doc> = {};
    if (input.body !== undefined) fields.body = input.body;
    if (input.durability !== undefined) fields.durability = input.durability;
    if (input.formality !== undefined) fields.formality = input.formality;
    if (input.importance !== undefined) fields.importance = input.importance;
    if (input.pinned !== undefined) fields.pinned = input.pinned;
    if (input.reminders !== undefined) fields.reminders = input.reminders;

    const finish = (doc: Doc, merged: boolean, conflictDocId?: string): UpdateDocResponse => {
      const text = this.persist(doc, row.path);
      const { rev, seq } = this.indexDoc(doc, row.path, text);
      this.afterWrite(seq);
      return {
        doc: { ...doc, rev, title: deriveTitle(doc.body), preview: derivePreview(doc.body) },
        merged,
        ...(conflictDocId ? { conflictDocId } : {}),
      };
    };

    if (input.baseRev === row.rev) {
      return finish({ ...head, ...fields, updated: now }, false);
    }

    // Diverged edit. Frontmatter-only changes apply onto the newer head; body
    // changes get a real three-way merge, and a dirty merge forks the losing
    // version into a conflict doc instead of dropping either side.
    if (input.body === undefined) {
      return finish({ ...head, ...fields, updated: now }, true);
    }
    const baseRow = this.db
      .prepare('SELECT content FROM doc_revs WHERE id = ? AND rev = ?')
      .get(id, input.baseRev) as unknown as { content: string } | undefined;
    if (baseRow) {
      const baseBody = parseDoc(baseRow.content)?.doc.body ?? baseRow.content;
      const merged = mergeBodies(baseBody, head.body, input.body);
      if (merged.clean) {
        return finish({ ...head, ...fields, body: merged.text, updated: now }, true);
      }
    }
    // The losing side is preserved whole — body AND metadata. Reminders,
    // pinned state, and axes ride along or "nothing is lost" would only be
    // true of the text (M0 review, finding M1).
    const conflict = this.createDoc({
      body: head.body,
      source: `conflict:${id}`,
      durability: head.durability,
      formality: head.formality,
      importance: head.importance,
      pinned: head.pinned,
      reminders: head.reminders,
    });
    const conflictDocId = 'ok' in conflict ? conflict.ok.id : undefined;
    return finish({ ...head, ...fields, body: input.body, updated: now }, true, conflictDocId);
  }

  /** The current authoritative doc, read from the file itself (the index is
   * derived); falls back to indexed state if the file was mangled mid-edit. */
  private headDoc(row: DocRow): Doc {
    try {
      const text = readFileSync(this.abs(row.path), 'utf8');
      const parsed = parseDoc(text);
      if (parsed) return parsed.doc;
      return docFromExternal(text, row.id, row.updated);
    } catch {
      return this.toServerDoc(row, this.bodyOf(row.id));
    }
  }

  deleteDoc(id: string): boolean {
    const row = this.rowById(id);
    if (!row || row.deleted === 1) return false;
    this.selfWrites.mark(this.abs(row.path));
    removeFile(this.abs(row.path));
    const seq = this.tombstone(id);
    if (seq !== null) this.afterWrite(seq);
    return true;
  }

  changes(since: number): ChangesResponse {
    const rows = this.db
      .prepare('SELECT * FROM docs WHERE seq > ? ORDER BY seq ASC LIMIT ?')
      .all(since, CHANGES_PAGE) as unknown as DocRow[];
    const changes: ChangeEntry[] = rows.map((row) =>
      row.deleted === 1
        ? { seq: row.seq, id: row.id, rev: row.rev, deleted: true }
        : {
            seq: row.seq,
            id: row.id,
            rev: row.rev,
            deleted: false,
            doc: this.toServerDoc(row, this.bodyOf(row.id)),
          },
    );
    return { changes, latestSeq: currentSeq(this.db) };
  }

  search(q: string): SearchResult[] {
    const tokens = q
      .split(/\s+/)
      .map((t) => t.replace(/["*]/g, ''))
      .filter(Boolean);
    if (tokens.length === 0) return [];
    const match = tokens.map((t) => `"${t}"*`).join(' ');
    const rows = this.db
      .prepare(
        `SELECT id, title, snippet(docs_fts, 2, '', '', '…', 12) AS snippet
         FROM docs_fts WHERE docs_fts MATCH ? ORDER BY bm25(docs_fts) LIMIT 30`,
      )
      .all(match) as unknown as SearchResult[];
    return rows;
  }

  /** Folds a file changed outside the API (hand edit, agent, git pull) into
   * the index and change feed. Files without usable frontmatter are healed:
   * wrapped in canonical frontmatter and written back. */
  applyExternalFile(relPath: string, text: string): boolean {
    const byPath = this.rowByPath(relPath);
    if (byPath && byPath.deleted === 0 && byPath.hash === sha256(text)) return false;

    const parsed = parseDoc(text);
    if (parsed) {
      const other = this.rowById(parsed.doc.id);
      if (
        other &&
        other.path !== relPath &&
        other.deleted === 0 &&
        existsSync(this.abs(other.path))
      ) {
        console.warn(
          `skipping ${relPath}: duplicate id ${parsed.doc.id} (already at ${other.path})`,
        );
        return false;
      }
      const { seq } = this.indexDoc(parsed.doc, relPath, text);
      this.afterWrite(seq);
      return true;
    }

    const stem = basename(relPath, '.md');
    const id = isDocId(stem) && !this.rowById(stem) ? stem : newId();
    const doc = docFromExternal(text, id, nowIso());
    const canonical = this.persist(doc, relPath);
    const { seq } = this.indexDoc(doc, relPath, canonical);
    this.afterWrite(seq);
    return true;
  }

  handleExternalUnlink(relPath: string): void {
    const row = this.rowByPath(relPath);
    if (!row || row.deleted === 1) return;
    const seq = this.tombstone(row.id);
    if (seq !== null) this.afterWrite(seq);
  }

  /** Boot-time reconciliation: index what the watcher missed while the server
   * was down, in both directions (new/changed files in, tombstones for files
   * that vanished). Keeps the index honestly derived (ADR-0001). */
  reconcile(): { files: number; changed: number; removed: number } {
    const notesDir = this.abs('notes');
    let files = 0;
    let changed = 0;
    if (existsSync(notesDir)) {
      const entries = readdirSync(notesDir, { recursive: true }) as string[];
      for (const entry of entries) {
        if (!entry.endsWith('.md') || entry.includes('.tmp-')) continue;
        files += 1;
        const rel = join('notes', entry);
        try {
          if (this.applyExternalFile(rel, readFileSync(this.abs(rel), 'utf8'))) changed += 1;
        } catch (e) {
          console.error(`reconcile: failed on ${rel}:`, e);
        }
      }
    }
    let removed = 0;
    const live = this.db
      .prepare('SELECT id, path FROM docs WHERE deleted = 0')
      .all() as unknown as Pick<DocRow, 'id' | 'path'>[];
    for (const row of live) {
      if (!existsSync(this.abs(row.path))) {
        const seq = this.tombstone(row.id);
        if (seq !== null) this.afterWrite(seq);
        removed += 1;
      }
    }
    return { files, changed, removed };
  }

  flush(): Promise<void> {
    return this.batcher.flush();
  }

  close(): void {
    this.db.close();
  }
}
