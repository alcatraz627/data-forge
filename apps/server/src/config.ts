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
};
