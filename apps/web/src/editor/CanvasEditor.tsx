import { canvasToBody, parseCanvas } from '@forge/core';
import { Tldraw, getSnapshot, loadSnapshot } from 'tldraw';
import 'tldraw/tldraw.css';

/** A tldraw canvas that reads and writes a canvas note's body. Changes are
 * debounced before being serialized back so a burst of drawing doesn't thrash
 * the note's body; the surrounding editor's Save then persists it like any
 * edit. Lazy-loaded (tldraw is large) so text notes never pay for it. */
export default function CanvasEditor({
  value,
  onChange,
  onTouch,
}: {
  value: string;
  onChange: (body: string) => void;
  /** Fires synchronously on the FIRST user change, before the debounce —
   * close-time decisions (e.g. empty-canvas discard) must not race the
   * 500ms serialization window. */
  onTouch?: () => void;
}) {
  const dark = document.documentElement.dataset.theme !== 'light';
  return (
    <div className="canvas-surface">
      <Tldraw
        onMount={(editor) => {
          // Follow the app's theme toggle, not the OS: the rest of the editor
          // chrome already does.
          editor.user.updateUserPreferences({ colorScheme: dark ? 'dark' : 'light' });
          const snapshot = parseCanvas(value);
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
              timer = setTimeout(() => onChange(canvasToBody(getSnapshot(editor.store))), 500);
            },
            { source: 'user', scope: 'document' },
          );
        }}
      />
    </div>
  );
}
