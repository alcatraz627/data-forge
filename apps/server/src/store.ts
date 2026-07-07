import { createHash } from 'node:crypto';
import { mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { idTime } from '@forge/core';

/** File placement and atomic writes for the data dir, plus the bookkeeping
 * that lets the watcher tell the server's own writes apart from external
 * edits (self-writes must not loop back through the sync feed). */

export function docRelPath(id: string): string {
  const t = idTime(id);
  const mm = String(t.getMonth() + 1).padStart(2, '0');
  return join('notes', String(t.getFullYear()), mm, `${id}.md`);
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

const SELF_WRITE_WINDOW_MS = 10_000;

export class SelfWrites {
  private marks = new Map<string, number>();

  mark(absPath: string): void {
    const now = Date.now();
    this.marks.set(absPath, now);
    for (const [p, t] of this.marks) {
      if (now - t > SELF_WRITE_WINDOW_MS) this.marks.delete(p);
    }
  }

  has(absPath: string): boolean {
    const t = this.marks.get(absPath);
    return t !== undefined && Date.now() - t <= SELF_WRITE_WINDOW_MS;
  }
}

export function atomicWrite(absPath: string, text: string): void {
  mkdirSync(dirname(absPath), { recursive: true });
  const tmp = `${absPath}.tmp-${process.pid}`;
  writeFileSync(tmp, text, 'utf8');
  renameSync(tmp, absPath);
}

export function removeFile(absPath: string): void {
  try {
    unlinkSync(absPath);
  } catch {
    // already gone — deletion is idempotent
  }
}
