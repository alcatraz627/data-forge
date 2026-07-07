import { describe, expect, it } from 'vitest';
import {
  ApiError,
  type CreateDocBody,
  type ServerDoc,
  type UpdateDocBody,
  type UpdateDocResponse,
} from '../src/api.js';
import {
  type DrainCallbacks,
  type DrainTransport,
  type OutboxEntry,
  type OutboxOp,
  type OutboxStore,
  drainOutbox,
  enqueueCreate,
  enqueueDelete,
  enqueueUpdate,
} from '../src/outbox.js';

function memStore(): OutboxStore & { entries: OutboxEntry[] } {
  let seq = 0;
  const entries: OutboxEntry[] = [];
  return {
    entries,
    all: async () => [...entries],
    add: async (op: OutboxOp) => {
      const entry = { seq: ++seq, op };
      entries.push(entry);
      return entry;
    },
    update: async (s: number, op: OutboxOp) => {
      const e = entries.find((x) => x.seq === s);
      if (e) e.op = op;
    },
    remove: async (s: number) => {
      const i = entries.findIndex((x) => x.seq === s);
      if (i >= 0) entries.splice(i, 1);
    },
  };
}

const serverDoc = (id: string, rev: number, body: string): ServerDoc => ({
  id,
  created: '2026-07-07T10:00:00+05:30',
  updated: '2026-07-07T10:00:00+05:30',
  durability: 'ephemeral',
  formality: 'scratch',
  importance: 'normal',
  pinned: false,
  archived: false,
  reminders: [],
  source: 'test',
  body,
  rev,
  title: body,
  preview: '',
});

interface Call {
  kind: string;
  id?: string;
  body?: unknown;
}

function fakeTransport(opts: { failWith?: (call: Call) => unknown } = {}) {
  const calls: Call[] = [];
  let rev = 0;
  const t: DrainTransport = {
    create: async (input: CreateDocBody) => {
      const call = { kind: 'create', id: input.id, body: input };
      calls.push(call);
      const err = opts.failWith?.(call);
      if (err) throw err;
      return serverDoc(input.id ?? 'X', ++rev, input.body);
    },
    update: async (id: string, body: UpdateDocBody) => {
      const call = { kind: 'update', id, body };
      calls.push(call);
      const err = opts.failWith?.(call);
      if (err) throw err;
      const res: UpdateDocResponse = {
        doc: serverDoc(id, body.baseRev + 1, body.body ?? 'unchanged'),
        merged: false,
      };
      return res;
    },
    remove: async (id: string) => {
      const call = { kind: 'remove', id };
      calls.push(call);
      const err = opts.failWith?.(call);
      if (err) throw err;
    },
    get: async (id: string) => {
      calls.push({ kind: 'get', id });
      return serverDoc(id, 7, 'server head');
    },
  };
  return { t, calls };
}

function collectingCallbacks() {
  const synced: string[] = [];
  const dropped: string[] = [];
  const cb: DrainCallbacks = {
    onDocSynced: (doc) => {
      synced.push(doc.id);
    },
    onDropped: (op, reason) => {
      dropped.push(`${op.kind}:${op.id}:${reason}`);
    },
    restoreSource: 'web',
  };
  return { cb, synced, dropped };
}

const ID_A = '01J1QG8Z3WAAAAAAAAAAAAAAAA';
const ID_B = '01J1QG8Z3WBBBBBBBBBBBBBBBB';

describe('outbox coalescing', () => {
  it('folds edits into a still-queued create', async () => {
    const store = memStore();
    await enqueueCreate(store, { id: ID_A, body: 'v1', source: 'web' });
    await enqueueUpdate(store, ID_A, 0, { body: 'v2', importance: 'high' });
    expect(store.entries).toHaveLength(1);
    const op = store.entries[0]?.op;
    expect(op?.kind).toBe('create');
    if (op?.kind === 'create') {
      expect(op.input.body).toBe('v2');
      expect(op.input.importance).toBe('high');
    }
  });

  it('coalesces consecutive updates, keeping the earliest baseRev', async () => {
    const store = memStore();
    await enqueueUpdate(store, ID_A, 3, { body: 'v1' });
    await enqueueUpdate(store, ID_A, 4, { body: 'v2', pinned: true });
    expect(store.entries).toHaveLength(1);
    const op = store.entries[0]?.op;
    if (op?.kind === 'update') {
      expect(op.baseRev).toBe(3);
      expect(op.patch.body).toBe('v2');
      expect(op.patch.pinned).toBe(true);
    } else {
      expect.fail('expected update op');
    }
  });

  it('delete cancels a queued create entirely', async () => {
    const store = memStore();
    await enqueueCreate(store, { id: ID_A, body: 'v1', source: 'web' });
    await enqueueUpdate(store, ID_A, 0, { body: 'v2' });
    await enqueueDelete(store, ID_A);
    expect(store.entries).toHaveLength(0);
  });

  it('delete of a synced doc drops its queued edits and queues one delete', async () => {
    const store = memStore();
    await enqueueUpdate(store, ID_A, 2, { body: 'v2' });
    await enqueueDelete(store, ID_A);
    expect(store.entries).toHaveLength(1);
    expect(store.entries[0]?.op.kind).toBe('delete');
  });
});

describe('drainOutbox', () => {
  it('replays in order and empties the queue', async () => {
    const store = memStore();
    await enqueueCreate(store, { id: ID_A, body: 'a', source: 'web' });
    await enqueueUpdate(store, ID_B, 1, { body: 'b2' });
    const { t, calls } = fakeTransport();
    const { cb, synced } = collectingCallbacks();
    const result = await drainOutbox(store, t, cb);
    expect(result).toBe('drained');
    expect(store.entries).toHaveLength(0);
    expect(calls.map((c) => c.kind)).toEqual(['create', 'update']);
    expect(synced).toEqual([ID_A, ID_B]);
  });

  it('stops on network failure and keeps the queue intact', async () => {
    const store = memStore();
    await enqueueCreate(store, { id: ID_A, body: 'a', source: 'web' });
    await enqueueCreate(store, { id: ID_B, body: 'b', source: 'web' });
    const { t } = fakeTransport({
      failWith: (call) => (call.id === ID_B ? new TypeError('fetch failed') : undefined),
    });
    const { cb, dropped } = collectingCallbacks();
    const result = await drainOutbox(store, t, cb);
    expect(result).toBe('offline');
    expect(store.entries).toHaveLength(1);
    expect(dropped).toHaveLength(0);
  });

  it('treats 5xx as retry-later, not as a semantic drop', async () => {
    const store = memStore();
    await enqueueCreate(store, { id: ID_A, body: 'a', source: 'web' });
    const { t } = fakeTransport({ failWith: () => new ApiError(503, 'unavailable') });
    const { cb, dropped } = collectingCallbacks();
    expect(await drainOutbox(store, t, cb)).toBe('offline');
    expect(store.entries).toHaveLength(1);
    expect(dropped).toHaveLength(0);
  });

  it('recovers a 409 create into an update against the server head', async () => {
    const store = memStore();
    await enqueueCreate(store, { id: ID_A, body: 'mine', source: 'web' });
    const { t, calls } = fakeTransport({
      failWith: (call) => (call.kind === 'create' ? new ApiError(409, 'id_exists') : undefined),
    });
    const { cb, synced, dropped } = collectingCallbacks();
    expect(await drainOutbox(store, t, cb)).toBe('drained');
    expect(calls.map((c) => c.kind)).toEqual(['create', 'get', 'update']);
    const update = calls[2];
    expect((update?.body as UpdateDocBody).baseRev).toBe(7);
    expect(synced).toEqual([ID_A]);
    expect(dropped).toHaveLength(0);
  });

  it('recovers an update-404 with a body by recreating the doc', async () => {
    const store = memStore();
    await enqueueUpdate(store, ID_A, 4, { body: 'edited while deleted elsewhere' });
    const { t, calls } = fakeTransport({
      failWith: (call) => (call.kind === 'update' ? new ApiError(404, 'not found') : undefined),
    });
    const { cb, synced, dropped } = collectingCallbacks();
    expect(await drainOutbox(store, t, cb)).toBe('drained');
    expect(calls.map((c) => c.kind)).toEqual(['update', 'create']);
    expect(synced).toEqual([ID_A]);
    expect(dropped).toHaveLength(0);
  });

  it('drops an unrecoverable op with a loud callback instead of wedging', async () => {
    const store = memStore();
    await enqueueUpdate(store, ID_A, 4, { pinned: true });
    await enqueueCreate(store, { id: ID_B, body: 'next', source: 'web' });
    const { t, calls } = fakeTransport({
      failWith: (call) =>
        call.kind === 'update' && call.id === ID_A ? new ApiError(404, 'not found') : undefined,
    });
    const { cb, synced, dropped } = collectingCallbacks();
    expect(await drainOutbox(store, t, cb)).toBe('drained');
    expect(dropped).toHaveLength(1);
    expect(dropped[0]).toContain(`update:${ID_A}`);
    expect(synced).toEqual([ID_B]);
    expect(calls.map((c) => c.kind)).toEqual(['update', 'create']);
    expect(store.entries).toHaveLength(0);
  });
});
