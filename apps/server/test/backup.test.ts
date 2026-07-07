import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createForgeApp } from '../src/app.js';
import { git, pushBackup } from '../src/gitops.js';

describe('backup push', () => {
  it('pushes committed notes to a configured remote and skips when absent', async () => {
    const dataDir = join(mkdtempSync(join(tmpdir(), 'forge-backup-')), 'data');
    const fa = await createForgeApp({ dataDir, gitQuietMs: 600_000 });
    fa.forge.createDoc({ body: 'backed up note', source: 'test' });
    await fa.forge.flush();

    // No remote configured yet -> skip cleanly.
    expect(await pushBackup(dataDir, 'origin')).toBe('skip');

    // Wire a bare repo as the backup remote and push.
    const bare = join(mkdtempSync(join(tmpdir(), 'forge-bare-')), 'sync.git');
    execFileSync('git', ['init', '--bare', '-b', 'main', bare]);
    await git(dataDir, 'remote', 'add', 'origin', bare);

    expect(await pushBackup(dataDir, 'origin')).toBe('pushed');

    // The bare remote now holds the note file.
    const files = execFileSync('git', ['-C', bare, 'ls-tree', '-r', '--name-only', 'main'], {
      encoding: 'utf8',
    });
    expect(files).toMatch(/notes\/.*\.md/);
    fa.forge.close();
  }, 20_000);
});
