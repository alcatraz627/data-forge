// rrule ships as CommonJS; a named ESM import ({ RRule }) resolves under
// esbuild/vite but crashes the server under tsx. The default-import form works
// across tsx, vite, and vitest alike.
import rrule from 'rrule';
import type { Doc, Reminder } from './types.js';

const { RRule } = rrule;

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

function rule(reminder: Reminder): InstanceType<typeof RRule> | null {
  if (!reminder.rrule) return null;
  try {
    const opts = RRule.parseString(reminder.rrule);
    opts.dtstart = new Date(reminder.at);
    return new RRule(opts);
  } catch {
    return null;
  }
}

/** The next occurrence strictly after `after`, or null for a one-shot (or an
 * exhausted / unparseable rule). */
export function nextOccurrenceAfter(reminder: Reminder, after: Date): Date | null {
  return rule(reminder)?.after(after, false) ?? null;
}

/**
 * Applies a "done" action. A one-shot reminder is marked done. A recurring
 * reminder rolls forward to its next occurrence after now and stays active,
 * so completing "every Tuesday" schedules next Tuesday. Returns null when a
 * recurring series has no future occurrence (then treat as done).
 */
export function completeReminder(reminder: Reminder, now: Date): Reminder {
  const next = nextOccurrenceAfter(reminder, now);
  if (next) {
    return { at: next.toISOString(), rrule: reminder.rrule, status: 'active' };
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
