import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { CreateDocBody } from '@forge/core';
import { keepNoteToDoc } from './keep.js';
import { tasksExportToDocs } from './tasks.js';

/**
 * One-time importer for a Google Takeout export. Posts to a running
 * forge-server so there is a single writer to the index and git repo; the
 * server preserves each note's original timestamps. Re-running duplicates
 * notes (no dedup), so run it once against a fresh store.
 *
 * Usage: tsx src/import/cli.ts <takeout-dir> [--server http://localhost:5040]
 */

function collectDocs(takeoutDir: string): CreateDocBody[] {
  const docs: CreateDocBody[] = [];

  const keepDir = join(takeoutDir, 'Keep');
  let keepFiles: string[] = [];
  try {
    keepFiles = readdirSync(keepDir).filter((f) => f.endsWith('.json'));
  } catch {
    console.log('no Keep/ directory, skipping notes');
  }
  let keepKept = 0;
  for (const file of keepFiles) {
    try {
      const doc = keepNoteToDoc(JSON.parse(readFileSync(join(keepDir, file), 'utf8')));
      if (doc) {
        docs.push(doc);
        keepKept += 1;
      }
    } catch (e) {
      console.error(`skipping ${file}:`, (e as Error).message);
    }
  }
  if (keepFiles.length)
    console.log(`Keep: ${keepKept} imported, ${keepFiles.length - keepKept} skipped`);

  for (const name of ['Tasks.json', 'Tasks/Tasks.json']) {
    try {
      const taskDocs = tasksExportToDocs(JSON.parse(readFileSync(join(takeoutDir, name), 'utf8')));
      docs.push(...taskDocs);
      console.log(`Tasks: ${taskDocs.length} imported from ${name}`);
      break;
    } catch {
      // try the next candidate path
    }
  }

  return docs;
}

async function post(server: string, doc: CreateDocBody): Promise<boolean> {
  const res = await fetch(`${server}/api/docs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(doc),
  });
  if (!res.ok) {
    console.error(`  failed (${res.status}):`, (await res.text()).slice(0, 120));
    return false;
  }
  return true;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const takeoutDir = args.find((a) => !a.startsWith('--'));
  const serverIdx = args.indexOf('--server');
  const server = serverIdx >= 0 ? args[serverIdx + 1] : 'http://localhost:5040';
  if (!takeoutDir || !server) {
    console.error('usage: tsx src/import/cli.ts <takeout-dir> [--server http://localhost:5040]');
    process.exit(1);
  }

  const docs = collectDocs(takeoutDir);
  console.log(`\nposting ${docs.length} notes to ${server} …`);
  let ok = 0;
  for (const doc of docs) {
    if (await post(server, doc)) ok += 1;
  }
  console.log(`done: ${ok}/${docs.length} imported`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
