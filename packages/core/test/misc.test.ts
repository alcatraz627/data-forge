import { describe, expect, it } from 'vitest';
import { idTime, isDocId, newId } from '../src/ids.js';
import { nowIso } from '../src/time.js';
import { derivePreview, deriveTitle } from '../src/title.js';

describe('ids', () => {
  it('generates valid, unique, time-sortable ids', () => {
    const a = newId();
    expect(isDocId(a)).toBe(true);
    const ids = new Set(Array.from({ length: 1000 }, () => newId()));
    expect(ids.size).toBe(1000);
  });

  it('recovers creation time from the id', () => {
    const before = Date.now();
    const id = newId();
    const t = idTime(id).getTime();
    expect(t).toBeGreaterThanOrEqual(before - 1);
    expect(t).toBeLessThanOrEqual(Date.now() + 1);
  });
});

describe('nowIso', () => {
  it('produces ISO-8601 with an explicit offset', () => {
    expect(nowIso()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  });

  it('parses back to the same instant', () => {
    const d = new Date(2026, 6, 7, 9, 12, 3);
    expect(new Date(nowIso(d)).getTime()).toBe(d.getTime());
  });
});

describe('title derivation', () => {
  it('prefers the first heading, stripped of #', () => {
    expect(deriveTitle('# Big idea\nmore text')).toBe('Big idea');
  });

  it('falls back to the first non-empty line', () => {
    expect(deriveTitle('\n\n  hello there  \nrest')).toBe('hello there');
  });

  it('handles empty bodies and truncates long titles', () => {
    expect(deriveTitle('')).toBe('Untitled');
    expect(deriveTitle('x'.repeat(300)).length).toBeLessThanOrEqual(120);
  });

  it('previews skip the title line', () => {
    expect(derivePreview('# Title\nsecond line\nthird')).toBe('second line third');
    expect(derivePreview('only line')).toBe('');
  });
});
