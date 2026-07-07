import {
  type AgendaEntry,
  CAPTURE_DEFAULTS,
  DURABILITY,
  type Durability,
  FORMALITY,
  type Formality,
  IMPORTANCE,
  type Importance,
  RRULE_PRESETS,
  type Reminder,
  type ServerDoc,
  type ViewDef,
  buildAgenda,
  isCanvas,
  nowIso,
} from '@forge/core';
import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import * as api from './api';
import { NoteEditor } from './editor/NoteEditor';
import { actOnReminder, captureNote, flashNotice, removeDoc, saveDoc } from './store';

const LazyCanvasEditor = lazy(() => import('./editor/CanvasEditor'));

/** ISO instant -> value for a <input type=datetime-local> in local time. */
function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Keep the local offset (via nowIso), not toISOString's Z — reminders must
// carry their zone so recurrence expands on local wall-clock (review H4).
const localInputToIso = (local: string): string => nowIso(new Date(local));

export function reminderLabel(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export type MobileScreen = 'notes' | 'agenda' | 'search' | 'capture';

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
    ['agenda', 'Agenda'],
    ['capture', 'New'],
    ['search', 'Search'],
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
  if (isCanvas(doc.body)) tags.push('canvas');
  if (doc.rev === 0) tags.push('unsynced');
  if (doc.pinned) tags.push('pinned');
  if (doc.source.startsWith('conflict:')) tags.push('conflict');
  const activeReminder = doc.reminders.find((r) => r.status !== 'done');
  if (activeReminder) tags.push(`⏰ ${reminderLabel(activeReminder.at)}`);
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

/** The time-sorted list of what needs attention: every active reminder across
 * notes, overdue first, with done and snooze actions. This is the Google
 * Tasks replacement surface. */
export function Agenda({ docs, onOpen }: { docs: ServerDoc[]; onOpen: (id: string) => void }) {
  const [, force] = useState(0);
  const entries = buildAgenda(docs, new Date());
  const groups: Array<[string, AgendaEntry[]]> = [
    ['Overdue', entries.filter((e) => e.overdue)],
    ['Upcoming', entries.filter((e) => !e.overdue)],
  ];

  const act = async (
    e: AgendaEntry,
    action: 'done' | 'snooze',
    snoozeUntil?: Date,
  ): Promise<void> => {
    await actOnReminder(e.docId, e.reminderIndex, action, snoozeUntil);
    force((n) => n + 1);
  };

  if (entries.length === 0) {
    return <p className="empty">Nothing scheduled. Add a reminder from any note.</p>;
  }

  return (
    <div className="agenda">
      {groups.map(([name, list]) =>
        list.length === 0 ? null : (
          <div className="agenda-group" key={name}>
            <h2 className={`agenda-heading${name === 'Overdue' ? ' overdue' : ''}`}>{name}</h2>
            {list.map((e) => (
              <div className="agenda-item" key={`${e.docId}:${e.reminderIndex}`}>
                <button type="button" className="agenda-main" onClick={() => onOpen(e.docId)}>
                  <span className="agenda-title">{e.title}</span>
                  <span className={`agenda-when${e.overdue ? ' overdue' : ''}`}>
                    {reminderLabel(e.at)}
                    {e.recurring ? ' ↻' : ''}
                    {e.snoozed ? ' 💤' : ''}
                  </span>
                </button>
                <div className="agenda-actions">
                  <button type="button" className="ghost" onClick={() => void act(e, 'done')}>
                    done
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => void act(e, 'snooze', new Date(Date.now() + 24 * 3_600_000))}
                  >
                    tomorrow
                  </button>
                </div>
              </div>
            ))}
          </div>
        ),
      )}
    </div>
  );
}

/** Browses a note's git history and drops an older version back into the
 * editor (as an unsaved edit, so restoring is just Save). Read-only until you
 * pick one; the git repo is the source, so nothing here can lose data. */
function HistoryPanel({
  docId,
  onPick,
  onClose,
}: {
  docId: string;
  onPick: (body: string) => void;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<api.HistoryEntry[] | null>(null);

  useEffect(() => {
    api
      .history(docId)
      .then((r) => setEntries(r.history))
      .catch(() => setEntries([]));
  }, [docId]);

  const restore = async (commit: string): Promise<void> => {
    try {
      const { body } = await api.revisionAt(docId, commit);
      onPick(body);
      flashNotice('Old version loaded — Save to keep it');
      onClose();
    } catch {
      flashNotice('Could not load that version');
    }
  };

  return (
    <div className="history-panel">
      <div className="history-head">
        <span>History</span>
        <button type="button" className="ghost" onClick={onClose}>
          close
        </button>
      </div>
      {entries === null ? (
        <p className="empty">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="empty">No history yet.</p>
      ) : (
        entries.map((e) => (
          <button
            key={e.commit}
            type="button"
            className="history-row"
            onClick={() => void restore(e.commit)}
          >
            <span className="history-when">
              {new Date(e.date).toLocaleString(undefined, {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })}
            </span>
            <span className="history-msg">{e.message}</span>
          </button>
        ))
      )}
    </div>
  );
}

/** Add, retime, or remove reminders on the note being edited. Recurrence is a
 * small set of presets; a bare datetime covers the one-shot case. */
function ReminderEditor({
  reminders,
  onChange,
}: {
  reminders: Reminder[];
  onChange: (r: Reminder[]) => void;
}) {
  const add = (): void => {
    const at = new Date(Date.now() + 3_600_000);
    at.setMinutes(0, 0, 0);
    onChange([...reminders, { at: at.toISOString(), status: 'active' }]);
  };
  const patch = (i: number, next: Partial<Reminder>): void =>
    onChange(reminders.map((r, j) => (j === i ? { ...r, ...next } : r)));
  const remove = (i: number): void => onChange(reminders.filter((_, j) => j !== i));

  return (
    <div className="reminder-editor">
      {reminders.map((r, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: reminders have no id; index is stable within an edit session
        <div className="reminder-row" key={i}>
          <input
            type="datetime-local"
            value={isoToLocalInput(r.at)}
            onChange={(e) => e.target.value && patch(i, { at: localInputToIso(e.target.value) })}
          />
          <select
            value={r.rrule ?? ''}
            onChange={(e) => {
              const rrule = e.target.value || undefined;
              patch(i, rrule ? { rrule } : { rrule: undefined });
            }}
          >
            {RRULE_PRESETS.map((p) => (
              <option key={p.label} value={p.rrule ?? ''}>
                {p.label}
              </option>
            ))}
          </select>
          <button type="button" className="ghost danger" onClick={() => remove(i)}>
            ✕
          </button>
        </div>
      ))}
      <button type="button" className="ghost add-reminder" onClick={add}>
        + reminder
      </button>
    </div>
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
  const [baseRev, setBaseRev] = useState(doc.rev);
  const [reminders, setReminders] = useState<Reminder[]>(doc.reminders);
  const [saved, setSaved] = useState({
    body: doc.body,
    durability: doc.durability,
    formality: doc.formality,
    importance: doc.importance,
    reminders: JSON.stringify(doc.reminders),
  });
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const canvas = isCanvas(doc.body);
  const [editorMode, setEditorMode] = useState<'rich' | 'raw'>(() =>
    localStorage.getItem('forge-editor-mode') === 'raw' ? 'raw' : 'rich',
  );
  const dirty =
    body !== saved.body ||
    axes.durability !== saved.durability ||
    axes.formality !== saved.formality ||
    axes.importance !== saved.importance ||
    JSON.stringify(reminders) !== saved.reminders;

  const toggleMode = (): void => {
    const next = editorMode === 'rich' ? 'raw' : 'rich';
    setEditorMode(next);
    localStorage.setItem('forge-editor-mode', next);
  };

  const save = async (): Promise<void> => {
    if (!dirty || busy) return;
    setBusy(true);
    try {
      const newRev = await saveDoc(doc.id, baseRev, { body, ...axes, reminders });
      setBaseRev(newRev);
      setSaved({ body, ...axes, reminders: JSON.stringify(reminders) });
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
      <div
        className={`editor${canvas ? ' editor-canvas' : ''}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {showHistory ? (
          <HistoryPanel docId={doc.id} onPick={setBody} onClose={() => setShowHistory(false)} />
        ) : canvas ? (
          <Suspense fallback={<div className="canvas-surface" />}>
            <LazyCanvasEditor value={body} onChange={setBody} />
          </Suspense>
        ) : (
          <NoteEditor
            key={editorMode}
            value={body}
            onChange={setBody}
            mode={editorMode}
            autoFocus
          />
        )}
        {!canvas && <AxisPicker value={axes} onChange={setAxes} />}
        {!canvas && <ReminderEditor reminders={reminders} onChange={setReminders} />}
        <div className="editor-actions">
          <button type="button" className="ghost danger" onClick={() => void del()}>
            Delete
          </button>
          {!canvas && (
            <button type="button" className="ghost" onClick={toggleMode}>
              {editorMode === 'rich' ? 'raw' : 'rich'}
            </button>
          )}
          <button type="button" className="ghost" onClick={() => void toggleArchive()}>
            {doc.archived ? 'unarchive' : 'archive'}
          </button>
          <button
            type="button"
            className={`ghost${showHistory ? ' active' : ''}`}
            onClick={() => setShowHistory((h) => !h)}
          >
            history
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
