import {
  CAPTURE_DEFAULTS,
  DURABILITY,
  type Durability,
  FORMALITY,
  type Formality,
  IMPORTANCE,
  type Importance,
  type ServerDoc,
} from '@forge/core';
import { useEffect, useRef, useState } from 'react';
import { captureNote, flashNotice, removeDoc, saveDoc } from './store';

export interface AxisValues {
  durability: Durability;
  formality: Formality;
  importance: Importance;
}

export function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  const s = (Date.now() - t) / 1000;
  if (Number.isNaN(t)) return '';
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function AxisRow<T extends string>({
  name,
  steps,
  active,
  onPick,
}: {
  name: string;
  steps: readonly T[];
  active: T;
  onPick: (v: T) => void;
}) {
  return (
    <div className="axis-row">
      <span className="axis-name">{name}</span>
      <div className="axis-chips">
        {steps.map((step) => (
          <button
            key={step}
            type="button"
            className={`chip${step === active ? ' chip-active' : ''}`}
            onClick={() => onPick(step)}
          >
            {step}
          </button>
        ))}
      </div>
    </div>
  );
}

export function AxisPicker({
  value,
  onChange,
}: {
  value: AxisValues;
  onChange: (v: AxisValues) => void;
}) {
  return (
    <div className="axis-picker">
      <AxisRow
        name="durability"
        steps={DURABILITY}
        active={value.durability}
        onPick={(durability) => onChange({ ...value, durability })}
      />
      <AxisRow
        name="formality"
        steps={FORMALITY}
        active={value.formality}
        onPick={(formality) => onChange({ ...value, formality })}
      />
      <AxisRow
        name="importance"
        steps={IMPORTANCE}
        active={value.importance}
        onPick={(importance) => onChange({ ...value, importance })}
      />
    </div>
  );
}

/** The drop-a-thought box. Drafts persist across reloads so a half-typed
 * thought is never lost to a stray tab close. */
export function Capture() {
  const [text, setText] = useState(() => localStorage.getItem('forge-draft') ?? '');
  const [axes, setAxes] = useState<AxisValues>({ ...CAPTURE_DEFAULTS });
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (text) localStorage.setItem('forge-draft', text);
    else localStorage.removeItem('forge-draft');
  }, [text]);

  const save = async (): Promise<void> => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      await captureNote({ body, ...axes });
      setText('');
      setAxes({ ...CAPTURE_DEFAULTS });
      ref.current?.focus();
    } catch (e) {
      flashNotice(e instanceof Error ? `Save failed: ${e.message}` : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="capture">
      <textarea
        id="capture"
        ref={ref}
        placeholder="Drop a thought… (⌘↵ to save)"
        rows={3}
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void save();
        }}
      />
      <AxisPicker value={axes} onChange={setAxes} />
      <div className="capture-actions">
        <button
          type="button"
          className="primary"
          disabled={!text.trim() || busy}
          onClick={() => void save()}
        >
          Save
        </button>
      </div>
    </section>
  );
}

export function NoteCard({ doc, onOpen }: { doc: ServerDoc; onOpen: () => void }) {
  const tags: string[] = [];
  if (doc.pinned) tags.push('pinned');
  if (doc.source.startsWith('conflict:')) tags.push('conflict');
  if (doc.durability !== CAPTURE_DEFAULTS.durability) tags.push(doc.durability);
  if (doc.formality !== CAPTURE_DEFAULTS.formality) tags.push(doc.formality);
  if (doc.importance !== CAPTURE_DEFAULTS.importance) tags.push(doc.importance);
  return (
    <button type="button" className="card" onClick={onOpen}>
      <div className="card-top">
        <span className="card-title">{doc.title}</span>
        <span className="card-age">{relTime(doc.updated)}</span>
      </div>
      {doc.preview && <div className="card-preview">{doc.preview}</div>}
      {tags.length > 0 && (
        <div className="card-tags">
          {tags.map((t) => (
            <span key={t} className="tag">
              {t}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}

export function EditorPanel({ doc, onClose }: { doc: ServerDoc; onClose: () => void }) {
  const [body, setBody] = useState(doc.body);
  const [axes, setAxes] = useState<AxisValues>({
    durability: doc.durability,
    formality: doc.formality,
    importance: doc.importance,
  });
  const [busy, setBusy] = useState(false);
  const dirty =
    body !== doc.body ||
    axes.durability !== doc.durability ||
    axes.formality !== doc.formality ||
    axes.importance !== doc.importance;

  const save = async (): Promise<void> => {
    if (!dirty || busy) return;
    setBusy(true);
    try {
      await saveDoc(doc.id, { body, ...axes });
    } catch (e) {
      flashNotice(e instanceof Error ? `Save failed: ${e.message}` : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const maybeClose = (): void => {
    if (dirty && !window.confirm('Discard unsaved edits?')) return;
    onClose();
  };

  const del = async (): Promise<void> => {
    if (!window.confirm('Delete this note?')) return;
    await removeDoc(doc.id);
    onClose();
  };

  return (
    <div
      className="editor-backdrop"
      onClick={maybeClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') maybeClose();
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void save();
      }}
      role="presentation"
    >
      <div className="editor" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <textarea autoFocus value={body} onChange={(e) => setBody(e.target.value)} />
        <AxisPicker value={axes} onChange={setAxes} />
        <div className="editor-actions">
          <button type="button" className="ghost danger" onClick={() => void del()}>
            Delete
          </button>
          <span className="spacer" />
          <button type="button" onClick={maybeClose}>
            Close
          </button>
          <button
            type="button"
            className="primary"
            disabled={!dirty || busy}
            onClick={() => void save()}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
