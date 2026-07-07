import { execFile } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const git = (dir: string, ...args: string[]) => exec('git', ['-C', dir, ...args]);

/**
 * Make sure the data directory exists and is a git repository.
 *
 * The data dir is the canonical store for all user content (ADR-0001) and
 * deliberately lives outside this code repo (ADR-0005). Bootstrapping here
 * means a fresh machine only needs the server started once to be usable;
 * an already-initialized directory passes through untouched.
 */
export async function ensureDataDir(dir: string): Promise<void> {
  await mkdir(join(dir, 'notes'), { recursive: true });
  await mkdir(join(dir, 'meta'), { recursive: true });
  try {
    await access(join(dir, '.git'));
  } catch {
    await exec('git', ['init', '-b', 'main', dir]);
    await writeFile(join(dir, '.gitignore'), 'meta/index.sqlite\n.DS_Store\n');
    await git(dir, 'add', '-A');
    await git(dir, 'commit', '-m', 'init: data forge storage');
  }
}
