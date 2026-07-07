import { execFile } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const git = (dir: string, ...args: string[]) => exec('git', ['-C', dir, ...args]);

/** Patterns that must never enter the data repo's history: the derived SQLite
 * index and its WAL/SHM sidecars, and atomic-write temp files (M0 review,
 * findings H2 and L1). */
const IGNORES = ['meta/index.sqlite*', '*.tmp-*', '.DS_Store'];

/**
 * Make sure the data directory exists and is a git repository.
 *
 * The data dir is the canonical store for all user content (ADR-0001) and
 * deliberately lives outside this code repo (ADR-0005). Bootstrapping here
 * means a fresh machine only needs the server started once to be usable;
 * an already-initialized directory passes through untouched, except that
 * missing ignore patterns are healed additively.
 */
export async function ensureDataDir(dir: string): Promise<void> {
  await mkdir(join(dir, 'notes'), { recursive: true });
  await mkdir(join(dir, 'meta'), { recursive: true });
  try {
    await access(join(dir, '.git'));
  } catch {
    await exec('git', ['init', '-b', 'main', dir]);
    await writeFile(join(dir, '.gitignore'), `${IGNORES.join('\n')}\n`);
    await git(dir, 'add', '-A');
    await git(dir, 'commit', '-m', 'init: data forge storage');
  }
  await ensureIgnores(dir);
}

async function ensureIgnores(dir: string): Promise<void> {
  const path = join(dir, '.gitignore');
  let current = '';
  try {
    current = await readFile(path, 'utf8');
  } catch {
    // no .gitignore yet; created below with all patterns
  }
  const lines = new Set(current.split('\n').map((l) => l.trim()));
  const missing = IGNORES.filter((p) => !lines.has(p));
  if (missing.length === 0) return;
  const head = current === '' || current.endsWith('\n') ? current : `${current}\n`;
  await writeFile(path, `${head}${missing.join('\n')}\n`);
}
