import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  type AgendaEntry,
  CAPTURE_DEFAULTS,
  CHANGES_PAGE,
  type ChangeEntry,
  type ChangesResponse,
  type CreateDocBody,
  type Doc,
  type Reminder,
  type SearchResult,
  type ServerDoc,
  type UpdateDocBody,
  type UpdateDocResponse,
  buildAgenda,
  completeReminder,
  derivePreview,
  deriveTitle,
  docFromExternal,
  isCanvas,
  isDocId,
  newId,
  nowIso,
  parseDoc,
  serializeDoc,
  snoozeReminder,
} from '@forge/core';
import { REV_KEEP, currentSeq, nextSeq, openDb, tx } from './db.js';
import { Events } from './events.js';
import { GitBatcher, git } from './gitops.js';
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
  archived: number;
  source: string;
  reminders: string;
  hash: string;
}

export type CreateResult = { ok: ServerDoc } | { error: 'id_exists' };

/** Bump when deriveTitle/derivePreview semantics change, so boot re-derives
 * the stored titles/previews for rows written under the old rules. */
const DERIVE_VERSION = '2';

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
    this.rederiveIndexedText();
  }

  /** Heals stored titles/previews written under older derivation rules (e.g.
   * canvas notes indexed before the marker earned a friendly title). Only the
   * derived index changes — the files are untouched and revs stay put — but
   * each corrected row takes a fresh seq so synced clients pull the fix
   * instead of caching the stale text forever. Runs once per DERIVE_VERSION. */
  private rederiveIndexedText(): void {
    const stamp = this.db
      .prepare("SELECT value FROM kv WHERE key = 'derive_version'")
      .get() as unknown as { value: string } | undefined;
    if (stamp?.value === DERIVE_VERSION) return;
    const rows = this.db
      .prepare('SELECT * FROM docs WHERE deleted = 0')
      .all() as unknown as DocRow[];
    for (const row of rows) {
      const body = this.headDoc(row).body;
      const title = deriveTitle(body);
      const preview = derivePreview(body);
      if (title === row.title && preview === row.preview) continue;
      tx(this.db, () => {
        const seq = nextSeq(this.db);
        this.db
          .prepare('UPDATE docs SET title = ?, preview = ?, seq = ? WHERE id = ?')
          .run(title, preview, seq, row.id);
        this.db.prepare('DELETE FROM docs_fts WHERE id = ?').run(row.id);
        this.db
          .prepare('INSERT INTO docs_fts (id, title, body) VALUES (?, ?, ?)')
          .run(row.id, title, isCanvas(body) ? '' : body);
      });
    }
    this.db
      .prepare("INSERT OR REPLACE INTO kv (key, value) VALUES ('derive_version', ?)")
      .run(DERIVE_VERSION);
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

  /** A doc's body, read from its file — the files are canonical (ADR-0001).
   * The FTS copy is NOT a body store: it deliberately omits canvas JSON
   * (review L4), so reading it back would hand out empty canvas bodies. */
  private bodyOf(row: DocRow): string {
    return this.headDoc(row).body;
  }

  /** The search index's copy of a body ('' for canvases). Only a last-resort
   * fallback for when the file itself cannot be read. */
  private ftsBodyOf(id: string): string {
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
      archived: row.archived === 1,
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
             durability, formality, importance, pinned, archived, source, reminders, hash)
           VALUES (@id, @path, @rev, @seq, 0, @title, @preview, @created, @updated,
             @durability, @formality, @importance, @pinned, @archived, @source, @reminders, @hash)
           ON CONFLICT(id) DO UPDATE SET path=@path, rev=@rev, seq=@seq, deleted=0,
             title=@title, preview=@preview, created=@created, updated=@updated,
             durability=@durability, formality=@formality, importance=@importance,
             pinned=@pinned, archived=@archived, source=@source, reminders=@reminders, hash=@hash`,
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
          archived: doc.archived ? 1 : 0,
          source: doc.source,
          reminders: JSON.stringify(doc.reminders),
          hash: sha256(fileText),
        });
      this.db.prepare('DELETE FROM docs_fts WHERE id = ?').run(doc.id);
      // A canvas body is a tldraw JSON blob; indexing it would pollute search
      // with internal keys and bloat the FTS table (review L4). Index only the
      // title for canvases.
      this.db
        .prepare('INSERT INTO docs_fts (id, title, body) VALUES (?, ?, ?)')
        .run(doc.id, deriveTitle(doc.body), isCanvas(doc.body) ? '' : doc.body);
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
      if (this.bodyOf(existing) === input.body) {
        return { ok: this.toServerDoc(existing, input.body) };
      }
      return { error: 'id_exists' };
    }
    const now = nowIso();
    const doc: Doc = {
      id,
      created: input.created ?? now,
      updated: input.updated ?? input.created ?? now,
      durability: input.durability ?? CAPTURE_DEFAULTS.durability,
      formality: input.formality ?? CAPTURE_DEFAULTS.formality,
      importance: input.importance ?? CAPTURE_DEFAULTS.importance,
      pinned: input.pinned ?? false,
      archived: input.archived ?? false,
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
    return this.toServerDoc(row, this.bodyOf(row));
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
    if (input.archived !== undefined) fields.archived = input.archived;
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
    // The surviving head keeps the reminders; the conflict copy must NOT carry
    // them, or the same reminder lives on two docs and fires twice (review M4).
    // Body + axes are preserved so the losing content is fully recoverable.
    const conflict = this.createDoc({
      body: head.body,
      source: `conflict:${id}`,
      durability: head.durability,
      formality: head.formality,
      importance: head.importance,
      pinned: head.pinned,
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
      return this.toServerDoc(row, this.ftsBodyOf(row.id));
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
            doc: this.toServerDoc(row, this.bodyOf(row)),
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

  /** The time-sorted agenda of active reminders across live notes, computed
   * server-side so the recurrence math has one home (menu bar, future push,
   * and web all consume this). */
  agenda(now: Date): AgendaEntry[] {
    const rows = this.db
      .prepare(
        "SELECT id, title, reminders FROM docs WHERE deleted = 0 AND archived = 0 AND reminders != '[]'",
      )
      .all() as unknown as Array<{ id: string; title: string; reminders: string }>;
    const docs = rows.map((r) => ({
      id: r.id,
      title: r.title,
      reminders: JSON.parse(r.reminders) as Reminder[],
    }));
    return buildAgenda(docs, now);
  }

  /** Applies a "done" to one reminder on a note (rolls a recurring reminder
   * forward, marks a one-shot done) and persists it through the normal write
   * path. Used by the menu bar; the web app does this client-side. */
  completeReminderAt(docId: string, index: number, now: Date): ServerDoc | null {
    const doc = this.getDoc(docId);
    const current = doc?.reminders[index];
    if (!doc || !current) return null;
    const next = completeReminder(current, now);
    const reminders = doc.reminders.map((r, i) => (i === index ? next : r));
    const res = this.updateDoc(docId, { baseRev: doc.rev, reminders });
    return res?.doc ?? null;
  }

  /** Snoozes one reminder to a future time and persists it, so the reminder's
   * effective fire time is the snooze target and every client (including the
   * Android scheduler) reschedules to it instead of clobbering it (review M1). */
  snoozeReminderAt(docId: string, index: number, until: Date): ServerDoc | null {
    const doc = this.getDoc(docId);
    const current = doc?.reminders[index];
    if (!doc || !current) return null;
    const next = snoozeReminder(current, until);
    const reminders = doc.reminders.map((r, i) => (i === index ? next : r));
    const res = this.updateDoc(docId, { baseRev: doc.rev, reminders });
    return res?.doc ?? null;
  }

  /** Moves stale ephemerals out of the active stream: any ephemeral note not
   * touched in `maxAgeMs` is archived (never deleted), so the inbox
   * self-cleans while capture stays consequence-free. Pinned notes and notes
   * carrying a reminder are exempt — those are deliberate keeps. Runs on boot
   * and on a timer; each archive is a normal write, so it syncs to clients. */
  archiveStale(maxAgeMs: number, nowMs: number): number {
    const rows = this.db
      .prepare(
        `SELECT * FROM docs
         WHERE deleted = 0 AND archived = 0 AND durability = 'ephemeral' AND pinned = 0`,
      )
      .all() as unknown as DocRow[];
    let archived = 0;
    for (const row of rows) {
      if (row.reminders !== '[]') continue;
      const updatedMs = new Date(row.updated).getTime();
      if (Number.isNaN(updatedMs) || nowMs - updatedMs < maxAgeMs) continue;
      const head = this.headDoc(row);
      const doc: Doc = { ...head, archived: true };
      const text = this.persist(doc, row.path);
      const { seq } = this.indexDoc(doc, row.path, text);
      this.afterWrite(seq);
      archived += 1;
    }
    return archived;
  }

  /** The commit history of one note's file, newest first. The data dir is a
   * git repo (ADR-0001), so every past version is recoverable — this exposes
   * that to the app without the client ever touching git. Pending (uncommitted)
   * edits are flushed first so the latest state shows. */
  async history(id: string): Promise<Array<{ commit: string; date: string; message: string }>> {
    const row = this.rowById(id);
    if (!row) return [];
    await this.batcher.flush();
    const out = await git(this.dataDir, 'log', '--format=%H%x1f%aI%x1f%s', '--', row.path);
    return out
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [commit, date, message] = line.split('\x1f');
        return { commit: commit ?? '', date: date ?? '', message: message ?? '' };
      });
  }

  /** The note's body as it stood at a given commit, for preview/restore. */
  async revisionAt(id: string, commit: string): Promise<string | null> {
    const row = this.rowById(id);
    if (!row || !/^[0-9a-f]{7,40}$/.test(commit)) return null;
    try {
      const text = await git(this.dataDir, 'show', `${commit}:${row.path}`);
      return parseDoc(text)?.doc.body ?? text;
    } catch {
      return null;
    }
  }

  /** Stores a binary attachment content-addressed by its sha256, so identical
   * uploads dedupe to one file and the name can never collide. Returns the
   * on-disk filename (`<hash>.<ext>`); the note body references it by URL.
   * Attachments live in the git repo alongside notes but outside the change
   * feed — they're immutable blobs, not synced docs. */
  putAttachment(bytes: Buffer, ext: string): string {
    const hash = createHash('sha256').update(bytes).digest('hex');
    const safeExt = /^[a-z0-9]{1,8}$/i.test(ext) ? ext.toLowerCase() : 'bin';
    const name = `${hash}.${safeExt}`;
    const abs = this.abs(join('attachments', name));
    this.selfWrites.mark(abs);
    mkdirSync(this.abs('attachments'), { recursive: true });
    if (!existsSync(abs)) writeFileSync(abs, bytes);
    this.batcher.markDirty();
    return name;
  }

  /** Resolves an attachment filename to its path, refusing anything that isn't
   * a bare `<hex>.<ext>` (no traversal). */
  attachmentPath(name: string): string | null {
    if (!/^[0-9a-f]{64}\.[a-z0-9]{1,8}$/i.test(name)) return null;
    const abs = this.abs(join('attachments', name));
    return existsSync(abs) ? abs : null;
  }

  flush(): Promise<void> {
    return this.batcher.flush();
  }

  close(): void {
    this.db.close();
  }
}
