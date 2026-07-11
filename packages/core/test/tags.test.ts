import { describe, expect, it } from 'vitest';
import { canvasBlockText } from '../src/canvas.js';
import { docTags, extractTags, normalizeTag, normalizeTags } from '../src/tags.js';

describe('tag normalization', () => {
  it('lowercases, strips #, dashes spaces, filters charset', () => {
    expect(normalizeTag('#Home')).toBe('home');
    expect(normalizeTag('  my tag  ')).toBe('my-tag');
    expect(normalizeTag('c++')).toBe('c');
    expect(normalizeTag("it's")).toBe('its');
    expect(normalizeTag('##double')).toBe('double');
    expect(normalizeTag('   ')).toBe('');
  });

  it('keeps unicode letters and numbers', () => {
    expect(normalizeTag('café')).toBe('café');
    expect(normalizeTag('2026')).toBe('2026');
  });

  it('dedupes preserving first occurrence and drops empties', () => {
    expect(normalizeTags(['Home', 'plants', '#home', '', 'plants'])).toEqual(['home', 'plants']);
  });
});

describe('body #tag extraction', () => {
  it('finds tags at line starts and after whitespace', () => {
    expect(extractTags('water them #plants\n#home stuff')).toEqual(['plants', 'home']);
  });

  it('ignores markdown headings and URL fragments', () => {
    expect(extractTags('# A heading\n## Another')).toEqual([]);
    expect(extractTags('see https://x.com/page#section')).toEqual([]);
  });

  it('ignores tags inside code fences and canvas blocks', () => {
    expect(extractTags('```sh\necho #notatag\n```\nreal #tag')).toEqual(['tag']);
    expect(extractTags(`${canvasBlockText({ note: '#embedded' })}\n#real`)).toEqual(['real']);
  });

  it('unions frontmatter and body tags, frontmatter first', () => {
    expect(docTags(['home'], 'water #plants and #home things')).toEqual(['home', 'plants']);
  });
});
