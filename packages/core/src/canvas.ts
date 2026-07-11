/**
 * Canvas drawings live inside ordinary markdown notes, so one note can mix
 * prose and any number of tldraw canvases and the whole pipeline — outbox,
 * merge, history, git — keeps working on them for free. Each canvas is a
 * fenced block: an info line naming the format, one line of snapshot JSON,
 * and a closing fence. JSON.stringify never emits raw newlines, so the
 * snapshot can never break out of its fence.
 */

export const CANVAS_FENCE = '```forge-canvas v1';

/** The legacy whole-note canvas format (marker line + JSON body). Kept only
 * so the server can migrate old files; nothing should write it anymore. */
export const LEGACY_CANVAS_MARKER = '<!-- forge:canvas v1 -->';

export function isLegacyCanvas(body: string): boolean {
  return body.startsWith(LEGACY_CANVAS_MARKER);
}

/** One canvas fence, ready to embed in (or be) a note body. */
export function canvasBlockText(snapshot: unknown): string {
  return `${CANVAS_FENCE}\n${JSON.stringify(snapshot)}\n\`\`\``;
}

/** A fresh note body holding a single empty canvas. */
export function emptyCanvasBody(): string {
  return canvasBlockText({});
}

export function hasCanvasBlock(body: string): boolean {
  return listCanvasBlocks(body).length > 0;
}

export interface CanvasBlock {
  /** The tldraw snapshot, or null when the JSON is corrupt. */
  snapshot: unknown | null;
  /** Line range of the whole fence in the body (inclusive), so editors can
   * replace one block without touching the prose around it. */
  startLine: number;
  endLine: number;
}

/** Every canvas fence in a body, in document order. Tolerates a missing
 * closing fence (the block runs to the end, like markdown renderers do). */
export function listCanvasBlocks(body: string): CanvasBlock[] {
  const lines = body.split('\n');
  const blocks: CanvasBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    if ((lines[i] as string).trim() !== CANVAS_FENCE) {
      i++;
      continue;
    }
    const start = i;
    let end = lines.length - 1;
    const json: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      if ((lines[j] as string).trim() === '```') {
        end = j;
        break;
      }
      json.push(lines[j] as string);
    }
    let snapshot: unknown | null = null;
    try {
      snapshot = JSON.parse(json.join('\n'));
    } catch {
      // corrupt block — surfaced as null so the editor can show it inert
    }
    blocks.push({ snapshot, startLine: start, endLine: end });
    i = end + 1;
  }
  return blocks;
}

/** Replace the JSON of the block starting at startLine, leaving prose and
 * sibling blocks untouched. Returns the body unchanged if no block is there. */
export function replaceCanvasBlock(body: string, startLine: number, snapshot: unknown): string {
  const block = listCanvasBlocks(body).find((b) => b.startLine === startLine);
  if (!block) return body;
  const lines = body.split('\n');
  lines.splice(block.startLine, block.endLine - block.startLine + 1, ...canvasBlockText(snapshot).split('\n'));
  return lines.join('\n');
}

/** Body with canvas fences removed — the prose that titles, previews, and
 * search should see. */
export function stripCanvasBlocks(body: string): string {
  const blocks = listCanvasBlocks(body);
  if (blocks.length === 0) return body;
  const lines = body.split('\n');
  const keep: string[] = [];
  let b = 0;
  for (let i = 0; i < lines.length; i++) {
    const block = blocks[b];
    if (block && i >= block.startLine) {
      if (i === block.endLine) b++;
      continue;
    }
    keep.push(lines[i] as string);
  }
  return keep.join('\n');
}

/** Legacy whole-note canvas → a note body with one canvas fence. Non-legacy
 * bodies pass through untouched, so this is safe to run over everything. */
export function migrateLegacyCanvas(body: string): string {
  if (!isLegacyCanvas(body)) return body;
  const json = body.slice(LEGACY_CANVAS_MARKER.length).trim();
  let snapshot: unknown = {};
  if (json) {
    try {
      snapshot = JSON.parse(json);
    } catch {
      return body; // corrupt legacy body — leave it for a human, never destroy
    }
  }
  return canvasBlockText(snapshot);
}
