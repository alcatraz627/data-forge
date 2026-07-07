import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { type FSWatcher, watch } from 'chokidar';
import type { Forge } from './forge.js';

/** Watches the notes tree so edits made outside the API — Claude Code, a
 * text editor, a git pull — flow into the same index and change feed as API
 * writes. Self-writes are skipped or they would loop forever. */
export function startWatcher(forge: Forge): FSWatcher {
  const notesAbs = join(forge.dataDir, 'notes');
  const watcher = watch(notesAbs, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 },
  });

  const onFile = (abs: string): void => {
    if (!abs.endsWith('.md') || forge.selfWrites.has(abs)) return;
    try {
      forge.applyExternalFile(relative(forge.dataDir, abs), readFileSync(abs, 'utf8'));
    } catch (e) {
      console.error('watcher: failed to apply', abs, e);
    }
  };

  watcher.on('add', onFile);
  watcher.on('change', onFile);
  watcher.on('unlink', (abs: string) => {
    if (!abs.endsWith('.md') || forge.selfWrites.has(abs)) return;
    forge.handleExternalUnlink(relative(forge.dataDir, abs));
  });
  return watcher;
}
