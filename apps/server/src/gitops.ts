import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export const git = async (dir: string, ...args: string[]): Promise<string> =>
  (await exec('git', ['-C', dir, ...args])).stdout;

/**
 * Pushes the data repo to its backup remote, best-effort. Off-site history is
 * the whole point (ADR-0005); a failed push (offline, auth) is logged and
 * retried next cycle, never fatal. Skips silently when the remote isn't
 * configured, so a fresh machine without a remote just runs local-only.
 */
export async function pushBackup(dir: string, remote: string): Promise<'pushed' | 'skip' | 'fail'> {
  try {
    const remotes = await git(dir, 'remote');
    if (!remotes.split('\n').includes(remote)) return 'skip';
    await git(dir, 'push', remote, 'HEAD:main');
    return 'pushed';
  } catch (e) {
    // git puts the actionable reason (403, non-fast-forward, auth prompt) on
    // stderr — the exec Error's first line only says "Command failed", which
    // hid a scope problem for days. Log the reason, not the wrapper.
    const err = e as Error & { stderr?: string };
    const reason =
      err.stderr
        ?.split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(-2)
        .join(' · ') || err.message.split('\n')[0];
    console.error('backup push failed (will retry):', reason);
    return 'fail';
  }
}

/**
 * Turns a stream of doc writes into batched git commits: history stays
 * readable (one commit per burst of activity, not per keystroke) and the
 * process can flush on shutdown so nothing is left uncommitted.
 *
 * Commits are serialized through a promise chain — git locks its index, so
 * two concurrent commits would corrupt each other.
 */
export class GitBatcher {
  private pending = 0;
  private timer: NodeJS.Timeout | undefined;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private dir: string,
    private quietMs = 45_000,
  ) {}

  markDirty(): void {
    this.pending += 1;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.quietMs);
    this.timer.unref?.();
  }

  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.chain = this.chain
      .then(() => this.commit())
      .catch((e) => {
        console.error('git commit failed:', e);
      });
    return this.chain;
  }

  private async commit(): Promise<void> {
    const status = await git(this.dir, 'status', '--porcelain');
    if (!status.trim()) {
      this.pending = 0;
      return;
    }
    const n = this.pending;
    this.pending = 0;
    await git(this.dir, 'add', '-A');
    await git(this.dir, 'commit', '-m', `sync: ${n || 'external'} change(s)`);
  }
}
