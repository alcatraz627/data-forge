import { describe, expect, it } from 'vitest';
import {
  CANVAS_FENCE,
  LEGACY_CANVAS_MARKER,
  canvasBlockText,
  emptyCanvasBody,
  hasCanvasBlock,
  isLegacyCanvas,
  listCanvasBlocks,
  migrateLegacyCanvas,
  replaceCanvasBlock,
  stripCanvasBlocks,
} from '../src/canvas.js';

const snap = { schema: 1, records: [{ id: 'shape:a', x: 10 }] };

describe('canvas blocks', () => {
  it('detects canvas blocks anywhere in the body', () => {
    expect(hasCanvasBlock(emptyCanvasBody())).toBe(true);
    expect(hasCanvasBlock(`# prose\n\n${canvasBlockText(snap)}\n\nmore prose`)).toBe(true);
    expect(hasCanvasBlock('# just a text note')).toBe(false);
    expect(hasCanvasBlock('```ts\nconst x = 1\n```')).toBe(false);
  });

  it('round-trips a snapshot through a block', () => {
    const body = canvasBlockText(snap);
    expect(body.startsWith(CANVAS_FENCE)).toBe(true);
    expect(listCanvasBlocks(body)[0]?.snapshot).toEqual(snap);
  });

  it('lists multiple blocks in document order with line ranges', () => {
    const body = ['intro', canvasBlockText(snap), 'middle', canvasBlockText({}), 'end'].join('\n');
    const blocks = listCanvasBlocks(body);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.startLine).toBe(1);
    expect(blocks[0]?.endLine).toBe(3);
    expect(blocks[1]?.snapshot).toEqual({});
  });

  it('marks corrupt JSON as null without dropping the block', () => {
    const body = `${CANVAS_FENCE}\n{not json\n\`\`\``;
    const blocks = listCanvasBlocks(body);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.snapshot).toBeNull();
  });

  it('tolerates a missing closing fence', () => {
    const body = `prose\n${CANVAS_FENCE}\n${JSON.stringify(snap)}`;
    const blocks = listCanvasBlocks(body);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.snapshot).toEqual(snap);
  });

  it('replaces one block leaving prose and siblings alone', () => {
    const body = ['intro', canvasBlockText({}), 'outro', canvasBlockText(snap)].join('\n');
    const first = listCanvasBlocks(body)[0];
    const updated = replaceCanvasBlock(body, first?.startLine ?? 0, snap);
    const blocks = listCanvasBlocks(updated);
    expect(blocks[0]?.snapshot).toEqual(snap);
    expect(blocks[1]?.snapshot).toEqual(snap);
    expect(updated.startsWith('intro\n')).toBe(true);
    expect(updated.includes('outro')).toBe(true);
    expect(replaceCanvasBlock(body, 999, snap)).toBe(body);
  });

  it('strips blocks for title/preview/search prose', () => {
    const body = `# Sketch notes\n${canvasBlockText(snap)}\nafter the drawing`;
    expect(stripCanvasBlocks(body)).toBe('# Sketch notes\nafter the drawing');
    expect(stripCanvasBlocks('no blocks here')).toBe('no blocks here');
  });
});

describe('legacy canvas migration', () => {
  const legacy = `${LEGACY_CANVAS_MARKER}\n${JSON.stringify(snap)}`;

  it('migrates a legacy body to one canvas block', () => {
    expect(isLegacyCanvas(legacy)).toBe(true);
    const migrated = migrateLegacyCanvas(legacy);
    expect(isLegacyCanvas(migrated)).toBe(false);
    expect(listCanvasBlocks(migrated)[0]?.snapshot).toEqual(snap);
  });

  it('passes non-legacy bodies through untouched', () => {
    for (const body of ['plain note', emptyCanvasBody(), '']) {
      expect(migrateLegacyCanvas(body)).toBe(body);
    }
  });

  it('leaves corrupt legacy bodies alone rather than destroying them', () => {
    const corrupt = `${LEGACY_CANVAS_MARKER}\n{not json`;
    expect(migrateLegacyCanvas(corrupt)).toBe(corrupt);
  });

  it('migrates an empty legacy canvas to an empty block', () => {
    const empty = `${LEGACY_CANVAS_MARKER}\n{}`;
    expect(migrateLegacyCanvas(empty)).toBe(emptyCanvasBody());
  });
});
