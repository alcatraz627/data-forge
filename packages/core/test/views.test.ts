import { describe, expect, it } from 'vitest';
import { DEFAULT_VIEWS, type ViewDef, matchesView } from '../src/views.js';

const view = (id: string): ViewDef => {
  const v = DEFAULT_VIEWS.find((x) => x.id === id);
  if (!v) throw new Error(`no view ${id}`);
  return v;
};

const doc = (over: Partial<Parameters<typeof matchesView>[0]> = {}) => ({
  durability: 'ephemeral' as const,
  formality: 'scratch' as const,
  importance: 'normal' as const,
  source: 'web',
  pinned: false,
  archived: false,
  ...over,
});

describe('default views', () => {
  it('Now = urgent and short-lived', () => {
    expect(matchesView(doc({ importance: 'high' }), view('now'))).toBe(true);
    expect(matchesView(doc({ importance: 'normal' }), view('now'))).toBe(false);
    expect(matchesView(doc({ importance: 'critical', durability: 'permanent' }), view('now'))).toBe(
      false,
    );
  });

  it('Scratchpad = ephemeral only', () => {
    expect(matchesView(doc(), view('scratch'))).toBe(true);
    expect(matchesView(doc({ durability: 'working' }), view('scratch'))).toBe(false);
  });

  it('Reference = durable and permanent', () => {
    expect(matchesView(doc({ durability: 'durable' }), view('reference'))).toBe(true);
    expect(matchesView(doc({ durability: 'permanent' }), view('reference'))).toBe(true);
    expect(matchesView(doc(), view('reference'))).toBe(false);
  });

  it('conflict copies appear only in All and Conflicts', () => {
    const conflict = doc({ source: 'conflict:01ABC' });
    expect(matchesView(conflict, view('all'))).toBe(true);
    expect(matchesView(conflict, view('conflicts'))).toBe(true);
    expect(matchesView(conflict, view('scratch'))).toBe(false);
    expect(matchesView(doc(), view('conflicts'))).toBe(false);
  });

  it('archived docs appear only in Archive; active views exclude them', () => {
    const archived = doc({ archived: true, durability: 'ephemeral' });
    expect(matchesView(archived, view('archive'))).toBe(true);
    expect(matchesView(archived, view('all'))).toBe(false);
    expect(matchesView(archived, view('scratch'))).toBe(false);
    expect(matchesView(doc(), view('archive'))).toBe(false);
  });

  // Regression: a pre-M1 server omits `archived` entirely. Strict comparison
  // against undefined hid every such note from every normal view — the phone
  // "data getting deleted" incident (2026-07-08). Docs without the field must
  // count as not-archived.
  it('a doc with no archived field still matches active views', () => {
    const legacy = doc({ archived: undefined as unknown as boolean });
    expect(matchesView(legacy, view('all'))).toBe(true);
    expect(matchesView(legacy, view('scratch'))).toBe(true);
    expect(matchesView(legacy, view('archive'))).toBe(false);
  });
});
