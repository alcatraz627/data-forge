import { listCanvasBlocks, snapshotShapeCount } from '@forge/core';
import { Suspense, lazy } from 'react';

export interface NoteEditorProps {
  value: string;
  onChange: (markdown: string) => void;
  mode: 'rich' | 'raw';
  autoFocus?: boolean;
  /** Called when the user taps a canvas block card; receives the fence's
   * startLine in the current body. The host opens tldraw fullscreen for it. */
  onOpenCanvas?: (startLine: number) => void;
}

const LazyRichEditor = lazy(() => import('./RichEditor'));

/**
 * The single editing surface the app is allowed to use (ADR-0003): markdown
 * in, markdown out, implementations swappable behind this contract. Nothing
 * outside this directory may import a specific editor library.
 *
 * One note is one markdown body, but a body can hold canvas blocks
 * (ADR-0006). Those render as inline cards between the editable prose runs —
 * tldraw itself never loads here; the host opens it fullscreen on tap. Raw
 * mode is the whole body verbatim, fences included.
 */
export function NoteEditor({ value, onChange, mode, autoFocus, onOpenCanvas }: NoteEditorProps) {
  if (mode === 'raw') {
    return (
      <textarea
        className="raw-editor"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
      />
    );
  }

  const segments = segment(value);
  const proseCount = segments.filter((s) => s.kind === 'prose').length;
  return (
    <div className="note-body">
      {segments.map((seg, i) => {
        if (seg.kind === 'canvas') {
          return (
            <CanvasBlockCard
              // biome-ignore lint/suspicious/noArrayIndexKey: segments have no stable id; order defines them
              key={`c${i}`}
              snapshot={seg.snapshot}
              onOpen={onOpenCanvas ? () => onOpenCanvas(seg.startLine) : undefined}
            />
          );
        }
        // A lone empty prose run (blank note) still gets an editor; empty
        // runs BETWEEN canvas blocks don't — raw mode covers that rare edit.
        if (seg.text.trim() === '' && proseCount > 1) return null;
        return (
          <Suspense
            // biome-ignore lint/suspicious/noArrayIndexKey: segments have no stable id; order defines them
            key={`p${i}`}
            fallback={<textarea className="raw-editor" value={seg.text} readOnly />}
          >
            <LazyRichEditor
              value={seg.text}
              onChange={(md) => onChange(reassemble(segments, i, md))}
              autoFocus={(autoFocus ?? false) && i === segments.findIndex((s) => s.kind === 'prose')}
            />
          </Suspense>
        );
      })}
    </div>
  );
}

type Segment =
  | { kind: 'prose'; text: string }
  | { kind: 'canvas'; raw: string; startLine: number; snapshot: unknown | null };

/** Split a body into prose runs and canvas blocks, byte-preserving: joining
 * every segment back with newlines reproduces the body exactly. Canvas
 * segments keep their raw fence text so untouched blocks never churn. */
function segment(body: string): Segment[] {
  const lines = body.split('\n');
  const blocks = listCanvasBlocks(body);
  if (blocks.length === 0) return [{ kind: 'prose', text: body }];
  const segs: Segment[] = [];
  let cursor = 0;
  for (const b of blocks) {
    if (b.startLine > cursor)
      segs.push({ kind: 'prose', text: lines.slice(cursor, b.startLine).join('\n') });
    segs.push({
      kind: 'canvas',
      raw: lines.slice(b.startLine, b.endLine + 1).join('\n'),
      startLine: b.startLine,
      snapshot: b.snapshot,
    });
    cursor = b.endLine + 1;
  }
  if (cursor < lines.length) segs.push({ kind: 'prose', text: lines.slice(cursor).join('\n') });
  return segs;
}

/** The body with prose segment `index` replaced by `text`. */
function reassemble(segments: Segment[], index: number, text: string): string {
  return segments
    .map((s, i) => (i === index ? text : s.kind === 'prose' ? s.text : s.raw))
    .join('\n');
}

function CanvasBlockCard({
  snapshot,
  onOpen,
}: {
  snapshot: unknown | null;
  onOpen?: () => void;
}) {
  const corrupt = snapshot === null;
  const n = snapshotShapeCount(snapshot);
  return (
    <button type="button" className="canvas-block" onClick={onOpen} disabled={corrupt || !onOpen}>
      <span className="canvas-block-art" aria-hidden="true">
        ▨
      </span>
      <span className="canvas-block-foot">
        <span className="canvas-block-label">▨ CANVAS</span>
        <span className="canvas-block-sub">
          {corrupt ? 'UNREADABLE' : n === 0 ? 'EMPTY' : `${n} SHAPE${n === 1 ? '' : 'S'}`}
        </span>
        {!corrupt && <span className="canvas-block-open">OPEN ⤢</span>}
      </span>
    </button>
  );
}
