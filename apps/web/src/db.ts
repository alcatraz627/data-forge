import type { OutboxEntry, OutboxOp, OutboxStore, ServerDoc } from '@forge/core';
import Dexie, { type EntityTable } from 'dexie';

/** Local persistence: the full doc corpus, the offline write queue, and the
 * sync cursor. Docs and cursor are a disposable server mirror; the outbox is
 * NOT — it holds writes the server has never seen. */
export const db = new Dexie('forge') as Dexie & {
  docs: EntityTable<ServerDoc, 'id'>;
  outbox: EntityTable<OutboxEntry, 'seq'>;
  kv: EntityTable<{ key: string; value: string }, 'key'>;
};

db.version(1).stores({
  docs: 'id, updated',
  outbox: '++seq',
  kv: 'key',
});

export const outboxStore: OutboxStore = {
  all: async () => db.outbox.orderBy('seq').toArray(),
  add: async (op: OutboxOp) => {
    const seq = (await db.outbox.add({ op } as OutboxEntry)) as number;
    return { seq, op };
  },
  update: async (seq: number, op: OutboxOp) => {
    await db.outbox.update(seq, { op });
  },
  remove: async (seq: number) => {
    await db.outbox.delete(seq);
  },
};

export async function getCursor(): Promise<number> {
  return Number((await db.kv.get('cursor'))?.value ?? 0);
}

export async function setCursor(seq: number): Promise<void> {
  await db.kv.put({ key: 'cursor', value: String(seq) });
}
