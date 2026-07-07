import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type ForgeApp, createForgeApp } from '../src/app.js';

const HEADERS = { 'content-type': 'application/json' };

async function seed(fa: ForgeApp, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await fa.app.request('/api/docs', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ body: `# Note ${i}\nbody text token${i} common`, source: 'test' }),
    });
  }
}

describe('restore drill', () => {
  it('rebuilds the whole index from the files after the index is lost', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'forge-restore-')), 'data');
    const fa = await createForgeApp({ dataDir: dir, gitQuietMs: 600_000 });
    await seed(fa, 25);
    await fa.forge.flush();
    const before = (await (await fa.app.request('/api/changes?since=0')).json()).changes.length;
    fa.forge.close();

    // Simulate a restore: clone the data dir (as `git clone` would), drop the
    // derived index entirely, and boot fresh. reconcile() must rebuild it from
    // the note files alone — the guarantee behind "files are truth".
    const restored = join(mkdtempSync(join(tmpdir(), 'forge-restored-')), 'data');
    cpSync(dir, restored, { recursive: true });
    rmSync(join(restored, 'meta', 'index.sqlite'), { force: true });
    rmSync(join(restored, 'meta', 'index.sqlite-wal'), { force: true });
    rmSync(join(restored, 'meta', 'index.sqlite-shm'), { force: true });

    const fa2 = await createForgeApp({ dataDir: restored, gitQuietMs: 600_000 });
    const after = (await (await fa2.app.request('/api/changes?since=0')).json()).changes.length;
    expect(after).toBe(before);
    expect(after).toBe(25);

    // Search works against the rebuilt index too.
    const found = await (await fa2.app.request('/api/search?q=token7')).json();
    expect(found.results.length).toBeGreaterThanOrEqual(1);
    fa2.forge.close();
  }, 30_000);
});

describe('performance budgets', () => {
  it('searches a 10k-note corpus well under the interactive budget', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'forge-perf-')), 'data');
    const fa = await createForgeApp({ dataDir: dir, gitQuietMs: 600_000 });
    // Insert directly through the store to build the corpus quickly.
    for (let i = 0; i < 10_000; i++) {
      fa.forge.createDoc({ body: `note ${i} token${i} shared`, source: 'test' });
    }
    const t0 = performance.now();
    const results = fa.forge.search('token4242');
    const elapsed = performance.now() - t0;
    expect(results.length).toBeGreaterThanOrEqual(1);
    // FTS over 10k rows should be a few ms; 200ms is a generous regression gate.
    expect(elapsed).toBeLessThan(200);
    fa.forge.close();
  }, 60_000);
});
