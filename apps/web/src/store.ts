import {
  CAPTURE_DEFAULTS,
  type CreateDocBody,
  type Reminder,
  type ServerDoc,
  type SyncStore,
  type UpdateDocBody,
  completeReminder,
  derivePreview,
  deriveTitle,
  docTags,
  drainOutbox,
  emptyCanvasBody,
  enqueueCreate,
  enqueueDelete,
  enqueueUpdate,
  hasCanvasBlock,
  isLegacyCanvas,
  newId,
  nowIso,
  pullToHead,
  snoozeReminder,
} from '@forge/core';
import { useSyncExternalStore } from 'react';
import * as api from './api';
import { db, getCursor, outboxStore, setCursor } from './db';

/**
 * Client state: the full corpus mirrored in memory for instant reads, backed
 * by IndexedDB so it survives restarts, with every mutation going local-first
 * through the offline outbox. The server is eventually consistent with us,
 * not the other way around.
 */

/** A transient status message; `action` (e.g. Undo) renders as a button. */
export interface Notice {
  text: string;
  action?: { label: string; run: () => void };
}

export interface Snapshot {
  docs: ServerDoc[];
  connected: boolean;
  pending: number;
  notice: Notice | null;
  loaded: boolean;
}

const byId = new Map<string, ServerDoc>();
let connected = false;
let pending = 0;
let notice: Notice | null = null;
let loaded = false;
let snapshot: Snapshot = { docs: [], connected, pending, notice, loaded };
const listeners = new Set<() => void>();

function rebuild(): void {
  const docs = [...byId.values()].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return a.updated < b.updated ? 1 : -1;
  });
  snapshot = { docs, connected, pending, notice, loaded };
  for (const l of listeners) l();
}

export function useForge(): Snapshot {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => snapshot,
  );
}

let noticeTimer: ReturnType<typeof setTimeout> | undefined;

export function flashNotice(text: string, action?: Notice['action']): void {
  notice = { text, action };
  rebuild();
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(
    () => {
      notice = null;
      rebuild();
    },
    action ? UNDO_WINDOW_MS : 5000,
  );
}

export function clearNotice(): void {
  clearTimeout(noticeTimer);
  notice = null;
  rebuild();
}

async function refreshPending(): Promise<void> {
  pending = await db.outbox.count();
}

async function putLocal(doc: ServerDoc): Promise<void> {
  byId.set(doc.id, doc);
  await db.docs.put(doc);
}

const syncStore: SyncStore = {
  getCursor,
  setCursor,
  applyChanges: async (entries) => {
    for (const e of entries) {
      if (e.deleted) {
        byId.delete(e.id);
        await db.docs.delete(e.id);
      } else if (e.doc) {
        await putLocal(e.doc);
      }
    }
  },
};

let pulling = false;
let pullAgain = false;

async function pull(): Promise<void> {
  if (pulling) {
    pullAgain = true;
    return;
  }
  pulling = true;
  try {
    await pullToHead(api.transport, syncStore);
    loaded = true;
  } catch {
    // transient network failure; the next nudge or reconnect re-pulls
  } finally {
    pulling = false;
    rebuild();
    if (pullAgain) {
      pullAgain = false;
      void pull();
    }
  }
}

let draining = false;

/** Drain-then-pull: queued local writes go out before we take the server's
 * word for doc state, so reconnecting never visually reverts an offline
 * edit that is about to win anyway. */
async function drainThenPull(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    await drainOutbox(outboxStore, api.drainTransport, {
      restoreSource: 'web',
      onDocSynced: async (doc, outcome) => {
        await putLocal(doc);
        if (outcome.conflictDocId)
          flashNotice('Diverged edits: the previous version was kept as a conflict note');
        else if (outcome.merged) flashNotice('Merged with a newer version of this note');
      },
      onDropped: async (op, reason) => {
        flashNotice(`An offline ${op.kind} could not be applied (${reason})`);
      },
    });
  } finally {
    draining = false;
    await refreshPending();
    rebuild();
  }
  await pull();
}

export function startSync(): () => void {
  void (async () => {
    const cached = await db.docs.toArray();
    for (const doc of cached) byId.set(doc.id, doc);
    await refreshPending();
    loaded = cached.length > 0 || loaded;
    rebuild();
    await drainThenPull();
  })();

  const onOnline = (): void => void drainThenPull();
  // The SSE socket only errors when TCP actually breaks, which can lag a
  // radio loss by its whole heartbeat window — the browser's own signal
  // flips the readout to OFFLINE immediately.
  const onOffline = (): void => {
    connected = false;
    rebuild();
  };
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  const unsubscribe = api.subscribeEvents(
    () => void pull(),
    (ok) => {
      connected = ok;
      rebuild();
      if (ok) void drainThenPull();
    },
  );
  return () => {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
    unsubscribe();
  };
}

export async function captureNote(input: Omit<CreateDocBody, 'source' | 'id'>): Promise<void> {
  const now = nowIso();
  const doc: ServerDoc = {
    id: newId(),
    created: now,
    updated: now,
    durability: input.durability ?? CAPTURE_DEFAULTS.durability,
    formality: input.formality ?? CAPTURE_DEFAULTS.formality,
    importance: input.importance ?? CAPTURE_DEFAULTS.importance,
    pinned: input.pinned ?? false,
    archived: false,
    reminders: input.reminders ?? [],
    source: 'web',
    tags: input.tags ?? [],
    body: input.body,
    rev: 0,
    title: deriveTitle(input.body),
    preview: derivePreview(input.body),
  };
  await putLocal(doc);
  await enqueueCreate(outboxStore, { ...input, id: doc.id, source: 'web' });
  await refreshPending();
  rebuild();
  void drainThenPull();
}

/** Creates an empty canvas note (a deliberate artifact, so it lands as
 * working/draft rather than ephemeral scratch) and returns it to open. */
export async function captureCanvas(): Promise<ServerDoc> {
  const now = nowIso();
  const id = newId();
  const doc: ServerDoc = {
    id,
    created: now,
    updated: now,
    durability: 'working',
    formality: 'draft',
    importance: 'normal',
    pinned: false,
    archived: false,
    reminders: [],
    source: 'web',
    tags: [],
    body: emptyCanvasBody(),
    rev: 0,
    title: 'Canvas',
    preview: '',
  };
  await putLocal(doc);
  await enqueueCreate(outboxStore, {
    id,
    body: doc.body,
    source: 'web',
    durability: 'working',
    formality: 'draft',
  });
  await refreshPending();
  rebuild();
  void drainThenPull();
  return doc;
}

/** Saves an edit and returns the note's rev once the write settles, so the
 * editor can advance its base and a second save in the same session is a clean
 * base==head write rather than a self-merge that forks a spurious conflict
 * (M1-M5 review, H3). Returns the prior base when offline (the edit stays
 * queued and coalesces). */
export async function saveDoc(
  id: string,
  baseRev: number,
  patch: Omit<UpdateDocBody, 'baseRev'>,
): Promise<number> {
  const known = byId.get(id);
  if (known) {
    const body = patch.body ?? known.body;
    await putLocal({
      ...known,
      ...patch,
      body,
      title: deriveTitle(body),
      preview: derivePreview(body),
      updated: nowIso(),
    });
  }
  // A note opened before its create synced carries baseRev 0; the server
  // requires baseRev >= 1. A brand-new note's create always yields rev 1, and
  // any higher rev came from another device — so base 1 forces the correct
  // three-way merge instead of overwriting that edit (review M3). While the
  // create is still queued the outbox folds this edit into it and base is moot.
  const effectiveBase = baseRev >= 1 ? baseRev : 1;
  await enqueueUpdate(outboxStore, id, effectiveBase, patch);
  await refreshPending();
  rebuild();
  await drainThenPull();
  return byId.get(id)?.rev ?? effectiveBase;
}

/** Applies a done/snooze action to one reminder on a note and saves. The
 * reminders array is the unit of edit; core decides how the action mutates it
 * (roll a recurring reminder forward, mark a one-shot done, set a snooze). */
export async function actOnReminder(
  docId: string,
  reminderIndex: number,
  action: 'done' | 'snooze',
  snoozeUntil?: Date,
): Promise<void> {
  const doc = byId.get(docId);
  const current = doc?.reminders[reminderIndex];
  if (!doc || !current) return;
  const now = new Date();
  const next: Reminder =
    action === 'done'
      ? completeReminder(current, now)
      : snoozeReminder(current, snoozeUntil ?? new Date(now.getTime() + 3_600_000));
  const prev = doc.reminders;
  const reminders = doc.reminders.map((r, i) => (i === reminderIndex ? next : r));
  const rev = await saveDoc(docId, doc.rev, { reminders });
  // A completed/snoozed reminder is frequent and reversible — undo beats a
  // confirm. Restoring writes the prior reminders array back through the
  // normal save path, so it works offline like everything else.
  flashNotice(action === 'done' ? 'Marked done' : 'Snoozed to tomorrow', {
    label: 'Undo',
    run: () => {
      const fresh = byId.get(docId);
      void saveDoc(docId, fresh?.rev ?? rev, { reminders: prev }).then(() => clearNotice());
    },
  });
}

export async function removeDoc(id: string): Promise<void> {
  byId.delete(id);
  await db.docs.delete(id);
  await enqueueDelete(outboxStore, id);
  await refreshPending();
  rebuild();
  void drainThenPull();
}

/** How long a delete stays local-only, undoable from its toast. The toast and
 * the grace timer share this so Undo can never outlive the actual window. */
const UNDO_WINDOW_MS = 8000;

const pendingDeletes = new Map<string, ReturnType<typeof setTimeout>>();

/** Deletes with a grace window instead of a confirm dialog: the note vanishes
 * immediately, but the delete is only enqueued after the Undo notice expires.
 * Undo within the window restores the note untouched — nothing was sent yet.
 * If the app dies mid-window the delete was never enqueued, so the note
 * reappears on next sync: fail-safe in the keep-the-data direction. */
export async function removeDocUndoable(id: string): Promise<void> {
  const doc = byId.get(id);
  if (!doc) return;
  byId.delete(id);
  await db.docs.delete(id);
  rebuild();
  const timer = setTimeout(() => {
    pendingDeletes.delete(id);
    void (async () => {
      await enqueueDelete(outboxStore, id);
      await refreshPending();
      rebuild();
      void drainThenPull();
    })();
  }, UNDO_WINDOW_MS);
  pendingDeletes.set(id, timer);
  flashNotice('Note deleted', {
    label: 'Undo',
    run: () => {
      const t = pendingDeletes.get(id);
      if (!t) return;
      clearTimeout(t);
      pendingDeletes.delete(id);
      void putLocal(doc).then(() => {
        clearNotice();
        rebuild();
      });
    },
  });
}

/** Search scopes, spec §8: everything · titles only · tags · canvas notes. */
export type SearchScope = 'all' | 'title' | 'tag' | 'canvas';

/** Instant local filter over the fully-synced corpus. Server FTS exists for
 * agents and heavier ranking; interactive search must never wait on a wire.
 * With an empty query, a narrowing scope lists its whole population (all
 * canvas notes, all tagged notes) — the scope chip is a filter in itself. */
export function filterDocs(docs: ServerDoc[], query: string, scope: SearchScope = 'all'): ServerDoc[] {
  const q = query.trim().toLowerCase();
  const pool =
    scope === 'canvas'
      ? docs.filter((d) => hasCanvasBlock(d.body) || isLegacyCanvas(d.body))
      : docs;
  if (!q) {
    if (scope === 'tag') return pool.filter((d) => docTags(d.tags ?? [], d.body).length > 0);
    return pool;
  }
  const terms = q.split(/\s+/);
  if (scope === 'tag') {
    return pool.filter((d) => {
      const tags = docTags(d.tags ?? [], d.body);
      return terms.every((t) => {
        const needle = t.replace(/^#/, '');
        return tags.some((tag) => tag.includes(needle));
      });
    });
  }
  return pool.filter((d) => {
    const hay =
      scope === 'title'
        ? d.title.toLowerCase()
        : `${d.title}\n${d.body}\n${(d.tags ?? []).join(' ')}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

/** Every tag in the corpus, most-used first — feeds the editor's + Tag
 * suggestions. (`?? []`: docs cached by pre-tags builds lack the field.) */
export function allTags(): string[] {
  const freq = new Map<string, number>();
  for (const d of byId.values()) {
    for (const t of docTags(d.tags ?? [], d.body)) freq.set(t, (freq.get(t) ?? 0) + 1);
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
}
