/** A note's display title is derived from its body — the first heading if
 * present, else the first non-empty line — and never stored (CLAUDE.md
 * invariant 8), so capture requires no naming step and titles can't drift.
 * Canvas blocks are invisible to titles; a note that is only a canvas is
 * called "Canvas". */
import { hasCanvasBlock, isLegacyCanvas, stripCanvasBlocks } from './canvas.js';

export function deriveTitle(body: string, max = 120): string {
  if (isLegacyCanvas(body)) return 'Canvas';
  const prose = stripCanvasBlocks(body);
  for (const raw of prose.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const title = line.replace(/^#{1,6}\s+/, '').trim() || line;
    return title.length > max ? `${title.slice(0, max - 1)}…` : title;
  }
  return hasCanvasBlock(body) ? 'Canvas' : 'Untitled';
}

/** One-line body excerpt for list cards, skipping the line the title came from. */
export function derivePreview(body: string, max = 140): string {
  if (isLegacyCanvas(body)) return '';
  const lines = stripCanvasBlocks(body)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const preview = lines.slice(1).join(' ');
  return preview.length > max ? `${preview.slice(0, max - 1)}…` : preview;
}
