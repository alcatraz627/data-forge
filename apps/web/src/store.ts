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
  drainOutbox,
  emptyCanvasBody,
  enqueueCreate,
  enqueueDelete,
  enqueueUpdate,
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

export interface Snapshot {
  docs: ServerDoc[];
  connected: boolean;
  pending: number;
  notice: string | null;
  loaded: boolean;
}

const byId = new Map<string, ServerDoc>();
let connected = false;
let pending = 0;
let notice: string | null = null;
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

export function flashNotice(text: string): void {
  notice = text;
  rebuild();
  setTimeout(() => {
    notice = null;
    rebuild();
  }, 5000);
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
  window.addEventListener('online', onOnline);
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
  const reminders = doc.reminders.map((r, i) => (i === reminderIndex ? next : r));
  await saveDoc(docId, doc.rev, { reminders });
}

export async function removeDoc(id: string): Promise<void> {
  byId.delete(id);
  await db.docs.delete(id);
  await enqueueDelete(outboxStore, id);
  await refreshPending();
  rebuild();
  void drainThenPull();
}

/** Instant local filter over the fully-synced corpus. Server FTS exists for
 * agents and heavier ranking; interactive search must never wait on a wire. */
export function filterDocs(docs: ServerDoc[], query: string): ServerDoc[] {
  const q = query.trim().toLowerCase();
  if (!q) return docs;
  const terms = q.split(/\s+/);
  return docs.filter((d) => {
    const hay = `${d.title}\n${d.body}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}
