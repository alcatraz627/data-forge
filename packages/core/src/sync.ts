import type { ChangeEntry, ChangesResponse } from './api.js';

/**
 * The client half of sync: pull every change after a cursor and apply it to
 * whatever local store the platform uses. M0's web app backs this with an
 * in-memory map; M1 swaps in IndexedDB without touching the protocol.
 */

export interface SyncTransport {
  changes(since: number): Promise<ChangesResponse>;
}

export interface SyncStore {
  getCursor(): number | Promise<number>;
  setCursor(seq: number): void | Promise<void>;
  applyChanges(entries: ChangeEntry[]): void | Promise<void>;
}

/** Pulls to head (looping while the server returns full pages) and returns
 * the new cursor. Safe to call concurrently with captures: entries are
 * applied in seq order and the cursor only ever moves forward. */
export async function pullToHead(transport: SyncTransport, store: SyncStore): Promise<number> {
  let cursor = await store.getCursor();
  for (;;) {
    const page = await transport.changes(cursor);
    if (page.changes.length > 0) {
      await store.applyChanges(page.changes);
    }
    cursor = Math.max(cursor, page.latestSeq);
    await store.setCursor(cursor);
    if (page.changes.length < 500) return cursor;
  }
}
