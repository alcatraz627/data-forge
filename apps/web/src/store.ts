import {
  type CreateDocBody,
  type ServerDoc,
  type SyncStore,
  type UpdateDocBody,
  type UpdateDocResponse,
  pullToHead,
} from '@forge/core';
import { useSyncExternalStore } from 'react';
import * as api from './api';

/**
 * M0 client state: the full corpus in memory, fed by the pull-based sync
 * engine from @forge/core. M1 swaps the Map for IndexedDB (offline) without
 * changing the protocol or the React surface.
 */

export interface Snapshot {
  docs: ServerDoc[];
  connected: boolean;
  notice: string | null;
  loaded: boolean;
}

const byId = new Map<string, ServerDoc>();
let cursor = 0;
let connected = false;
let notice: string | null = null;
let loaded = false;
let snapshot: Snapshot = { docs: [], connected, notice, loaded };
const listeners = new Set<() => void>();

function rebuild(): void {
  const docs = [...byId.values()].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return a.updated < b.updated ? 1 : -1;
  });
  snapshot = { docs, connected, notice, loaded };
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

const syncStore: SyncStore = {
  getCursor: () => cursor,
  setCursor: (n) => {
    cursor = n;
  },
  applyChanges: (entries) => {
    for (const e of entries) {
      if (e.deleted) byId.delete(e.id);
      else if (e.doc) byId.set(e.id, e.doc);
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
    // transient network failure; the next SSE nudge or reconnect re-pulls
  } finally {
    pulling = false;
    rebuild();
    if (pullAgain) {
      pullAgain = false;
      void pull();
    }
  }
}

export function startSync(): () => void {
  void pull();
  return api.subscribeEvents(
    () => void pull(),
    (ok) => {
      connected = ok;
      if (ok) void pull();
      rebuild();
    },
  );
}

export function flashNotice(text: string): void {
  notice = text;
  rebuild();
  setTimeout(() => {
    notice = null;
    rebuild();
  }, 4000);
}

export async function captureNote(input: Omit<CreateDocBody, 'source'>): Promise<void> {
  const doc = await api.createDoc({ ...input, source: 'web' });
  byId.set(doc.id, doc);
  rebuild();
}

export async function saveDoc(id: string, patch: Omit<UpdateDocBody, 'baseRev'>): Promise<void> {
  const known = byId.get(id);
  if (!known) return;
  const res: UpdateDocResponse = await api.updateDoc(id, { baseRev: known.rev, ...patch });
  byId.set(id, res.doc);
  rebuild();
  if (res.conflictDocId)
    flashNotice('Diverged edits: the other version was kept as a conflict note');
  else if (res.merged) flashNotice('Merged with a newer version of this note');
}

export async function removeDoc(id: string): Promise<void> {
  await api.deleteDoc(id);
  byId.delete(id);
  rebuild();
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
