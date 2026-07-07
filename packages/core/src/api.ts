import type { Doc, DocChange, Durability, Formality, Importance, Reminder } from './types.js';

/**
 * The HTTP contract between forge-server and every client. Server and web
 * import these same types, so protocol drift is a compile error rather than
 * a runtime surprise.
 */

/** A doc as the server returns it: enriched with the server-assigned revision
 * and the derived display fields. */
export interface ServerDoc extends Doc {
  rev: number;
  title: string;
  preview: string;
}

export interface ChangeEntry extends DocChange {
  /** Present unless the change is a deletion. */
  doc?: ServerDoc;
}

/** Server-side page cap for the change feed; the sync loop keys off it. */
export const CHANGES_PAGE = 500;

/** An HTTP-level failure with its status attached. Anything else thrown by a
 * transport (fetch TypeError, abort) is treated as "offline, retry later" by
 * the sync machinery, so transports must throw this for real server replies. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface ChangesResponse {
  changes: ChangeEntry[];
  latestSeq: number;
}

export interface CreateDocBody {
  /** Client-generated ULID for offline capture; server assigns one if absent. */
  id?: string;
  body: string;
  /** ISO-8601 timestamps to preserve on import/backfill; default to now. */
  created?: string;
  updated?: string;
  durability?: Durability;
  formality?: Formality;
  importance?: Importance;
  pinned?: boolean;
  archived?: boolean;
  reminders?: Reminder[];
  source: string;
}

export interface UpdateDocBody {
  /** The revision this edit was based on; mismatch triggers a server-side merge. */
  baseRev: number;
  body?: string;
  durability?: Durability;
  formality?: Formality;
  importance?: Importance;
  pinned?: boolean;
  archived?: boolean;
  reminders?: Reminder[];
}

export interface UpdateDocResponse {
  doc: ServerDoc;
  /** True when the server had to three-way merge diverged edits. */
  merged: boolean;
  /** Set when the merge was dirty: the losing version was preserved as this
   * new doc (source `conflict:<id>`) instead of being dropped. */
  conflictDocId?: string;
}

export interface SearchResult {
  id: string;
  title: string;
  snippet: string;
}
