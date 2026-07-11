// rrule is a dual-package hazard: tsx resolves its CommonJS build (needs a
// default/namespace import) while rollup resolves its ESM build (needs a named
// import). A namespace import is the one form that works across tsx, the vite
// build, and vitest — verified in all three.
import * as rrulePkg from 'rrule';
import type { Doc, Reminder } from './types.js';

const { RRule } = rrulePkg;

/**
 * Reminder scheduling math. A reminder fires at a time, optionally repeating
 * on an RFC-5545 recurrence rule. Everything here is pure so it runs the same
 * on the server, in the web app, and (via the compiled contract) informs the
 * native Android alarm scheduler later. Times are ISO-8601 with offsets.
 */

/** The time a reminder is currently set for: its snooze target if snoozed and
 * still in the future, otherwise its `at`. For recurring reminders `at` always
 * holds the current occurrence (completing one rolls it forward). */
export function effectiveFireAt(reminder: Reminder): string {
  if (reminder.status === 'snoozed' && reminder.snoozedUntil) return reminder.snoozedUntil;
  return reminder.at;
}

// Recurrence must expand on the reminder's LOCAL wall-clock, not the absolute
// UTC instant — otherwise BYDAY/BYMONTHDAY rules fire on the wrong day for any
// local time whose UTC calendar date differs (e.g. a 1 AM IST "weekdays"
// reminder is Monday locally but Sunday in UTC). rrule.js has no tz support, so
// we run it in a "floating" frame: a Date whose UTC fields equal the local
// wall-clock. We shift into that frame, let rrule do the weekday math, then
// shift back to a real instant carrying the original offset (review H4).

const OFFSET_RE = /([+-])(\d{2}):(\d{2})$/;

/** Minutes east of UTC encoded in an ISO string (0 for a trailing Z). */
function offsetMinutes(iso: string): number {
  if (iso.endsWith('Z')) return 0;
  const m = iso.match(OFFSET_RE);
  if (!m) return 0;
  const mins = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === '-' ? -mins : mins;
}

const toFloating = (instantMs: number, offMin: number): Date =>
  new Date(instantMs + offMin * 60000);
const toReal = (floatingMs: number, offMin: number): number => floatingMs - offMin * 60000;

function rule(reminder: Reminder): InstanceType<typeof RRule> | null {
  if (!reminder.rrule) return null;
  try {
    const opts = RRule.parseString(reminder.rrule);
    const off = offsetMinutes(reminder.at);
    opts.dtstart = toFloating(new Date(reminder.at).getTime(), off);
    return new RRule(opts);
  } catch {
    return null;
  }
}

/** The next occurrence strictly after `after`, or null for a one-shot (or an
 * exhausted / unparseable rule). Returned as a real instant. */
export function nextOccurrenceAfter(reminder: Reminder, after: Date): Date | null {
  const r = rule(reminder);
  if (!r) return null;
  const off = offsetMinutes(reminder.at);
  const nextFloating = r.after(toFloating(after.getTime(), off), false);
  return nextFloating ? new Date(toReal(nextFloating.getTime(), off)) : null;
}

/** Every firing of a reminder inside [from, to), as real instants — the
 * calendar's day dots. A one-shot contributes its single time; a recurring
 * reminder expands through the window (capped — a month of minutely firings
 * must not hang the UI). Done reminders contribute nothing. */
export function occurrencesBetween(reminder: Reminder, from: Date, to: Date, cap = 120): Date[] {
  if (reminder.status === 'done') return [];
  const r = rule(reminder);
  if (!r) {
    const at = new Date(effectiveFireAt(reminder));
    return at >= from && at < to ? [at] : [];
  }
  const off = offsetMinutes(reminder.at);
  return r
    .between(toFloating(from.getTime(), off), toFloating(to.getTime(), off), true)
    .slice(0, cap)
    .map((d) => new Date(toReal(d.getTime(), off)));
}

/** Formats an instant as ISO-8601 keeping a specific UTC offset, so a reminder
 * rolled forward preserves its original zone instead of collapsing to Z. */
function formatWithOffset(instant: Date, offMin: number): string {
  const wall = new Date(instant.getTime() + offMin * 60000);
  const pad = (n: number) => String(Math.abs(n)).padStart(2, '0');
  const sign = offMin >= 0 ? '+' : '-';
  return (
    `${wall.getUTCFullYear()}-${pad(wall.getUTCMonth() + 1)}-${pad(wall.getUTCDate())}` +
    `T${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}:${pad(wall.getUTCSeconds())}` +
    `${sign}${pad(Math.trunc(offMin / 60))}:${pad(offMin % 60)}`
  );
}

/**
 * Applies a "done" action. A one-shot reminder is marked done. A recurring
 * reminder rolls forward and stays active, so completing "every Tuesday"
 * schedules next Tuesday. "Forward" means past BOTH now and the instance
 * being completed — watering the plants at 19:00 must silence tonight's
 * 22:00 firing, not leave it armed.
 */
export function completeReminder(reminder: Reminder, now: Date): Reminder {
  const currentMs = new Date(effectiveFireAt(reminder)).getTime();
  const past = new Date(Math.max(now.getTime(), Number.isNaN(currentMs) ? 0 : currentMs));
  const next = nextOccurrenceAfter(reminder, past);
  if (next) {
    return {
      at: formatWithOffset(next, offsetMinutes(reminder.at)),
      rrule: reminder.rrule,
      status: 'active',
    };
  }
  const done: Reminder = { at: reminder.at, status: 'done' };
  if (reminder.rrule) done.rrule = reminder.rrule;
  return done;
}

export function snoozeReminder(reminder: Reminder, until: Date): Reminder {
  return { ...reminder, status: 'snoozed', snoozedUntil: until.toISOString() };
}

export interface AgendaEntry {
  docId: string;
  title: string;
  reminderIndex: number;
  at: string;
  overdue: boolean;
  recurring: boolean;
  snoozed: boolean;
}

type AgendaDoc = Pick<Doc, 'id' | 'reminders'> & { title: string };

/**
 * Flattens every active reminder across notes into one time-sorted agenda,
 * out to `horizonDays` ahead (overdue items always included). Done reminders
 * are omitted; this is the "what needs my attention" list.
 */
export function buildAgenda(docs: AgendaDoc[], now: Date, horizonDays = 30): AgendaEntry[] {
  const horizon = now.getTime() + horizonDays * 86_400_000;
  const entries: AgendaEntry[] = [];
  for (const doc of docs) {
    doc.reminders.forEach((reminder, reminderIndex) => {
      if (reminder.status === 'done') return;
      const at = effectiveFireAt(reminder);
      const atMs = new Date(at).getTime();
      if (Number.isNaN(atMs)) return;
      const overdue = atMs < now.getTime();
      if (!overdue && atMs > horizon) return;
      entries.push({
        docId: doc.id,
        title: doc.title,
        reminderIndex,
        at,
        overdue,
        recurring: Boolean(reminder.rrule),
        snoozed: reminder.status === 'snoozed',
      });
    });
  }
  return entries.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

/** Human labels for the recurrence presets the UI offers, so both ends agree. */
export const RRULE_PRESETS: Array<{ label: string; rrule: string | null }> = [
  { label: 'Once', rrule: null },
  { label: 'Daily', rrule: 'FREQ=DAILY' },
  { label: 'Weekly', rrule: 'FREQ=WEEKLY' },
  { label: 'Weekdays', rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' },
  { label: 'Monthly', rrule: 'FREQ=MONTHLY' },
];
