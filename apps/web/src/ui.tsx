import {
  CAPTURE_DEFAULTS,
  DURABILITY,
  type Durability,
  FORMALITY,
  type Formality,
  IMPORTANCE,
  type Importance,
  type ServerDoc,
  type ViewDef,
} from '@forge/core';
import { useEffect, useRef, useState } from 'react';
import { NoteEditor } from './editor/NoteEditor';
import { captureNote, flashNotice, removeDoc, saveDoc } from './store';

export type MobileScreen = 'notes' | 'search' | 'capture';

export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 639px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    const onChange = (): void => setMobile(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return mobile;
}

/** Views that clutter the chip row until they hold something. */
const EMPTY_HIDDEN = new Set(['conflicts', 'archive']);

export function ViewChips({
  views,
  active,
  counts,
  onPick,
}: {
  views: readonly ViewDef[];
  active: string;
  counts: Record<string, number>;
  onPick: (id: string) => void;
}) {
  return (
    <div className="view-chips">
      {views
        .filter((v) => !EMPTY_HIDDEN.has(v.id) || (counts[v.id] ?? 0) > 0)
        .map((v) => (
          <button
            key={v.id}
            type="button"
            className={`chip view-chip${v.id === active ? ' chip-active' : ''}`}
            onClick={() => onPick(v.id)}
          >
            {v.name}
            {counts[v.id] ? ` · ${counts[v.id]}` : ''}
          </button>
        ))}
    </div>
  );
}

/** Thumb-zone navigation for phones; hidden on desktop where the whole app
 * fits one column and the keyboard does the traveling. */
export function BottomBar({
  screen,
  onPick,
}: {
  screen: MobileScreen;
  onPick: (s: MobileScreen) => void;
}) {
  const tabs: Array<[MobileScreen, string]> = [
    ['notes', 'Notes'],
    ['search', 'Search'],
    ['capture', 'New'],
  ];
  return (
    <nav className="bottom-bar">
      {tabs.map(([s, label]) => (
        <button
          key={s}
          type="button"
          className={`tab${s === screen ? ' tab-active' : ''}`}
          onClick={() => onPick(s)}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}

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
export function Capture({ onSaved }: { onSaved?: () => void }) {
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
      // Cleared directly, not via the persistence effect: a save that
      // unmounts this component (mobile screen switch) would otherwise leave
      // the stale draft behind to resurface on the next mount.
      localStorage.removeItem('forge-draft');
      setAxes({ ...CAPTURE_DEFAULTS });
      if (onSaved) onSaved();
      else ref.current?.focus();
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
  if (doc.rev === 0) tags.push('unsynced');
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
  // The revision these edits are based on — captured at open, so a concurrent
  // change elsewhere merge-forks instead of being overwritten. Kept for the
  // whole editing session: the outbox coalesces repeat saves, and a re-save
  // on top of our own acked edit merges cleanly (ours is a subset of theirs).
  const [baseRev] = useState(doc.rev);
  const [saved, setSaved] = useState<{ body: string } & AxisValues>({
    body: doc.body,
    durability: doc.durability,
    formality: doc.formality,
    importance: doc.importance,
  });
  const [busy, setBusy] = useState(false);
  const [editorMode, setEditorMode] = useState<'rich' | 'raw'>(() =>
    localStorage.getItem('forge-editor-mode') === 'raw' ? 'raw' : 'rich',
  );
  const dirty =
    body !== saved.body ||
    axes.durability !== saved.durability ||
    axes.formality !== saved.formality ||
    axes.importance !== saved.importance;

  const toggleMode = (): void => {
    const next = editorMode === 'rich' ? 'raw' : 'rich';
    setEditorMode(next);
    localStorage.setItem('forge-editor-mode', next);
  };

  const save = async (): Promise<void> => {
    if (!dirty || busy) return;
    setBusy(true);
    try {
      await saveDoc(doc.id, baseRev, { body, ...axes });
      setSaved({ body, ...axes });
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

  // Archive is a discrete state change, not a tracked edit: it applies and
  // closes rather than waiting for Save.
  const toggleArchive = async (): Promise<void> => {
    await saveDoc(doc.id, baseRev, { archived: !doc.archived });
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
        <NoteEditor key={editorMode} value={body} onChange={setBody} mode={editorMode} autoFocus />
        <AxisPicker value={axes} onChange={setAxes} />
        <div className="editor-actions">
          <button type="button" className="ghost danger" onClick={() => void del()}>
            Delete
          </button>
          <button type="button" className="ghost" onClick={toggleMode}>
            {editorMode === 'rich' ? 'raw' : 'rich'}
          </button>
          <button type="button" className="ghost" onClick={() => void toggleArchive()}>
            {doc.archived ? 'unarchive' : 'archive'}
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
