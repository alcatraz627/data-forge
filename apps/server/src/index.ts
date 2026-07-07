/**
 * forge-server entrypoint: the storage and sync backend for Data Forge.
 * Owns the data repo (files + git are the canonical store, ADR-0001/0002);
 * clients only ever speak the HTTP API assembled in app.ts.
 */
import { serve } from '@hono/node-server';
import { createForgeApp } from './app.js';
import { ARCHIVE_SWEEP_INTERVAL_MS, DAY_MS, config } from './config.js';
import { addStaticRoutes } from './static.js';
import { startWatcher } from './watcher.js';

const { app, forge } = await createForgeApp({
  dataDir: config.dataDir,
  archiveDays: config.archiveDays,
});
const watcher = startWatcher(forge);
addStaticRoutes(app, config.webDist);

const archiveTimer = setInterval(() => {
  const n = forge.archiveStale(config.archiveDays * DAY_MS, Date.now());
  if (n > 0) console.log(`archive: swept ${n} stale ephemeral note(s)`);
}, ARCHIVE_SWEEP_INTERVAL_MS);
archiveTimer.unref();

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`forge-server listening on :${info.port} (data: ${config.dataDir})`);
});

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await watcher.close();
  await forge.flush();
  server.close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
