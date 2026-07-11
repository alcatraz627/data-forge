import { describe, expect, it } from 'vitest';
import { docFromExternal, parseDoc, serializeDoc } from '../src/frontmatter.js';
import { DURABILITY, type Doc, FORMALITY, IMPORTANCE, type Reminder } from '../src/types.js';

const baseDoc = (over: Partial<Doc> = {}): Doc => ({
  id: '01J1QG8Z3WABCDEFGHJKMNPQRS',
  created: '2026-07-07T09:12:03+05:30',
  updated: '2026-07-07T09:14:22+05:30',
  durability: 'ephemeral',
  formality: 'scratch',
  importance: 'normal',
  pinned: false,
  archived: false,
  reminders: [],
  source: 'web',
  tags: [],
  body: 'Hello world',
  ...over,
});

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LINE_POOL = [
  'plain line',
  '# a heading',
  '---',
  '--- not a delimiter mid-body ---',
  'unicode ✓ émoji 🙂',
  '',
  '  indented text',
  'key: value looking line',
  '```ts',
  'trailing spaces  ',
  '- list item',
];

function randomDoc(rnd: () => number): Doc {
  const pickFrom = <T>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)] as T;
  const reminders: Reminder[] = [];
  const n = Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    reminders.push({
      at: '2026-07-08T09:00:00+05:30',
      ...(rnd() > 0.5 ? { rrule: 'FREQ=WEEKLY;BYDAY=TU' } : {}),
      status: pickFrom(['active', 'done', 'snoozed'] as const),
      ...(rnd() > 0.7 ? { snoozedUntil: '2026-07-09T09:00:00+05:30' } : {}),
    });
  }
  const lines = Array.from({ length: Math.floor(rnd() * 8) }, () => pickFrom(LINE_POOL));
  const TAG_POOL = ['home', 'plants', 'true', '2026', 'a-b_c', 'café'];
  const tags = [...new Set(Array.from({ length: Math.floor(rnd() * 4) }, () => pickFrom(TAG_POOL)))];
  return baseDoc({
    durability: pickFrom(DURABILITY),
    formality: pickFrom(FORMALITY),
    importance: pickFrom(IMPORTANCE),
    pinned: rnd() > 0.5,
    archived: rnd() > 0.7,
    reminders,
    source: pickFrom(['web', 'menubar', 'android-widget', 'api:claude', 'import:keep']),
    tags,
    body: lines.join('\n'),
  });
}

describe('frontmatter roundtrip', () => {
  it('parse(serialize(doc)) equals doc, byte-stably, across 300 random docs', () => {
    const rnd = mulberry32(20260707);
    for (let i = 0; i < 300; i++) {
      const doc = randomDoc(rnd);
      const text = serializeDoc(doc);
      const parsed = parseDoc(text);
      expect(parsed, `iteration ${i}`).not.toBeNull();
      expect(parsed?.doc, `iteration ${i}`).toEqual(doc);
      expect(parsed?.canonical, `iteration ${i}`).toBe(true);
      expect(serializeDoc(parsed!.doc), `iteration ${i}`).toBe(text);
    }
  });

  it('keeps trailing newlines in the body stable through the roundtrip', () => {
    for (const body of ['abc', 'abc\n', 'abc\n\n', '', '\n']) {
      const doc = baseDoc({ body });
      expect(parseDoc(serializeDoc(doc))?.doc.body).toBe(body);
    }
  });

  it('is not confused by --- lines inside the body', () => {
    const doc = baseDoc({ body: 'above\n---\nbelow' });
    expect(parseDoc(serializeDoc(doc))?.doc.body).toBe('above\n---\nbelow');
  });

  it('omits the tags line entirely when empty — existing files must not churn', () => {
    expect(serializeDoc(baseDoc())).not.toContain('tags:');
  });

  it('keeps YAML-hostile tags as strings via quoting', () => {
    const doc = baseDoc({ tags: ['true', 'no', '2026', 'null'] });
    const parsed = parseDoc(serializeDoc(doc));
    expect(parsed?.doc.tags).toEqual(['true', 'no', '2026', 'null']);
    expect(parsed?.canonical).toBe(true);
  });

  it('heals hand-written unquoted tags to canonical form', () => {
    const parsed = parseDoc(
      '---\nid: 01J1QG8Z3WABCDEFGHJKMNPQRS\ntags: [Home, plants]\n---\nhi\n',
    );
    expect(parsed?.doc.tags).toEqual(['home', 'plants']);
    expect(parsed?.canonical).toBe(false);
  });
});

describe('parse tolerance', () => {
  it('fills defaults for minimal hand-written frontmatter', () => {
    const parsed = parseDoc('---\nid: 01J1QG8Z3WABCDEFGHJKMNPQRS\n---\nhi\n');
    expect(parsed).not.toBeNull();
    expect(parsed?.doc).toMatchObject({
      durability: 'ephemeral',
      formality: 'scratch',
      importance: 'normal',
      pinned: false,
      archived: false,
      reminders: [],
      source: 'external',
      body: 'hi',
    });
    expect(parsed?.canonical).toBe(false);
  });

  it('returns null for missing frontmatter, bad yaml, or missing id', () => {
    expect(parseDoc('just some text')).toBeNull();
    expect(parseDoc('---\n[not: valid: yaml\n---\nbody\n')).toBeNull();
    expect(parseDoc('---\ncreated: 2026-01-01\n---\nbody\n')).toBeNull();
  });

  it('wraps frontmatter-less files via docFromExternal', () => {
    const doc = docFromExternal(
      'plain note\n',
      '01J1QG8Z3WABCDEFGHJKMNPQRS',
      '2026-07-07T10:00:00+05:30',
    );
    expect(doc.body).toBe('plain note');
    expect(doc.source).toBe('external');
    const roundtripped = parseDoc(serializeDoc(doc));
    expect(roundtripped?.doc).toEqual(doc);
  });
});
