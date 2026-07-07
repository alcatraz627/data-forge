import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChangesResponse, ServerDoc, UpdateDocResponse } from '@forge/core';
import { describe, expect, it } from 'vitest';
import { createForgeApp, type ForgeApp } from '../src/app.js';

/**
 * The trust test: two simulated devices interleave captures, edits (often
 * from stale revisions on purpose), deletes, and pulls, then both sync to
 * head. They must converge on identical state and every dirty merge must
 * have forked a conflict doc rather than dropping content.
 */

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HEADERS = { 'content-type': 'application/json' };

class SimClient {
  cursor = 0;
  docs = new Map<string, { rev: number; body: string }>();
  conflictsSeen: string[] = [];

  constructor(
    readonly name: string,
    readonly fa: ForgeApp,
  ) {}

  async pull(): Promise<void> {
    for (;;) {
      const res = await this.fa.app.request(`/api/changes?since=${this.cursor}`);
      const page = (await res.json()) as ChangesResponse;
      for (const entry of page.changes) {
        if (entry.deleted) this.docs.delete(entry.id);
        else if (entry.doc) this.docs.set(entry.id, { rev: entry.rev, body: entry.doc.body });
      }
      this.cursor = Math.max(this.cursor, page.latestSeq);
      if (page.changes.length < 500) return;
    }
  }

  async create(i: number): Promise<void> {
    const res = await this.fa.app.request('/api/docs', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ body: `note ${this.name}-${i}\nline two`, source: this.name }),
    });
    const doc = (await res.json()) as ServerDoc;
    this.docs.set(doc.id, { rev: doc.rev, body: doc.body });
  }

  async edit(rnd: () => number, i: number): Promise<void> {
    const ids = [...this.docs.keys()];
    if (ids.length === 0) return;
    const id = ids[Math.floor(rnd() * ids.length)] as string;
    const known = this.docs.get(id) as { rev: number; body: string };
    const body =
      rnd() > 0.5
        ? `${known.body}\nedit-${this.name}-${i}`
        : `edit-${this.name}-${i}\n${known.body}`;
    const res = await this.fa.app.request(`/api/docs/${id}`, {
      method: 'PUT',
      headers: HEADERS,
      body: JSON.stringify({ baseRev: known.rev, body }),
    });
    if (res.status === 404) {
      this.docs.delete(id);
      return;
    }
    expect(res.status).toBe(200);
    const out = (await res.json()) as UpdateDocResponse;
    this.docs.set(id, { rev: out.doc.rev, body: out.doc.body });
    if (out.conflictDocId) this.conflictsSeen.push(out.conflictDocId);
  }

  async remove(rnd: () => number): Promise<void> {
    const ids = [...this.docs.keys()];
    if (ids.length === 0) return;
    const id = ids[Math.floor(rnd() * ids.length)] as string;
    await this.fa.app.request(`/api/docs/${id}`, { method: 'DELETE' });
    this.docs.delete(id);
  }

  snapshot(): string {
    return JSON.stringify([...this.docs.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));
  }
}

async function runScenario(seed: number): Promise<void> {
  const dataDir = join(mkdtempSync(join(tmpdir(), 'forge-replay-')), 'data');
  const fa = await createForgeApp({ dataDir, gitQuietMs: 600_000 });
  const rnd = mulberry32(seed);
  const a = new SimClient('pixel', fa);
  const b = new SimClient('mac', fa);

  for (let i = 0; i < 40; i++) {
    const client = rnd() > 0.5 ? a : b;
    const dice = rnd();
    if (dice < 0.3) await client.create(i);
    else if (dice < 0.7) await client.edit(rnd, i);
    else if (dice < 0.8) await client.remove(rnd);
    else await client.pull();
  }

  await a.pull();
  await b.pull();
  expect(a.snapshot(), `seed ${seed}: clients diverged`).toBe(b.snapshot());

  // A fresh device syncing from zero must reconstruct the same world.
  const fresh = new SimClient('fresh', fa);
  await fresh.pull();
  expect(fresh.snapshot(), `seed ${seed}: fresh client diverged`).toBe(a.snapshot());

  // Dirty merges must have preserved the losing side as a conflict doc.
  for (const conflictId of [...a.conflictsSeen, ...b.conflictsSeen]) {
    const doc = fresh.docs.get(conflictId);
    if (doc === undefined) continue; // a later random delete may have removed it
    expect(doc.body.length).toBeGreaterThan(0);
  }

  await fa.forge.flush();
  fa.forge.close();
}

describe('two-client sync replay', () => {
  it('converges across 15 randomized interleavings', async () => {
    for (let seed = 1; seed <= 15; seed++) {
      await runScenario(seed * 7919);
    }
  }, 60_000);
});
