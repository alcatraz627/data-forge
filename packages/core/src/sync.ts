import { CHANGES_PAGE, type ChangeEntry, type ChangesResponse } from './api.js';

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
 * the new cursor. The cursor advances by the last entry actually received —
 * jumping to the server's head seq on a full page would silently skip
 * everything past the page cap (M0 review, finding C1). Only a short page
 * proves the gap between the last entry and head is empty. */
export async function pullToHead(transport: SyncTransport, store: SyncStore): Promise<number> {
  let cursor = await store.getCursor();
  for (;;) {
    const page = await transport.changes(cursor);
    const last = page.changes.at(-1);
    if (last) {
      await store.applyChanges(page.changes);
      cursor = last.seq;
    }
    if (page.changes.length < CHANGES_PAGE) {
      cursor = Math.max(cursor, page.latestSeq);
      await store.setCursor(cursor);
      return cursor;
    }
    await store.setCursor(cursor);
  }
}
