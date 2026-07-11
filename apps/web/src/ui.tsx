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
  effectiveFireAt,
  docTags,
  emptyCanvasBody,
  hasCanvasBlock,
  isLegacyCanvas,
  listCanvasBlocks,
  migrateLegacyCanvas,
  normalizeTags,
  nowIso,
  stripCanvasBlocks,
} from '@forge/core';
import { Component, type JSX, type ReactNode, Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import * as api from './api';
import { MOBILE_MEDIA_QUERY } from './breakpoint';
import { NoteEditor } from './editor/NoteEditor';
import { Icon, type IconName } from './icons';
import {
  actOnReminder,
  allTags,
  captureNote,
  flashNotice,
  removeDoc,
  removeDocUndoable,
  saveDoc,
} from './store';

const LazyCanvasEditor = lazy(() => import('./editor/CanvasEditor'));

/** True when a note carries a drawing — a canvas block, or a legacy
 * whole-note canvas that a not-yet-migrated server may still sync down. */
const noteHasCanvas = (body: string): boolean => hasCanvasBlock(body) || isLegacyCanvas(body);

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

/** THE reminder time formatter — list chips, agenda rows, and the editor all
 * speak through here so a date never renders two ways (or as ambiguous
 * DD/MM). Weekday always, year only when it isn't this year. */
export function reminderLabel(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at;
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}),
    hour: 'numeric',
    minute: '2-digit',
  });
}

export type MobileScreen = 'notes' | 'agenda' | 'search' | 'capture' | 'actions';

export type ListDensity = 'skim' | 'list' | 'cards';

/** The 44px mono statusline that replaces any app header — brand left, sync
 * truth + clock right. It is the only place sync state lives, and tapping it
 * opens Settings: the statusline is the door to the machine room. */
export function Readout({
  syncState,
  pending,
  onOpenSettings,
}: {
  syncState: 'synced' | 'pending' | 'offline';
  pending: number;
  onOpenSettings: () => void;
}) {
  const fmt = (): string =>
    new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  const [clock, setClock] = useState(fmt);
  useEffect(() => {
    const t = setInterval(() => setClock(fmt()), 30_000);
    return () => clearInterval(t);
  }, []);
  return (
    // The whole strip still opens Settings, but a visible sliders control
    // anchors it — a hidden door is clever exactly once, then it's a wall.
    <div className="readout" onClick={onOpenSettings} role="presentation">
      <span className="readout-brand">
        <span className="cursor-mark">▮</span> DATA FORGE
      </span>
      <span className="spacer" />
      <span className="readout-sync" data-state={syncState}>
        {syncState === 'synced'
          ? '● SYNCED'
          : syncState === 'pending'
            ? `◐ ${pending} PENDING`
            : '○ OFFLINE'}
      </span>
      <span className="readout-clock">{clock}</span>
      <button
        type="button"
        className="icon-btn readout-settings"
        title="Settings"
        onClick={(e) => {
          e.stopPropagation();
          onOpenSettings();
        }}
      >
        <Icon name="sliders" />
      </button>
    </div>
  );
}

/** Swatch metadata for the palette pickers (display only — the real values
 * live in tokens.json and apply via [data-palette]). PROVISIONAL hexes until
 * the Theme Lab verbatim sync replaces them. */
const DARK_PALETTES = [
  { id: 'deep-ocean', name: 'Deep Ocean', bg: '#0D1520', accent: '#4FB4FF' },
  { id: 'slate-teal', name: 'Slate Teal', bg: '#0F1917', accent: '#45C4B0' },
  { id: 'void', name: 'Void', bg: '#000000', accent: '#5EA8FF' },
  { id: 'moss', name: 'Moss', bg: '#101510', accent: '#A8C36B' },
  { id: 'nightshade', name: 'Nightshade', bg: '#120E1C', accent: '#B99CFF' },
  { id: 'carbon', name: 'Carbon', bg: '#101113', accent: '#D9DCE1' },
] as const;

const LIGHT_PALETTES = [
  { id: 'mist', name: 'Mist', bg: '#EFF3F7', accent: '#1D66C4' },
  { id: 'sage', name: 'Sage', bg: '#EEF2EC', accent: '#2B7A6F' },
  { id: 'pure', name: 'Pure', bg: '#FFFFFF', accent: '#1D66C4' },
  { id: 'parchment', name: 'Parchment', bg: '#F6F0E3', accent: '#8A5A2B' },
  { id: 'rose-ash', name: 'Rose Ash', bg: '#F3EDEF', accent: '#A64D69' },
  { id: 'solar', name: 'Solar', bg: '#FBF3DF', accent: '#C05B21' },
] as const;

function SwatchRow({
  label,
  palettes,
  active,
  onPick,
}: {
  label: string;
  palettes: readonly { id: string; name: string; bg: string; accent: string }[];
  active: string;
  onPick: (id: string) => void;
}) {
  return (
    <div className="swatch-group">
      <span className="axis-name">{label}</span>
      <div className="swatch-row">
        {palettes.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`swatch${p.id === active ? ' swatch-active' : ''}`}
            title={p.name}
            onClick={() => onPick(p.id)}
          >
            <span className="swatch-chip" style={{ background: p.bg }}>
              <span className="swatch-accent" style={{ background: p.accent }} />
            </span>
            <span className="swatch-name">{p.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Settings sheet — reached through the readout (and its sliders control).
 * Square controls, mono group rules, the same segmented language as axes. */
export function SettingsSheet({
  themeMode,
  onThemeMode,
  paletteDark,
  onPaletteDark,
  paletteLight,
  onPaletteLight,
  typeSize,
  onTypeSize,
  density,
  onDensity,
  pending,
  connected,
  onClose,
}: {
  themeMode: 'dark' | 'light' | 'system';
  onThemeMode: (m: 'dark' | 'light' | 'system') => void;
  paletteDark: string;
  onPaletteDark: (id: string) => void;
  paletteLight: string;
  onPaletteLight: (id: string) => void;
  typeSize: 'S' | 'M' | 'L';
  onTypeSize: (s: 'S' | 'M' | 'L') => void;
  density: 'compact' | 'relaxed';
  onDensity: (d: 'compact' | 'relaxed') => void;
  pending: number;
  connected: boolean;
  onClose: () => void;
}) {
  return (
    <div className="editor-backdrop" onClick={onClose} role="presentation">
      <div
        className="editor settings-sheet"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <h2 className="section-rule">
          <span>APPEARANCE</span>
          <span className="rule-line" />
        </h2>
        <AxisRow
          name="theme"
          steps={['Dark', 'Light', 'System'] as const}
          active={themeMode === 'dark' ? 'Dark' : themeMode === 'light' ? 'Light' : 'System'}
          onPick={(v) => onThemeMode(v.toLowerCase() as 'dark' | 'light' | 'system')}
        />
        <SwatchRow
          label="dark"
          palettes={DARK_PALETTES}
          active={paletteDark}
          onPick={onPaletteDark}
        />
        <SwatchRow
          label="light"
          palettes={LIGHT_PALETTES}
          active={paletteLight}
          onPick={onPaletteLight}
        />
        <h2 className="section-rule">
          <span>LIST</span>
          <span className="rule-line" />
        </h2>
        <AxisRow
          name="density"
          steps={['Compact', 'Relaxed'] as const}
          active={density === 'compact' ? 'Compact' : 'Relaxed'}
          onPick={(v) => onDensity(v.toLowerCase() as 'compact' | 'relaxed')}
        />
        <AxisRow name="type size" steps={['S', 'M', 'L'] as const} active={typeSize} onPick={onTypeSize} />
        <h2 className="section-rule">
          <span>SYSTEM</span>
          <span className="rule-line" />
        </h2>
        <div className="settings-readline">
          <span>{connected ? '● SYNC LIVE' : '○ OFFLINE'}</span>
          <span>{pending > 0 ? `◐ ${pending} QUEUED` : 'QUEUE EMPTY'}</span>
        </div>
        <div className="settings-readline">
          <span>~/DataForge · markdown + git</span>
        </div>
        <div className="editor-actions">
          <span className="spacer" />
          <button type="button" className="ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

interface ActionSlot {
  title: string;
  sub?: string;
  href?: string;
}

/** The Actions page is a socket panel: slots read from actions.json; empty
 * slots stay visible as dashed invitations rather than hidden features. */
export function ActionsPage() {
  const [slots, setSlots] = useState<ActionSlot[] | null>(null);
  useEffect(() => {
    fetch('/actions.json')
      .then((r) => (r.ok ? r.json() : []))
      .then((j) => setSlots(Array.isArray(j) ? j.slice(0, 4) : []))
      .catch(() => setSlots([]));
  }, []);
  const filled = slots ?? [];
  const empties = Math.max(0, 4 - filled.length);
  return (
    <section className="actions-page">
      {filled.map((s) => (
        <a key={s.title} className="action-slot" href={s.href ?? '#'}>
          <span className="action-title">{s.title}</span>
          {s.sub && <span className="action-sub">{s.sub}</span>}
          <span className="action-chevron">›</span>
        </a>
      ))}
      {Array.from({ length: empties }, (_, i) => (
        <button
          key={`empty-${i}`}
          type="button"
          className="action-slot action-slot-empty"
          onClick={() =>
            flashNotice('Drop an actions.json in the web root to plug actions in')
          }
        >
          [ + PLUG IN AN ACTION ]
        </button>
      ))}
    </section>
  );
}

export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(() => window.matchMedia(MOBILE_MEDIA_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MEDIA_QUERY);
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
            className={`view-chip${v.id === active ? ' chip-active' : ''}`}
            onClick={() => onPick(v.id)}
          >
            {v.name}
            {counts[v.id] ? <span className="count"> {counts[v.id]}</span> : null}
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
  const tabs: Array<[MobileScreen, string, IconName]> = [
    ['notes', 'Notes', 'note'],
    ['agenda', 'Agenda', 'calendar'],
    ['capture', 'New', 'plus'],
    ['actions', 'Actions', 'zap'],
    ['search', 'Search', 'search'],
  ];
  return (
    <nav className="bottom-bar">
      {tabs.map(([s, label, icon]) => (
        <button
          key={s}
          type="button"
          className={`tab${s === screen ? ' tab-active' : ''}${s === 'capture' ? ' tab-new' : ''}`}
          onClick={() => onPick(s)}
        >
          <Icon name={icon} />
          <span>{label}</span>
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

interface MenuItem {
  icon: IconName;
  label: string;
  danger?: boolean;
  onPick: () => void;
}

/** A small anchored menu behind one trigger. Rare and destructive actions
 * live here: one deliberate tap to open, labeled full-word items to pick, so
 * surfaces stay uncluttered without hiding what's possible. */
function ActionMenu({
  title,
  items,
  up = false,
}: {
  title: string;
  items: MenuItem[];
  up?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  return (
    <div className="menu-wrap" ref={ref}>
      <button
        type="button"
        className={`icon-btn${open ? ' active' : ''}`}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <Icon name="more" />
      </button>
      {open && (
        <div className={`menu${up ? ' menu-up' : ''}`} role="menu">
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              className={`menu-item${it.danger ? ' danger' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                it.onPick();
              }}
              onKeyDown={(e) => e.stopPropagation()}
            >
              <Icon name={it.icon} />
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
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
    <div className="axis-row" data-axis={name}>
      <span className="axis-name">{name}</span>
      <div className="axis-chips">
        {steps.map((step) => (
          <button
            key={step}
            type="button"
            data-value={step}
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

/** The axes folded down to their current values. Capture and editing stay
 * zero-decision (CAPTURE_DEFAULTS do the right thing); the full segmented
 * picker appears only when the user deliberately reaches for it. */
export function AxisDisclosure({
  value,
  onChange,
}: {
  value: AxisValues;
  onChange: (v: AxisValues) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="axis-disclosure">
      <button
        type="button"
        className="axis-summary"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="section-label">Axes</span>
        <span className="axis-current">
          {value.durability} · {value.formality} ·{' '}
          <span data-kind="importance" data-value={value.importance}>
            {value.importance}
          </span>
        </span>
        <Icon name="chevron" className={open ? 'flip' : undefined} />
      </button>
      {open && <AxisPicker value={value} onChange={onChange} />}
    </div>
  );
}

/** The drop-a-thought box. Drafts persist across reloads so a half-typed
 * thought is never lost to a stray tab close. */
export function Capture({ onSaved, onCanvas }: { onSaved?: () => void; onCanvas?: () => void }) {
  const [text, setText] = useState(() => localStorage.getItem('forge-draft') ?? '');
  const [axes, setAxes] = useState<AxisValues>({ ...CAPTURE_DEFAULTS });
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const mobile = useIsMobile();

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
      <div className="capture-line" data-empty={!text}>
        <span className="capture-prompt">&gt;</span>
        <textarea
          id="capture"
          ref={ref}
          placeholder={mobile ? 'Drop a thought…' : 'Drop a thought… (⌘↵ to save)'}
          rows={3}
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void save();
          }}
        />
      </div>
      {/* Axes and Save share one row: no dead band between the last control
          and the action, and the eye travels summary → Save in a line. */}
      <div className="capture-foot">
        <AxisDisclosure value={axes} onChange={setAxes} />
        <button
          type="button"
          className="primary"
          disabled={!text.trim() || busy}
          onClick={() => void save()}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
      {onCanvas && (
        <button type="button" className="ghost start-canvas" onClick={onCanvas}>
          <Icon name="pencil" />
          or start a canvas
        </button>
      )}
    </section>
  );
}

/** The card's leading type glyph: what KIND of note is this, at a glance.
 * One deterministic pick — canvas beats reminder beats reference — and plain
 * notes get none, so the gutter stays signal, not wallpaper. */
function cardKind(doc: ServerDoc, canvas: boolean, hasReminder: boolean): IconName | null {
  if (canvas) return 'pencil';
  if (hasReminder) return 'bell';
  if (doc.durability === 'durable' || doc.durability === 'permanent') return 'pin';
  return null;
}

export function NoteCard({
  doc,
  onOpen,
  onTag,
}: {
  doc: ServerDoc;
  onOpen: () => void;
  /** Tapping a #tag chip filters by that tag (spec §5); chips render inert
   * when the surface has nowhere to send the filter. */
  onTag?: (tag: string) => void;
}) {
  const canvas = noteHasCanvas(doc.body);
  const reminder = doc.reminders.find((r) => r.status !== 'done');
  const overdue = reminder ? new Date(effectiveFireAt(reminder)).getTime() < Date.now() : false;
  const kind = cardKind(doc, canvas, !!reminder);
  const durDev = !canvas && doc.durability !== CAPTURE_DEFAULTS.durability;
  const formDev = !canvas && doc.formality !== CAPTURE_DEFAULTS.formality;
  const impMark = doc.importance === 'high' || doc.importance === 'critical';
  const tags = docTags(doc.tags ?? [], doc.body);
  const hasMeta =
    !!reminder ||
    impMark ||
    durDev ||
    formDev ||
    doc.pinned ||
    canvas ||
    tags.length > 0 ||
    doc.source.startsWith('conflict:') ||
    doc.rev === 0;
  // A div with button semantics, not a <button>: the quick-action menu nests
  // its own buttons inside, which HTML forbids inside a real button element.
  return (
    <div
      className="card"
      data-importance={doc.importance}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="card-top">
        <span className="card-kind">{kind && <Icon name={kind} />}</span>
        <span className="card-title">{doc.title}</span>
        {/* A reminder chip below already carries the time that matters; the
            edit-recency label would just repeat gray noise beside it. */}
        {!reminder && <span className="card-age">{relTime(doc.updated)}</span>}
        <ActionMenu
          title="Note actions"
          items={[
            {
              icon: 'pin',
              label: doc.pinned ? 'Unpin' : 'Pin to top',
              onPick: () => void saveDoc(doc.id, doc.rev, { pinned: !doc.pinned }),
            },
            {
              icon: 'archive',
              label: doc.archived ? 'Unarchive' : 'Archive',
              onPick: () => {
                void saveDoc(doc.id, doc.rev, { archived: !doc.archived });
                flashNotice(
                  doc.archived ? 'Note restored' : 'Archived — it lives on in the Archive view',
                );
              },
            },
            {
              icon: 'trash',
              label: 'Delete',
              danger: true,
              onPick: () => void removeDocUndoable(doc.id),
            },
          ]}
        />
      </div>
      {doc.preview && <div className="card-preview">{doc.preview}</div>}
      {hasMeta && (
        <div className="card-meta">
          {reminder && <ReminderChip doc={doc} reminder={reminder} overdue={overdue} />}
          {impMark && (
            <span className="mark mark-imp" data-value={doc.importance}>
              {doc.importance === 'high' ? '◇ HIGH' : '◆ CRITICAL'}
            </span>
          )}
          {(durDev || formDev) && (
            <button
              type="button"
              className="axes-inline"
              onClick={(e) => {
                e.stopPropagation();
                onOpen();
              }}
              onKeyDown={(e) => e.stopPropagation()}
            >
              {[durDev ? doc.durability : null, formDev ? doc.formality : null]
                .filter(Boolean)
                .join(' · ')}
            </button>
          )}
          {doc.pinned && <span className="mark">▲ PINNED</span>}
          {canvas && <span className="mark">▨ CANVAS</span>}
          {tags.slice(0, 3).map((t) => (
            <button
              key={t}
              type="button"
              className="tag-chip"
              disabled={!onTag}
              onClick={(e) => {
                e.stopPropagation();
                onTag?.(t);
              }}
              onKeyDown={(e) => e.stopPropagation()}
            >
              #{t}
            </button>
          ))}
          {tags.length > 3 && <span className="mark">+{tags.length - 3}</span>}
          {doc.source.startsWith('conflict:') && (
            <span className="mark mark-imp" data-value="critical">
              ◆ CONFLICT
            </span>
          )}
          {doc.rev === 0 && <span className="mark">○ LOCAL</span>}
        </div>
      )}
      {/* Trailing 44px complete box: the reminder finishes from the list,
          no tab switch, no note opening. */}
      {reminder && (
        <button
          type="button"
          className="card-complete"
          title="Mark done"
          onClick={(e) => {
            e.stopPropagation();
            const idx = doc.reminders.findIndex((r) => r.status !== 'done');
            void actOnReminder(doc.id, idx, 'done');
          }}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <Icon name="check" />
        </button>
      )}
    </div>
  );
}

/** The reminder chip is editable-here (dashed + bell): tapping opens the same
 * preset menu used everywhere — reschedule or complete without opening the
 * note. */
function ReminderChip({
  doc,
  reminder,
  overdue,
}: {
  doc: ServerDoc;
  reminder: Reminder;
  overdue: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  const idx = doc.reminders.findIndex((r) => r.status !== 'done');
  const reschedule = (at: Date): void => {
    const reminders = doc.reminders.map((r, i) => (i === idx ? { ...r, at: nowIso(at) } : r));
    void saveDoc(doc.id, doc.rev, { reminders });
  };
  return (
    <span className="menu-wrap" ref={ref}>
      <button
        type="button"
        className="chip-reminder"
        data-overdue={overdue}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <Icon name="bell" />
        {reminderLabel(effectiveFireAt(reminder))}
        {reminder.rrule && <span className="mark-recur"> ↻</span>}
      </button>
      {open && (
        <div className="menu" role="menu">
          {reminderPresets(new Date()).map((p) => (
            <button
              key={p.label}
              type="button"
              role="menuitem"
              className="menu-item"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                reschedule(p.at);
              }}
            >
              <Icon name="snooze" />
              {p.label}
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              void actOnReminder(doc.id, idx, 'done');
            }}
          >
            <Icon name="check" />
            Mark done
          </button>
        </div>
      )}
    </span>
  );
}

/** The time-sorted list of what needs attention: every active reminder across
 * notes, overdue first, with done and snooze actions. This is the Google
 * Tasks replacement surface. */
export function Agenda({ docs, onOpen }: { docs: ServerDoc[]; onOpen: (id: string) => void }) {
  const [, force] = useState(0);
  const now = new Date();
  const entries = buildAgenda(docs, now);

  // Day scaffolding: the agenda reads as a schedule (today, tomorrow, later),
  // not one undifferentiated queue. Today renders even when empty so the day
  // always has a visible shape.
  const dayStart = (d: Date): number => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x.getTime();
  };
  const today = dayStart(now);
  const dayOf = (iso: string): number => dayStart(new Date(iso));
  const dateLabel = (offsetDays: number): string =>
    new Date(today + offsetDays * 86_400_000).toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  const upcoming = entries.filter((e) => !e.overdue);
  const groups: Array<{ name: string; detail?: string; list: AgendaEntry[]; hint?: string }> = [
    { name: 'Overdue', list: entries.filter((e) => e.overdue) },
    {
      name: 'Today',
      detail: dateLabel(0),
      list: upcoming.filter((e) => dayOf(e.at) === today),
      hint: 'Nothing more today',
    },
    {
      name: 'Tomorrow',
      detail: dateLabel(1),
      list: upcoming.filter((e) => dayOf(e.at) === today + 86_400_000),
    },
    { name: 'Later', list: upcoming.filter((e) => dayOf(e.at) > today + 86_400_000) },
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
    return (
      <div className="empty">
        <Icon name="calendar" />
        <p>Nothing scheduled</p>
        <span className="empty-hint">Add a reminder from any note.</span>
      </div>
    );
  }

  return (
    <div className="agenda">
      {groups.map(({ name, detail, list, hint }) =>
        list.length === 0 && !hint ? null : (
          <div className="agenda-group" key={name}>
            <h2 className={`section-rule${name === 'Overdue' ? ' overdue' : ''}`}>
              <span>
                {name.toUpperCase()}
                {detail && <span className="rule-detail"> · {detail}</span>}
              </span>
              <span className="rule-line" />
              <span className="rule-count">{list.length}</span>
            </h2>
            {list.length === 0 && hint && <p className="agenda-hint">{hint}</p>}
            {list.map((e) => (
              <div
                className={`agenda-item${e.overdue ? ' is-overdue' : ''}`}
                key={`${e.docId}:${e.reminderIndex}`}
              >
                {/* Completing is the row's most frequent action, so it leads
                    the row as a real 44px target instead of hiding as a dim
                    glyph in the far corner. */}
                <button
                  type="button"
                  className="agenda-complete"
                  title="Mark done"
                  onClick={() => void act(e, 'done')}
                >
                  <Icon name="check" />
                </button>
                <button type="button" className="agenda-main" onClick={() => onOpen(e.docId)}>
                  <span className="agenda-title">{e.title}</span>
                  <span className={`agenda-when${e.overdue ? ' overdue' : ''}`}>
                    {reminderLabel(e.at)}
                    {e.recurring && <Icon name="history" />}
                    {e.snoozed && <Icon name="snooze" />}
                  </span>
                </button>
                <div className="agenda-actions">
                  <button
                    type="button"
                    className="icon-btn"
                    title="Snooze to tomorrow"
                    onClick={() => void act(e, 'snooze', new Date(Date.now() + 24 * 3_600_000))}
                  >
                    <Icon name="snooze" />
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

/** Natural starting points for a new reminder, so the common cases are one
 * tap instead of a date-picker session. Times are relative to `now`. */
function reminderPresets(now: Date): Array<{ label: string; at: Date }> {
  const at = (base: Date, h: number): Date => {
    const x = new Date(base);
    x.setHours(h, 0, 0, 0);
    return x;
  };
  const tomorrow = new Date(now.getTime() + 86_400_000);
  const tonight = at(now, 20);
  const monday = new Date(now);
  monday.setDate(monday.getDate() + ((8 - monday.getDay()) % 7 || 7));
  return [
    { label: 'In an hour', at: new Date(now.getTime() + 3_600_000) },
    // Under ten minutes to 8pm counts as "missed it" — offer tomorrow's.
    {
      label: 'Tonight 8pm',
      at: tonight.getTime() > now.getTime() + 600_000 ? tonight : at(tomorrow, 20),
    },
    { label: 'Tomorrow 9am', at: at(tomorrow, 9) },
    { label: 'Monday 9am', at: at(monday, 9) },
  ];
}

/** Add, retime, or remove reminders on the note being edited. Presets cover
 * the common cases in one tap; the datetime field handles everything else.
 * Times are stored with the local offset (nowIso), never as UTC-Z — recurrence
 * expands on wall-clock time (review H4). */
function ReminderEditor({
  reminders,
  onChange,
}: {
  reminders: Reminder[];
  onChange: (r: Reminder[]) => void;
}) {
  const add = (atDate: Date): void =>
    onChange([...reminders, { at: nowIso(atDate), status: 'active' }]);
  const patch = (i: number, next: Partial<Reminder>): void =>
    onChange(reminders.map((r, j) => (j === i ? { ...r, ...next } : r)));
  const remove = (i: number): void => onChange(reminders.filter((_, j) => j !== i));

  return (
    <div className="reminder-editor">
      {reminders.map((r, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: reminders have no id; index is stable within an edit session
        <div className="reminder-block" key={i}>
          <div className="reminder-row">
            <Icon name="bell" className="reminder-bell" />
            <ReminderTimeField at={r.at} onChange={(at) => patch(i, { at })} />
            <button
              type="button"
              className="icon-btn danger"
              title="Remove reminder"
              onClick={() => remove(i)}
            >
              <Icon name="x" />
            </button>
          </div>
          <AxisRow
            name="repeat"
            steps={RRULE_PRESETS.map((p) => p.label)}
            active={RRULE_PRESETS.find((p) => (p.rrule ?? undefined) === r.rrule)?.label ?? 'Once'}
            onPick={(label) => {
              const rrule = RRULE_PRESETS.find((p) => p.label === label)?.rrule ?? null;
              patch(i, rrule ? { rrule } : { rrule: undefined });
            }}
          />
        </div>
      ))}
      <div className="reminder-presets">
        <span className="preset-label">Remind me</span>
        {/* Leading + marks these as one-shot ADD actions — without it they
            read as another pick-one segmented control like REPEAT above. */}
        {reminderPresets(new Date()).map((p) => (
          <button key={p.label} type="button" className="preset-chip" onClick={() => add(p.at)}>
            <Icon name="plus" />
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The reminder time as a tappable human label ("Thu 10 Jul, 22:00") backed by
 * a hidden native datetime input: showPicker() opens the platform's real
 * picker, and where that isn't supported the raw native field takes over —
 * a worse look but never a dead control. */
function ReminderTimeField({ at, onChange }: { at: string; onChange: (iso: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [rawMode, setRawMode] = useState(false);

  if (rawMode) {
    return (
      <input
        type="datetime-local"
        aria-label="Reminder time"
        className="reminder-time-raw"
        value={isoToLocalInput(at)}
        onChange={(e) => e.target.value && onChange(localInputToIso(e.target.value))}
      />
    );
  }

  return (
    <span className="reminder-time">
      <button
        type="button"
        className="time-button"
        onClick={() => {
          const el = inputRef.current;
          if (!el) return;
          try {
            el.showPicker();
          } catch {
            setRawMode(true);
          }
        }}
      >
        {reminderLabel(at)}
      </button>
      <input
        ref={inputRef}
        type="datetime-local"
        className="picker-anchor"
        tabIndex={-1}
        aria-hidden="true"
        value={isoToLocalInput(at)}
        onChange={(e) => e.target.value && onChange(localInputToIso(e.target.value))}
      />
    </span>
  );
}

type EditorLayout = 'contained' | 'fullscreen';

/** Shows a message instead of a white screen if tldraw fails to mount. The
 * drawing itself is never at risk — the note file holds it. */
class CanvasErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  render(): ReactNode {
    if (this.state.failed)
      return (
        <div className="canvas-loading canvas-failed">
          <p>The canvas couldn't open.</p>
          <span>Your drawing is safe in the note file — close and reopen to retry.</span>
        </div>
      );
    return this.props.children;
  }
}

/** The editor's TAGS row: current tags as removable chips plus a dashed
 * + Tag control (dashed = it creates something) with most-used suggestions. */
function TagEditor({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const suggestions = useMemo(
    () => allTags().filter((t) => !tags.includes(t)).slice(0, 8),
    [tags],
  );
  const commit = (): void => {
    if (draft.trim()) onChange(normalizeTags([...tags, draft]));
    setDraft('');
    setAdding(false);
  };
  return (
    <div className="tag-editor">
      {tags.map((t) => (
        <span key={t} className="tag-chip tag-chip-set">
          #{t}
          <button
            type="button"
            className="tag-remove"
            title={`Remove ${t}`}
            onClick={() => onChange(tags.filter((x) => x !== t))}
          >
            ×
          </button>
        </span>
      ))}
      {adding ? (
        <>
          <input
            className="tag-input"
            list="tag-suggestions"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit();
              }
              if (e.key === 'Escape') {
                setDraft('');
                setAdding(false);
              }
            }}
          />
          <datalist id="tag-suggestions">
            {suggestions.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </>
      ) : (
        <button type="button" className="tag-add" onClick={() => setAdding(true)}>
          + Tag
        </button>
      )}
    </div>
  );
}

export function EditorPanel({
  doc,
  onClose,
  closeToken = 0,
}: {
  doc: ServerDoc;
  onClose: () => void;
  /** Bumped by the app shell (e.g. a bottom-bar tab tap) to request a close;
   * the editor auto-saves on the way out. */
  closeToken?: number;
}) {
  // Legacy whole-note canvases may still arrive over sync from an unmigrated
  // server; edit (and eventually save) them in block form (ADR-0006).
  const [body, setBody] = useState(() => migrateLegacyCanvas(doc.body));
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
  const [tags, setTags] = useState<string[]>(doc.tags ?? []);
  const [saved, setSaved] = useState({
    body: doc.body,
    durability: doc.durability,
    formality: doc.formality,
    importance: doc.importance,
    reminders: JSON.stringify(doc.reminders),
    tags: JSON.stringify(doc.tags ?? []),
  });
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [editorMode, setEditorMode] = useState<'rich' | 'raw'>(() =>
    localStorage.getItem('forge-editor-mode') === 'raw' ? 'raw' : 'rich',
  );
  // A note that is nothing but one drawing opens straight into it; a note
  // with prose opens as text, and a canvas block opens fullscreen on tap
  // (drawing needs the whole screen — a sheet can't host it).
  const canvasOnly = listCanvasBlocks(body).length === 1 && stripCanvasBlocks(body).trim() === '';
  const [canvasAt, setCanvasAt] = useState<number | null>(() =>
    canvasOnly ? (listCanvasBlocks(body)[0]?.startLine ?? null) : null,
  );
  const inCanvas = canvasAt !== null;
  const [layout, setLayout] = useState<EditorLayout>(() =>
    localStorage.getItem('forge-layout-text') === 'fullscreen' ? 'fullscreen' : 'contained',
  );
  const toggleLayout = (): void => {
    const next: EditorLayout = layout === 'contained' ? 'fullscreen' : 'contained';
    setLayout(next);
    localStorage.setItem('forge-layout-text', next);
  };
  const dirty =
    body !== saved.body ||
    axes.durability !== saved.durability ||
    axes.formality !== saved.formality ||
    axes.importance !== saved.importance ||
    JSON.stringify(reminders) !== saved.reminders ||
    JSON.stringify(tags) !== saved.tags;

  const toggleMode = (): void => {
    const next = editorMode === 'rich' ? 'raw' : 'rich';
    setEditorMode(next);
    localStorage.setItem('forge-editor-mode', next);
  };

  const save = async (): Promise<void> => {
    if (!dirty || busy) return;
    setBusy(true);
    try {
      const newRev = await saveDoc(doc.id, baseRev, { body, ...axes, reminders, tags });
      setBaseRev(newRev);
      setSaved({ body, ...axes, reminders: JSON.stringify(reminders), tags: JSON.stringify(tags) });
    } catch (e) {
      flashNotice(e instanceof Error ? `Save failed: ${e.message}` : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  // Set synchronously on the first stroke — the discard decision below must
  // never race tldraw's 500ms body-serialization debounce (review R3 #2).
  const canvasTouched = useRef(false);

  const maybeClose = (): void => {
    // A canvas with no strokes at all is an artifact of tapping "New canvas" —
    // closing it deletes it, so backing out of a new canvas leaves nothing
    // behind (and opening a stray empty one heals it). Both sides of the
    // check: it must have OPENED empty too, so a hand-typed empty fence in a
    // real note never triggers a delete.
    if (
      body === emptyCanvasBody() &&
      migrateLegacyCanvas(saved.body) === emptyCanvasBody() &&
      !canvasTouched.current
    ) {
      void removeDoc(doc.id);
      flashNotice('Empty canvas discarded');
      onClose();
      return;
    }
    // Dirty edits auto-save on the way out: the outbox + files-as-truth make
    // a fire-and-forget save safe offline, and it retires the old
    // "Discard unsaved edits?" gauntlet. saveDoc directly, not save(): the
    // busy gate must not drop keystrokes typed while a save was in flight —
    // the outbox coalesces the second enqueue.
    if (dirty) void saveDoc(doc.id, baseRev, { body, ...axes, reminders, tags });
    onClose();
  };

  // The app shell bumps closeToken when the user navigates (bottom-bar tap)
  // while the editor is open; the editor saves and closes itself.
  const maybeCloseRef = useRef(maybeClose);
  maybeCloseRef.current = maybeClose;
  const seenToken = useRef(closeToken);
  useEffect(() => {
    if (closeToken !== seenToken.current) {
      seenToken.current = closeToken;
      maybeCloseRef.current();
    }
  }, [closeToken]);

  // No confirm dialog: the note vanishes with an Undo notice, which is both
  // faster and safer than a reflexive-tap confirm (files + git keep history).
  const del = (): void => {
    void removeDocUndoable(doc.id);
    onClose();
  };

  // Archive applies and closes; it carries the current edits along so
  // archiving mid-edit never discards typed text.
  const toggleArchive = async (): Promise<void> => {
    await saveDoc(doc.id, baseRev, { body, ...axes, reminders, tags, archived: !doc.archived });
    flashNotice(doc.archived ? 'Note restored' : 'Archived — it lives on in the Archive view');
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
        className={`editor${inCanvas ? ' editor-canvas editor-fullscreen' : layout === 'fullscreen' ? ' editor-fullscreen' : ''}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {!inCanvas && (
          <div className="editor-head">
            <span className="file-path">~/DataForge/notes/{doc.id}.md</span>
            <button
              type="button"
              className="icon-btn head-toggle"
              title={layout === 'contained' ? 'Fullscreen' : 'Exit fullscreen'}
              onClick={toggleLayout}
            >
              <Icon name={layout === 'contained' ? 'maximize' : 'minimize'} />
            </button>
          </div>
        )}
        {/* Canvas gets a slim top bar and NO bottom action bar: tldraw owns
            the bottom of the screen (its toolbar + the tab bar are already
            two stacked chromes — a third was mis-tap territory). Drawing
            saves on close like any other dirty edit. */}
        {inCanvas && (
          <div className="canvas-topbar">
            <ActionMenu
              title="More actions"
              items={[
                {
                  icon: 'archive' as IconName,
                  label: doc.archived ? 'Unarchive' : 'Archive',
                  onPick: () => void toggleArchive(),
                },
                {
                  icon: 'trash' as IconName,
                  label: 'Delete note',
                  danger: true,
                  onPick: del,
                },
              ]}
            />
            <span className="spacer" />
            {/* A drawing-only note closes outright; a canvas inside a prose
                note steps back to the text (the drawing rides the same body). */}
            <button
              type="button"
              className="icon-btn head-toggle"
              title={canvasOnly ? 'Save and close' : 'Back to note'}
              onClick={canvasOnly ? maybeClose : () => setCanvasAt(null)}
            >
              <Icon name={canvasOnly ? 'x' : 'minimize'} />
            </button>
          </div>
        )}
        {showHistory ? (
          <HistoryPanel docId={doc.id} onPick={setBody} onClose={() => setShowHistory(false)} />
        ) : inCanvas ? (
          <CanvasErrorBoundary>
            <Suspense fallback={<div className="canvas-loading">Opening canvas…</div>}>
              <LazyCanvasEditor
                value={body}
                blockStart={canvasAt ?? undefined}
                onChange={setBody}
                onTouch={() => {
                  canvasTouched.current = true;
                }}
              />
            </Suspense>
          </CanvasErrorBoundary>
        ) : (
          <NoteEditor
            key={editorMode}
            value={body}
            onChange={setBody}
            mode={editorMode}
            autoFocus
            onOpenCanvas={setCanvasAt}
          />
        )}
        {!inCanvas && (
          <div className="editor-section">
            <AxisDisclosure value={axes} onChange={setAxes} />
          </div>
        )}
        {!inCanvas && (
          <div className="editor-section">
            <span className="section-label">Tags</span>
            <TagEditor tags={tags} onChange={setTags} />
          </div>
        )}
        {!inCanvas && (
          <div className="editor-section">
            <span className="section-label">Reminders</span>
            <ReminderEditor reminders={reminders} onChange={setReminders} />
          </div>
        )}
        {!inCanvas && (
        <div className="editor-actions">
          <ActionMenu
            up
            title="More actions"
            items={[
              {
                icon: (editorMode === 'rich' ? 'code' : 'pencil') as IconName,
                label: editorMode === 'rich' ? 'Raw markdown' : 'Rich text',
                onPick: toggleMode,
              },
              {
                icon: 'pencil' as IconName,
                label: 'Add canvas',
                onPick: () => {
                  const next = body.trim() ? `${body}\n\n${emptyCanvasBody()}` : emptyCanvasBody();
                  setBody(next);
                  const added = listCanvasBlocks(next).at(-1);
                  if (added) setCanvasAt(added.startLine);
                },
              },
              // Auto-save-on-close removed the discard dialog; this is the
              // deliberate way to walk away from unwanted edits instead.
              ...(dirty
                ? [
                    {
                      icon: 'x' as IconName,
                      label: 'Discard changes',
                      onPick: () => {
                        setBody(saved.body);
                        setAxes({
                          durability: saved.durability,
                          formality: saved.formality,
                          importance: saved.importance,
                        });
                        setReminders(JSON.parse(saved.reminders));
                        setTags(JSON.parse(saved.tags));
                      },
                    },
                  ]
                : []),
              {
                icon: 'archive' as IconName,
                label: doc.archived ? 'Unarchive' : 'Archive',
                onPick: () => void toggleArchive(),
              },
              {
                icon: 'history' as IconName,
                label: showHistory ? 'Hide history' : 'Version history',
                onPick: () => setShowHistory((h) => !h),
              },
              {
                icon: 'trash' as IconName,
                label: 'Delete note',
                danger: true,
                onPick: del,
              },
            ]}
          />
          <span className="spacer" />
          <button type="button" className="ghost" onClick={maybeClose}>
            Close
          </button>
          <button
            type="button"
            className="primary"
            disabled={!dirty || busy}
            onClick={() => void save()}
          >
            <Icon name="check" />
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
        )}
      </div>
    </div>
  );
}
