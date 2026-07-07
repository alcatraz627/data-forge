/**
 * forge-server entrypoint: the storage and sync backend for Data Forge.
 * Owns the data repo (files + git are the canonical store, ADR-0001/0002);
 * clients only ever speak the HTTP API assembled in app.ts.
 */
import { serve } from '@hono/node-server';
import { createForgeApp } from './app.js';
import { config } from './config.js';
import { addStaticRoutes } from './static.js';
import { startWatcher } from './watcher.js';

const { app, forge } = await createForgeApp({ dataDir: config.dataDir });
const watcher = startWatcher(forge);
addStaticRoutes(app, config.webDist);

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
