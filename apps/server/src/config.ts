import { homedir } from 'node:os';
import { resolve } from 'node:path';

/** Server configuration, all overridable via environment variables so the
 * verify script (and any future host) can run against a throwaway data dir. */
export const config = {
  port: Number(process.env.FORGE_PORT ?? 5040),
  dataDir: resolve(process.env.FORGE_DATA ?? resolve(homedir(), 'DataForge')),
};
