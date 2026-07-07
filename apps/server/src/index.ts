/**
 * forge-server entrypoint: the storage and sync backend for Data Forge.
 * Owns the data repo (files + git are the canonical store, ADR-0001/0002);
 * clients only ever speak this HTTP API.
 */
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { config } from './config.js';
import { ensureDataDir } from './data-dir.js';

const app = new Hono();

app.get('/health', (c) => c.json({ ok: true, dataDir: config.dataDir }));

await ensureDataDir(config.dataDir);
serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`forge-server listening on :${info.port} (data: ${config.dataDir})`);
});
