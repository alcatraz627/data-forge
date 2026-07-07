import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export const git = async (dir: string, ...args: string[]): Promise<string> =>
  (await exec('git', ['-C', dir, ...args])).stdout;

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
    this.chain = this.chain.then(() => this.commit()).catch((e) => {
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
