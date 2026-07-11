/** A note's display title is derived from its body — the first heading if
 * present, else the first non-empty line — and never stored (CLAUDE.md
 * invariant 8), so capture requires no naming step and titles can't drift.
 * Titles and previews are READABLE text: markdown syntax and serializer
 * escapes are stripped, checklists become ☐/☑ glyphs, and a note that is
 * only a canvas says how much is drawn instead of showing nothing. */
import { hasCanvasBlock, isLegacyCanvas, listCanvasBlocks, stripCanvasBlocks } from './canvas.js';

/** One body line as a human reads it, not as markdown stores it. The rich
 * editor's serializer escapes punctuation (\[ \]), and raw markers leak
 * badly on cards — this undoes presentation syntax without touching words. */
function cleanLine(raw: string): string {
  return raw
    .trim()
    .replace(/\\([\\`*_{}[\]()#+.!>~|-])/g, '$1')
    .replace(/^#{1,6}\s+/, '')
    .replace(/^>\s?/, '')
    .replace(/^[-*+]\s+\[\s?\]\s*/i, '☐ ')
    .replace(/^[-*+]\s+\[x\]\s*/i, '☑ ')
    .replace(/^[-*+]\s+/, '· ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|`)/g, '')
    .trim();
}

export function deriveTitle(body: string, max = 120): string {
  if (isLegacyCanvas(body)) return 'Canvas';
  const prose = stripCanvasBlocks(body);
  for (const raw of prose.split('\n')) {
    if (!raw.trim()) continue;
    const title = cleanLine(raw) || raw.trim();
    return title.length > max ? `${title.slice(0, max - 1)}…` : title;
  }
  return hasCanvasBlock(body) ? 'Canvas' : 'Untitled';
}

/** How many tldraw shapes one snapshot holds — the honest size metric for
 * canvas cards and previews. */
export function snapshotShapeCount(snapshot: unknown): number {
  const snap = snapshot as
    | { document?: { store?: Record<string, unknown> }; store?: Record<string, unknown> }
    | null;
  const store = snap?.document?.store ?? snap?.store ?? {};
  return Object.keys(store).filter((k) => k.startsWith('shape:')).length;
}

/** Total tldraw shapes across every canvas block in a body. */
export function canvasShapeCount(body: string): number {
  return listCanvasBlocks(body).reduce((n, b) => n + snapshotShapeCount(b.snapshot), 0);
}

/** One-line body excerpt for list cards, skipping the line the title came
 * from. A drawing-only note previews its size ("2 shapes") so identical
 * "Canvas" cards stay tellable-apart. */
export function derivePreview(body: string, max = 140): string {
  if (isLegacyCanvas(body)) return '';
  const lines = stripCanvasBlocks(body)
    .split('\n')
    .map(cleanLine)
    .filter(Boolean);
  const preview = lines.slice(1).join(' ');
  if (!preview && hasCanvasBlock(body)) {
    const n = canvasShapeCount(body);
    return n === 0 ? 'empty canvas' : `${n} shape${n === 1 ? '' : 's'}`;
  }
  return preview.length > max ? `${preview.slice(0, max - 1)}…` : preview;
}
