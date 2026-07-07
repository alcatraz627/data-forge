/**
 * Canvas notes are still markdown files, so they sync, back up, and version
 * exactly like text notes. A leading marker line tags the note as a canvas and
 * the rest of the body is the tldraw snapshot as JSON. Keeping it one file (not
 * a separate boards/ format) means the whole pipeline — outbox, merge, history,
 * git — works on canvases for free.
 */

export const CANVAS_MARKER = '<!-- forge:canvas v1 -->';

export function isCanvas(body: string): boolean {
  return body.startsWith(CANVAS_MARKER);
}

/** The tldraw snapshot embedded in a canvas note, or null if absent/corrupt.
 * Returns unknown so callers hand it straight to tldraw without core depending
 * on tldraw's types. */
export function parseCanvas(body: string): unknown | null {
  if (!isCanvas(body)) return null;
  const json = body.slice(CANVAS_MARKER.length).trim();
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function canvasToBody(snapshot: unknown): string {
  return `${CANVAS_MARKER}\n${JSON.stringify(snapshot)}`;
}

/** A fresh, empty canvas note body (no shapes yet). */
export function emptyCanvasBody(): string {
  return `${CANVAS_MARKER}\n{}`;
}
