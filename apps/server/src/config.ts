import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));

/** Server configuration, all overridable via environment variables so the
 * verify script (and any future host) can run against a throwaway data dir. */
export const config = {
  port: Number(process.env.FORGE_PORT ?? 5040),
  dataDir: resolve(process.env.FORGE_DATA ?? resolve(homedir(), 'DataForge')),
  webDist: resolve(process.env.FORGE_WEB_DIST ?? resolve(here, '../../web/dist')),
  /** Untouched ephemeral notes older than this auto-archive. */
  archiveDays: Number(process.env.FORGE_ARCHIVE_DAYS ?? 30),
  /** Backup remote to push the data repo to; empty disables off-site backup. */
  pushRemote: process.env.FORGE_PUSH_REMOTE ?? 'origin',
};

export const DAY_MS = 86_400_000;
export const ARCHIVE_SWEEP_INTERVAL_MS = 60 * 60 * 1000;
export const BACKUP_PUSH_INTERVAL_MS = 10 * 60 * 1000;
