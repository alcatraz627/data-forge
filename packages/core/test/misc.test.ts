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

  it('reads as text, not markdown: escapes undone, checklists become glyphs', () => {
    expect(derivePreview('# T\n- \\[ \\] oat milk\n- \\[x\\] coffee')).toBe('☐ oat milk ☑ coffee');
    expect(derivePreview('# T\n- [ ] eggs\n* [X] done one')).toBe('☐ eggs ☑ done one');
    expect(derivePreview('# T\n**bold** and `code` and [a link](http://x)')).toBe(
      'bold and code and a link',
    );
    expect(deriveTitle('Review \\[urgent\\] doc')).toBe('Review [urgent] doc');
    expect(deriveTitle('- [ ] first task')).toBe('☐ first task');
  });

  it('previews a drawing-only note by its size', () => {
    const canvas = (store: string) =>
      `\`\`\`forge-canvas v1\n{"document":{"store":{${store}}}}\n\`\`\``;
    expect(derivePreview(canvas('"shape:a":1,"shape:b":2'))).toBe('2 shapes');
    expect(derivePreview(`# Sketch\n${canvas('"shape:a":1')}`)).toBe('1 shape');
    expect(derivePreview(canvas(''))).toBe('empty canvas');
    expect(derivePreview(`# T\nprose wins\n${canvas('"shape:a":1')}`)).toBe('prose wins');
  });
});
