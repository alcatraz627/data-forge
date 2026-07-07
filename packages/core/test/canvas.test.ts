import { describe, expect, it } from 'vitest';
import {
  CANVAS_MARKER,
  canvasToBody,
  emptyCanvasBody,
  isCanvas,
  parseCanvas,
} from '../src/canvas.js';

describe('canvas notes', () => {
  it('detects canvas notes by the marker', () => {
    expect(isCanvas(emptyCanvasBody())).toBe(true);
    expect(isCanvas('# just a text note')).toBe(false);
  });

  it('round-trips a snapshot through the body', () => {
    const snap = { schema: 1, records: [{ id: 'shape:a', x: 10 }] };
    const body = canvasToBody(snap);
    expect(body.startsWith(CANVAS_MARKER)).toBe(true);
    expect(parseCanvas(body)).toEqual(snap);
  });

  it('returns null for non-canvas or corrupt bodies', () => {
    expect(parseCanvas('plain note')).toBeNull();
    expect(parseCanvas(`${CANVAS_MARKER}\n{not json`)).toBeNull();
    expect(parseCanvas(emptyCanvasBody())).toEqual({});
  });
});
