/**
 * Tags label notes across the axes: a normalized word list stored in
 * frontmatter, plus #tags typed anywhere in the body. Consumers (cards,
 * search, filters) work with the union of both via docTags.
 */

const TAG_MAX = 60;

/** Canonical form of one tag: lowercase, no leading #, spaces → dashes,
 * hashtag charset only (letters, numbers, _ and -). Returns '' when nothing
 * usable remains. */
export function normalizeTag(raw: string): string {
  return raw
    .trim()
    .replace(/^#+/, '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_-]/gu, '')
    .slice(0, TAG_MAX);
}

/** Normalize a list: per-tag cleanup, drop empties, dedupe keeping first
 * occurrence (order is user-visible on cards). */
export function normalizeTags(raw: readonly string[]): string[] {
  const out: string[] = [];
  for (const r of raw) {
    const t = normalizeTag(r);
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/** #tags typed in the body. A tag starts a word (`#` after start-of-line or
 * whitespace, so URL fragments and markdown headings don't match) and code
 * blocks don't count — a #define in a snippet is not a label. */
export function extractTags(body: string): string[] {
  const prose = stripFences(body);
  const found: string[] = [];
  for (const m of prose.matchAll(/(?:^|\s)#([\p{L}\p{N}][\p{L}\p{N}_-]*)/gu)) {
    found.push(m[1] as string);
  }
  return normalizeTags(found);
}

/** Frontmatter tags + body #tags, deduped, frontmatter first. */
export function docTags(tags: readonly string[], body: string): string[] {
  return normalizeTags([...tags, ...extractTags(body)]);
}

/** Body with all fenced code blocks removed (``` or ~~~, any info string).
 * An unclosed fence swallows the rest of the body, matching how markdown
 * renderers treat it. */
export function stripFences(body: string): string {
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of body.split('\n')) {
    const open = /^(```+|~~~+)/.exec(line.trimStart());
    if (fence) {
      if (open && open[1]?.startsWith(fence)) fence = null;
      continue;
    }
    if (open) {
      fence = open[1] as string;
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}
