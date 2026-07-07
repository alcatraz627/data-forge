import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

export interface MergeResult {
  clean: boolean;
  text: string;
}

/**
 * Three-way text merge of note bodies, delegated to `git merge-file` — the
 * same battle-tested machinery git itself uses. Returns the merged text when
 * the histories combine cleanly; a dirty result tells the caller to take the
 * conflict-fork path instead (nothing is ever auto-mangled with markers).
 */
export function mergeBodies(base: string, ours: string, theirs: string): MergeResult {
  const dir = mkdtempSync(join(tmpdir(), 'forge-merge-'));
  try {
    const b = join(dir, 'base');
    const o = join(dir, 'ours');
    const t = join(dir, 'theirs');
    writeFileSync(b, `${base}\n`);
    writeFileSync(o, `${ours}\n`);
    writeFileSync(t, `${theirs}\n`);
    try {
      const out = execFileSync('git', ['merge-file', '-p', o, b, t], { encoding: 'utf8' });
      return { clean: true, text: out.replace(/\n$/, '') };
    } catch {
      return { clean: false, text: ours };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
