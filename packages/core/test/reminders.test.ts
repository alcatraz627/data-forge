import { describe, expect, it } from 'vitest';
import {
  buildAgenda,
  completeReminder,
  effectiveFireAt,
  nextOccurrenceAfter,
  snoozeReminder,
} from '../src/reminders.js';
import type { Reminder } from '../src/types.js';

const oneShot = (at: string): Reminder => ({ at, status: 'active' });
const weekly = (at: string): Reminder => ({ at, rrule: 'FREQ=WEEKLY', status: 'active' });

describe('effectiveFireAt', () => {
  it('uses the snooze target while snoozed, else at', () => {
    expect(effectiveFireAt(oneShot('2026-07-10T09:00:00Z'))).toBe('2026-07-10T09:00:00Z');
    expect(
      effectiveFireAt({
        at: '2026-07-10T09:00:00Z',
        status: 'snoozed',
        snoozedUntil: '2026-07-11T09:00:00Z',
      }),
    ).toBe('2026-07-11T09:00:00Z');
  });
});

describe('recurrence', () => {
  it('finds the next weekly occurrence after a date', () => {
    const next = nextOccurrenceAfter(
      weekly('2026-07-07T09:00:00Z'),
      new Date('2026-07-08T00:00:00Z'),
    );
    expect(next?.toISOString()).toBe('2026-07-14T09:00:00.000Z');
  });

  it('one-shots have no next occurrence', () => {
    expect(nextOccurrenceAfter(oneShot('2026-07-10T09:00:00Z'), new Date('2026-07-01'))).toBeNull();
  });
});

describe('completeReminder', () => {
  it('marks a one-shot done', () => {
    const done = completeReminder(
      oneShot('2026-07-10T09:00:00Z'),
      new Date('2026-07-10T10:00:00Z'),
    );
    expect(done.status).toBe('done');
  });

  it('rolls a recurring reminder forward and keeps it active', () => {
    const rolled = completeReminder(
      weekly('2026-07-07T09:00:00Z'),
      new Date('2026-07-07T10:00:00Z'),
    );
    expect(rolled.status).toBe('active');
    // Same instant as 2026-07-14T09:00Z, formatted with the reminder's offset.
    expect(new Date(rolled.at).toISOString()).toBe('2026-07-14T09:00:00.000Z');
    expect(rolled.rrule).toBe('FREQ=WEEKLY');
  });

  it('preserves the reminder offset when rolling forward (no Z collapse)', () => {
    const r: Reminder = { at: '2026-07-07T09:00:00+05:30', rrule: 'FREQ=WEEKLY', status: 'active' };
    const rolled = completeReminder(r, new Date('2026-07-07T09:00:00+05:30'));
    expect(rolled.at).toBe('2026-07-14T09:00:00+05:30');
  });
});

describe('recurrence expands on local wall-clock (H4)', () => {
  const localFields = (d: Date) => new Date(d.getTime() + 5.5 * 3600_000);

  it('a 1 AM IST weekdays reminder lands on local weekdays, not UTC days', () => {
    // 2026-07-07 is a Tuesday; in UTC this instant is Monday 19:30, so a naive
    // UTC expansion would fire Tue-Sat locally. The fix expands on wall-clock.
    const r: Reminder = {
      at: '2026-07-07T01:00:00+05:30',
      rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
      status: 'active',
    };
    const next = nextOccurrenceAfter(r, new Date('2026-07-07T01:00:00+05:30'));
    expect(next).not.toBeNull();
    expect(localFields(next as Date).getUTCDay()).toBe(3); // Wednesday
    expect(localFields(next as Date).getUTCHours()).toBe(1); // 01:00 local
  });

  it('skips the weekend: Friday 1 AM IST rolls to Monday locally', () => {
    const r: Reminder = {
      at: '2026-07-10T01:00:00+05:30', // Friday 1 AM IST
      rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
      status: 'active',
    };
    const next = nextOccurrenceAfter(r, new Date('2026-07-10T01:00:00+05:30'));
    expect(localFields(next as Date).getUTCDay()).toBe(1); // Monday
  });
});

describe('snoozeReminder', () => {
  it('sets snoozed status and target', () => {
    const s = snoozeReminder(oneShot('2026-07-10T09:00:00Z'), new Date('2026-07-10T11:00:00Z'));
    expect(s.status).toBe('snoozed');
    expect(s.snoozedUntil).toBe('2026-07-10T11:00:00.000Z');
  });
});

describe('buildAgenda', () => {
  const now = new Date('2026-07-10T09:00:00Z');
  const docs = [
    { id: 'a', title: 'overdue', reminders: [oneShot('2026-07-09T09:00:00Z')] },
    { id: 'b', title: 'soon', reminders: [oneShot('2026-07-11T09:00:00Z')] },
    { id: 'c', title: 'far off', reminders: [oneShot('2026-12-01T09:00:00Z')] },
    {
      id: 'd',
      title: 'done already',
      reminders: [{ at: '2026-07-08T09:00:00Z', status: 'done' as const }],
    },
    { id: 'e', title: 'no reminders', reminders: [] },
  ];

  it('sorts by time, flags overdue, honors horizon, drops done', () => {
    const agenda = buildAgenda(docs, now, 30);
    expect(agenda.map((e) => e.title)).toEqual(['overdue', 'soon']);
    expect(agenda[0]?.overdue).toBe(true);
    expect(agenda[1]?.overdue).toBe(false);
  });

  it('includes far-off items when the horizon is wide enough', () => {
    const agenda = buildAgenda(docs, now, 365);
    expect(agenda.map((e) => e.title)).toEqual(['overdue', 'soon', 'far off']);
  });
});
