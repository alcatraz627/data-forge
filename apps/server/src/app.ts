import {
  type CreateDocBody,
  DURABILITY,
  FORMALITY,
  IMPORTANCE,
  type Reminder,
  type UpdateDocBody,
  isDocId,
} from '@forge/core';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { ensureDataDir } from './data-dir.js';
import { currentSeq } from './db.js';
import { Forge } from './forge.js';

/** Assembles the HTTP surface over a Forge instance. Kept separate from the
 * process entrypoint so tests can drive the full stack via app.request()
 * without a socket. */
export interface ForgeApp {
  app: Hono;
  forge: Forge;
}

const MAX_BODY = 1_000_000;
const SOURCE_RE = /^[\w.:@-]{1,64}$/;

const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): v is T =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v);

const isIsoDate = (v: unknown): boolean =>
  typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v));

function validReminders(v: unknown): Reminder[] | null {
  if (v === undefined) return [];
  if (!Array.isArray(v)) return null;
  const out: Reminder[] = [];
  for (const item of v) {
    if (typeof item !== 'object' || item === null) return null;
    const r = item as Record<string, unknown>;
    if (typeof r.at !== 'string') return null;
    if (!oneOf(r.status, ['active', 'done', 'snoozed'] as const)) return null;
    out.push({
      at: r.at,
      ...(typeof r.rrule === 'string' ? { rrule: r.rrule } : {}),
      status: r.status,
      ...(typeof r.snoozedUntil === 'string' ? { snoozedUntil: r.snoozedUntil } : {}),
    });
  }
  return out;
}

type Validated<T> = { ok: T } | { error: string };

function axisErrors(f: Record<string, unknown>): string | null {
  if (f.durability !== undefined && !oneOf(f.durability, DURABILITY)) return 'bad durability';
  if (f.formality !== undefined && !oneOf(f.formality, FORMALITY)) return 'bad formality';
  if (f.importance !== undefined && !oneOf(f.importance, IMPORTANCE)) return 'bad importance';
  if (f.pinned !== undefined && typeof f.pinned !== 'boolean') return 'bad pinned';
  if (f.archived !== undefined && typeof f.archived !== 'boolean') return 'bad archived';
  return null;
}

function parseCreate(raw: unknown): Validated<CreateDocBody> {
  if (typeof raw !== 'object' || raw === null) return { error: 'expected a JSON object' };
  const f = raw as Record<string, unknown>;
  if (typeof f.body !== 'string' || f.body.trim() === '') return { error: 'body required' };
  if (f.body.length > MAX_BODY) return { error: 'body too large' };
  if (typeof f.source !== 'string' || !SOURCE_RE.test(f.source)) return { error: 'bad source' };
  if (f.id !== undefined && (typeof f.id !== 'string' || !isDocId(f.id)))
    return { error: 'bad id' };
  if (f.created !== undefined && !isIsoDate(f.created)) return { error: 'bad created' };
  if (f.updated !== undefined && !isIsoDate(f.updated)) return { error: 'bad updated' };
  const axisErr = axisErrors(f);
  if (axisErr) return { error: axisErr };
  const reminders = validReminders(f.reminders);
  if (reminders === null) return { error: 'bad reminders' };
  return {
    ok: {
      ...(f.id !== undefined ? { id: f.id as string } : {}),
      body: f.body,
      source: f.source,
      ...(f.created !== undefined ? { created: f.created as string } : {}),
      ...(f.updated !== undefined ? { updated: f.updated as string } : {}),
      ...(f.durability !== undefined ? { durability: f.durability as never } : {}),
      ...(f.formality !== undefined ? { formality: f.formality as never } : {}),
      ...(f.importance !== undefined ? { importance: f.importance as never } : {}),
      ...(f.pinned !== undefined ? { pinned: f.pinned as boolean } : {}),
      ...(f.archived !== undefined ? { archived: f.archived as boolean } : {}),
      ...(f.reminders !== undefined ? { reminders } : {}),
    },
  };
}

function parseUpdate(raw: unknown): Validated<UpdateDocBody> {
  if (typeof raw !== 'object' || raw === null) return { error: 'expected a JSON object' };
  const f = raw as Record<string, unknown>;
  if (typeof f.baseRev !== 'number' || !Number.isInteger(f.baseRev) || f.baseRev < 1)
    return { error: 'baseRev required' };
  if (f.body !== undefined && typeof f.body !== 'string') return { error: 'bad body' };
  if (typeof f.body === 'string' && f.body.length > MAX_BODY) return { error: 'body too large' };
  const axisErr = axisErrors(f);
  if (axisErr) return { error: axisErr };
  const reminders = f.reminders !== undefined ? validReminders(f.reminders) : [];
  if (reminders === null) return { error: 'bad reminders' };
  const out: UpdateDocBody = { baseRev: f.baseRev };
  if (f.body !== undefined) out.body = f.body as string;
  if (f.durability !== undefined) out.durability = f.durability as never;
  if (f.formality !== undefined) out.formality = f.formality as never;
  if (f.importance !== undefined) out.importance = f.importance as never;
  if (f.pinned !== undefined) out.pinned = f.pinned as boolean;
  if (f.archived !== undefined) out.archived = f.archived as boolean;
  if (f.reminders !== undefined) out.reminders = reminders;
  if (Object.keys(out).length === 1) return { error: 'no fields to update' };
  return { ok: out };
}

async function jsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export async function createForgeApp(opts: {
  dataDir: string;
  gitQuietMs?: number;
  archiveDays?: number;
}): Promise<ForgeApp> {
  await ensureDataDir(opts.dataDir);
  const forge = new Forge(opts.dataDir, opts);
  const counts = forge.reconcile();
  if (counts.changed > 0 || counts.removed > 0) {
    console.log(
      `reconcile: ${counts.files} files, ${counts.changed} changed, ${counts.removed} removed`,
    );
  }
  if (opts.archiveDays !== undefined) {
    const n = forge.archiveStale(opts.archiveDays * 86_400_000, Date.now());
    if (n > 0) console.log(`archive: swept ${n} stale ephemeral note(s)`);
  }

  const app = new Hono();

  app.get('/health', (c) =>
    c.json({ ok: true, dataDir: forge.dataDir, seq: currentSeq(forge.db) }),
  );

  app.get('/api/changes', (c) => {
    const since = Number(c.req.query('since') ?? '0');
    if (!Number.isFinite(since) || since < 0) return c.json({ error: 'bad since' }, 400);
    return c.json(forge.changes(since));
  });

  app.get('/api/search', (c) => c.json({ results: forge.search(c.req.query('q') ?? '') }));

  app.get('/api/agenda', (c) => c.json({ entries: forge.agenda(new Date()) }));

  app.post('/api/reminders/complete', (c) => {
    const docId = c.req.query('doc') ?? '';
    const index = Number(c.req.query('index'));
    if (!docId || !Number.isInteger(index) || index < 0)
      return c.json({ error: 'bad params' }, 400);
    const doc = forge.completeReminderAt(docId, index, new Date());
    return doc ? c.json(doc) : c.json({ error: 'not found' }, 404);
  });

  app.get('/api/docs/:id', (c) => {
    const doc = forge.getDoc(c.req.param('id'));
    return doc ? c.json(doc) : c.json({ error: 'not found' }, 404);
  });

  app.get('/api/docs/:id/history', async (c) =>
    c.json({ history: await forge.history(c.req.param('id')) }),
  );

  app.get('/api/docs/:id/history/:commit', async (c) => {
    const body = await forge.revisionAt(c.req.param('id'), c.req.param('commit'));
    return body === null ? c.json({ error: 'not found' }, 404) : c.json({ body });
  });

  app.post('/api/docs', async (c) => {
    const parsed = parseCreate(await jsonBody(c.req.raw));
    if ('error' in parsed) return c.json({ error: parsed.error }, 400);
    const result = forge.createDoc(parsed.ok);
    if ('error' in result) return c.json({ error: result.error }, 409);
    return c.json(result.ok, 201);
  });

  app.put('/api/docs/:id', async (c) => {
    const parsed = parseUpdate(await jsonBody(c.req.raw));
    if ('error' in parsed) return c.json({ error: parsed.error }, 400);
    const result = forge.updateDoc(c.req.param('id'), parsed.ok);
    return result ? c.json(result) : c.json({ error: 'not found' }, 404);
  });

  app.delete('/api/docs/:id', (c) =>
    forge.deleteDoc(c.req.param('id')) ? c.json({ ok: true }) : c.json({ error: 'not found' }, 404),
  );

  app.get('/api/events', (c) =>
    streamSSE(c, async (stream) => {
      let live = true;
      let unsub: () => void = () => {};
      stream.onAbort(() => {
        live = false;
        unsub();
      });
      unsub = forge.events.subscribe((seq) => {
        void stream.writeSSE({ event: 'change', data: String(seq) });
      });
      await stream.writeSSE({ event: 'hello', data: String(currentSeq(forge.db)) });
      while (live) {
        await stream.sleep(25_000);
        if (live) await stream.writeSSE({ event: 'ping', data: '' });
      }
    }),
  );

  return { app, forge };
}
