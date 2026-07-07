import {
  ApiError,
  type CreateDocBody,
  type ServerDoc,
  type UpdateDocBody,
  type UpdateDocResponse,
} from './api.js';

/**
 * The offline write queue: every local mutation is captured here first and
 * replayed against the server when connectivity allows. Capture must never
 * block on the network (CLAUDE.md invariant 5); this queue is what makes
 * that true. Platforms supply the storage (Dexie on web); the ordering,
 * coalescing, and failure semantics live here where they can be unit-tested.
 */

export type OutboxOp =
  | { kind: 'create'; id: string; input: CreateDocBody & { id: string } }
  | { kind: 'update'; id: string; baseRev: number; patch: Omit<UpdateDocBody, 'baseRev'> }
  | { kind: 'delete'; id: string };

export interface OutboxEntry {
  seq: number;
  op: OutboxOp;
}

export interface OutboxStore {
  /** All entries, in insertion (seq) order. */
  all(): Promise<OutboxEntry[]>;
  add(op: OutboxOp): Promise<OutboxEntry>;
  update(seq: number, op: OutboxOp): Promise<void>;
  remove(seq: number): Promise<void>;
}

export async function enqueueCreate(
  store: OutboxStore,
  input: CreateDocBody & { id: string },
): Promise<void> {
  await store.add({ kind: 'create', id: input.id, input });
}

/** Edits to a doc whose create is still queued fold into that create; back to
 * back edits to the same doc coalesce (earliest baseRev wins, since that is
 * the revision the whole edit chain was actually based on). */
export async function enqueueUpdate(
  store: OutboxStore,
  id: string,
  baseRev: number,
  patch: Omit<UpdateDocBody, 'baseRev'>,
): Promise<void> {
  const entries = await store.all();
  const pendingCreate = entries.find((e) => e.op.kind === 'create' && e.op.id === id);
  if (pendingCreate && pendingCreate.op.kind === 'create') {
    await store.update(pendingCreate.seq, {
      ...pendingCreate.op,
      input: { ...pendingCreate.op.input, ...patch },
    });
    return;
  }
  const lastForId = [...entries].reverse().find((e) => e.op.id === id);
  if (lastForId && lastForId.op.kind === 'update') {
    await store.update(lastForId.seq, {
      ...lastForId.op,
      patch: { ...lastForId.op.patch, ...patch },
    });
    return;
  }
  await store.add({ kind: 'update', id, baseRev, patch });
}

/** Deleting a doc that only exists in the queue cancels the queued work
 * entirely; deleting a synced doc drops its queued edits and queues the
 * delete. */
export async function enqueueDelete(store: OutboxStore, id: string): Promise<void> {
  const entries = await store.all();
  const hadPendingCreate = entries.some((e) => e.op.kind === 'create' && e.op.id === id);
  for (const e of entries) {
    if (e.op.id === id) await store.remove(e.seq);
  }
  if (!hadPendingCreate) await store.add({ kind: 'delete', id });
}

export interface DrainTransport {
  create(input: CreateDocBody): Promise<ServerDoc>;
  update(id: string, body: UpdateDocBody): Promise<UpdateDocResponse>;
  /** Must resolve (not throw) when the doc is already gone. */
  remove(id: string): Promise<void>;
  get(id: string): Promise<ServerDoc>;
}

export interface DrainCallbacks {
  onDocSynced(
    doc: ServerDoc,
    outcome: { merged?: boolean; conflictDocId?: string },
  ): void | Promise<void>;
  /** A queued op could not be applied or recovered; its content is being
   * abandoned. Surface this loudly — it is the only lossy path. */
  onDropped(op: OutboxOp, reason: string): void | Promise<void>;
  /** Source label for docs recreated during recovery. */
  restoreSource: string;
}

const isRetryLater = (e: unknown): boolean => !(e instanceof ApiError) || e.status >= 500;

/**
 * Replays the queue in order. Returns 'offline' when the server is
 * unreachable (queue intact, try again later); 'drained' when the queue is
 * empty. Semantic rejections (4xx) are recovered where possible — a create
 * colliding with an existing id becomes an update; an update to a doc
 * deleted elsewhere recreates it when the edit carried a body — and dropped
 * with a callback otherwise, so one poisoned op can never wedge the queue.
 */
export async function drainOutbox(
  store: OutboxStore,
  transport: DrainTransport,
  cb: DrainCallbacks,
): Promise<'drained' | 'offline'> {
  const entries = (await store.all()).sort((a, b) => a.seq - b.seq);
  for (const entry of entries) {
    try {
      await applyOp(entry.op, transport, cb);
      await store.remove(entry.seq);
    } catch (e) {
      if (isRetryLater(e)) return 'offline';
      try {
        const recovered = await recoverOp(entry.op, e as ApiError, transport, cb);
        await store.remove(entry.seq);
        if (!recovered) await cb.onDropped(entry.op, (e as ApiError).message);
      } catch (e2) {
        if (isRetryLater(e2)) return 'offline';
        await store.remove(entry.seq);
        await cb.onDropped(entry.op, (e2 as ApiError).message);
      }
    }
  }
  return 'drained';
}

async function applyOp(op: OutboxOp, transport: DrainTransport, cb: DrainCallbacks): Promise<void> {
  if (op.kind === 'create') {
    const doc = await transport.create(op.input);
    await cb.onDocSynced(doc, {});
  } else if (op.kind === 'update') {
    const res = await transport.update(op.id, { baseRev: op.baseRev, ...op.patch });
    await cb.onDocSynced(res.doc, {
      merged: res.merged,
      ...(res.conflictDocId ? { conflictDocId: res.conflictDocId } : {}),
    });
  } else {
    await transport.remove(op.id);
  }
}

async function recoverOp(
  op: OutboxOp,
  err: ApiError,
  transport: DrainTransport,
  cb: DrainCallbacks,
): Promise<boolean> {
  if (op.kind === 'create' && err.status === 409) {
    const head = await transport.get(op.id);
    const { id: _id, source: _source, body, ...rest } = op.input;
    const res = await transport.update(op.id, { baseRev: head.rev, body, ...rest });
    await cb.onDocSynced(res.doc, {
      merged: res.merged,
      ...(res.conflictDocId ? { conflictDocId: res.conflictDocId } : {}),
    });
    return true;
  }
  if (op.kind === 'update' && err.status === 404 && op.patch.body !== undefined) {
    const doc = await transport.create({
      id: op.id,
      body: op.patch.body,
      source: cb.restoreSource,
      ...(op.patch.durability !== undefined ? { durability: op.patch.durability } : {}),
      ...(op.patch.formality !== undefined ? { formality: op.patch.formality } : {}),
      ...(op.patch.importance !== undefined ? { importance: op.patch.importance } : {}),
      ...(op.patch.pinned !== undefined ? { pinned: op.patch.pinned } : {}),
      ...(op.patch.reminders !== undefined ? { reminders: op.patch.reminders } : {}),
    });
    await cb.onDocSynced(doc, {});
    return true;
  }
  return false;
}
