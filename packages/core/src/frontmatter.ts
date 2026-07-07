import { parse as parseYaml } from 'yaml';
import {
  CAPTURE_DEFAULTS,
  DURABILITY,
  type Doc,
  FORMALITY,
  IMPORTANCE,
  type Reminder,
} from './types.js';

/**
 * Reads and writes the on-disk note format: YAML frontmatter + markdown body.
 *
 * Serialization is canonical by construction (fixed key order, fixed
 * formatting), so writing a parsed doc back never produces a spurious diff
 * (CLAUDE.md invariant 3). Parsing is deliberately more tolerant: files with
 * missing fields get defaults; only a missing id makes a file non-parseable,
 * and callers heal those via docFromExternal.
 */

const OPEN = '---\n';

export function serializeDoc(doc: Doc): string {
  const lines = [
    `id: ${doc.id}`,
    `created: ${doc.created}`,
    `updated: ${doc.updated}`,
    `durability: ${doc.durability}`,
    `formality: ${doc.formality}`,
    `importance: ${doc.importance}`,
    `pinned: ${doc.pinned}`,
    ...(doc.archived ? ['archived: true'] : []),
    `source: ${doc.source}`,
  ];
  if (doc.reminders.length > 0) {
    lines.push('reminders:');
    for (const r of doc.reminders) {
      lines.push(`  - at: ${r.at}`);
      if (r.rrule) lines.push(`    rrule: ${r.rrule}`);
      lines.push(`    status: ${r.status}`);
      if (r.snoozedUntil) lines.push(`    snoozedUntil: ${r.snoozedUntil}`);
    }
  }
  return `${OPEN}${lines.join('\n')}\n---\n${doc.body}\n`;
}

const pick = <T extends string>(v: unknown, allowed: readonly T[], dflt: T): T =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : dflt;

const str = (v: unknown, dflt: string): string => (typeof v === 'string' && v ? v : dflt);

function parseReminders(v: unknown): Reminder[] {
  if (!Array.isArray(v)) return [];
  const out: Reminder[] = [];
  for (const item of v) {
    if (typeof item !== 'object' || item === null) continue;
    const r = item as Record<string, unknown>;
    if (typeof r.at !== 'string') continue;
    out.push({
      at: r.at,
      ...(typeof r.rrule === 'string' ? { rrule: r.rrule } : {}),
      status: pick(r.status, ['active', 'done', 'snoozed'] as const, 'active'),
      ...(typeof r.snoozedUntil === 'string' ? { snoozedUntil: r.snoozedUntil } : {}),
    });
  }
  return out;
}

export interface ParsedDoc {
  doc: Doc;
  /** True when the file text is byte-identical to serializeDoc(doc) — i.e.
   * already in canonical form and safe to leave untouched on disk. */
  canonical: boolean;
}

/** Returns null when the text has no usable frontmatter (no delimiters, bad
 * YAML, or missing id) — callers heal such files instead of erroring. */
export function parseDoc(text: string): ParsedDoc | null {
  if (!text.startsWith(OPEN)) return null;
  const close = text.indexOf('\n---\n', 3);
  let yamlSrc: string;
  let rawBody: string;
  if (close !== -1) {
    yamlSrc = text.slice(4, close + 1);
    rawBody = text.slice(close + 5);
  } else if (text.endsWith('\n---')) {
    yamlSrc = text.slice(4, -3);
    rawBody = '';
  } else {
    return null;
  }

  let fm: unknown;
  try {
    fm = parseYaml(yamlSrc);
  } catch {
    return null;
  }
  if (typeof fm !== 'object' || fm === null) return null;
  const f = fm as Record<string, unknown>;
  if (typeof f.id !== 'string' || !f.id) return null;

  const body = rawBody.endsWith('\n') ? rawBody.slice(0, -1) : rawBody;
  const doc: Doc = {
    id: f.id,
    created: str(f.created, ''),
    updated: str(f.updated, str(f.created, '')),
    durability: pick(f.durability, DURABILITY, CAPTURE_DEFAULTS.durability),
    formality: pick(f.formality, FORMALITY, CAPTURE_DEFAULTS.formality),
    importance: pick(f.importance, IMPORTANCE, CAPTURE_DEFAULTS.importance),
    pinned: f.pinned === true,
    archived: f.archived === true,
    reminders: parseReminders(f.reminders),
    source: str(f.source, 'external'),
    body,
  };
  return { doc, canonical: serializeDoc(doc) === text };
}

/** Wraps a file that has no usable frontmatter (e.g. a plain markdown note
 * dropped in by hand or by an agent) into a valid doc, keeping the full text
 * as the body. */
export function docFromExternal(text: string, id: string, now: string): Doc {
  return {
    id,
    created: now,
    updated: now,
    ...CAPTURE_DEFAULTS,
    pinned: false,
    archived: false,
    reminders: [],
    source: 'external',
    body: text.endsWith('\n') ? text.slice(0, -1) : text,
  };
}
