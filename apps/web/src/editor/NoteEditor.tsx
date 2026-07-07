import { Suspense, lazy } from 'react';

export interface NoteEditorProps {
  value: string;
  onChange: (markdown: string) => void;
  mode: 'rich' | 'raw';
  autoFocus?: boolean;
}

const LazyRichEditor = lazy(() => import('./RichEditor'));

/**
 * The single editing surface the app is allowed to use (ADR-0003): markdown
 * in, markdown out, implementations swappable behind this contract. Nothing
 * outside this directory may import a specific editor library. The rich
 * implementation is lazy-loaded so the capture path never pays for it.
 */
export function NoteEditor({ value, onChange, mode, autoFocus }: NoteEditorProps) {
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
  return (
    <Suspense fallback={<textarea className="raw-editor" value={value} readOnly />}>
      <LazyRichEditor value={value} onChange={onChange} autoFocus={autoFocus ?? false} />
    </Suspense>
  );
}
