import { listCanvasBlocks, migrateLegacyCanvas, replaceCanvasBlock } from '@forge/core';
import { Tldraw, getSnapshot, loadSnapshot } from 'tldraw';
import 'tldraw/tldraw.css';

/** A tldraw canvas over one canvas block of a note's body. The whole body
 * flows through (prose and sibling blocks untouched); only the addressed
 * block's JSON is rewritten. Changes are debounced before serializing back so
 * a burst of drawing doesn't thrash the body; the surrounding editor's Save
 * then persists it like any edit. Lazy-loaded (tldraw is large) so text notes
 * never pay for it. */
export default function CanvasEditor({
  value,
  onChange,
  onTouch,
  blockStart,
}: {
  value: string;
  onChange: (body: string) => void;
  /** Fires synchronously on the FIRST user change, before the debounce —
   * close-time decisions (e.g. empty-canvas discard) must not race the
   * 500ms serialization window. */
  onTouch?: () => void;
  /** startLine of the canvas block to edit; defaults to the first block. */
  blockStart?: number;
}) {
  const dark = document.documentElement.dataset.theme !== 'light';
  // Legacy whole-note canvases may still arrive over sync from a
  // not-yet-migrated server; edit them in block form from the first stroke.
  const body = migrateLegacyCanvas(value);
  const blocks = listCanvasBlocks(body);
  const block = blocks.find((b) => b.startLine === blockStart) ?? blocks[0];
  return (
    <div className="canvas-surface">
      <Tldraw
        onMount={(editor) => {
          // Follow the app's theme toggle, not the OS: the rest of the editor
          // chrome already does.
          editor.user.updateUserPreferences({ colorScheme: dark ? 'dark' : 'light' });
          const snapshot = block?.snapshot;
          if (snapshot && Object.keys(snapshot as object).length > 0) {
            try {
              loadSnapshot(editor.store, snapshot as Parameters<typeof loadSnapshot>[1]);
            } catch {
              // corrupt/older snapshot — start from a blank canvas rather than crash
            }
          }
          let timer: ReturnType<typeof setTimeout> | undefined;
          editor.store.listen(
            () => {
              onTouch?.();
              if (timer) clearTimeout(timer);
              timer = setTimeout(() => {
                onChange(replaceCanvasBlock(body, block?.startLine ?? 0, getSnapshot(editor.store)));
              }, 500);
            },
            { source: 'user', scope: 'document' },
          );
        }}
      />
    </div>
  );
}
