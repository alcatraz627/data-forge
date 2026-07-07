import { describe, expect, it } from 'vitest';
import { type KeepNote, keepNoteToDoc } from '../src/import/keep.js';
import { type TasksExport, tasksExportToDocs } from '../src/import/tasks.js';

describe('Keep import', () => {
  it('maps a text note with title, pin, and labels', () => {
    const note: KeepNote = {
      title: 'Shopping',
      textContent: 'milk\neggs',
      isPinned: true,
      labels: [{ name: 'home stuff' }],
      createdTimestampUsec: 1_700_000_000_000_000,
      userEditedTimestampUsec: 1_700_000_500_000_000,
    };
    const doc = keepNoteToDoc(note);
    expect(doc).not.toBeNull();
    expect(doc?.body).toBe('# Shopping\n\nmilk\neggs\n\n#home-stuff');
    expect(doc?.pinned).toBe(true);
    expect(doc?.source).toBe('import:keep');
    expect(doc?.durability).toBe('working');
    expect(doc?.created).toBe(new Date(1_700_000_000_000).toISOString());
  });

  it('converts a checklist into a markdown task list', () => {
    const doc = keepNoteToDoc({
      title: 'Trip',
      listContent: [
        { text: 'passport', isChecked: true },
        { text: 'tickets', isChecked: false },
      ],
    });
    expect(doc?.body).toBe('# Trip\n\n- [x] passport\n- [ ] tickets');
  });

  it('carries archived state and drops trashed / empty notes', () => {
    expect(keepNoteToDoc({ textContent: 'x', isArchived: true })?.archived).toBe(true);
    expect(keepNoteToDoc({ textContent: 'x', isTrashed: true })).toBeNull();
    expect(keepNoteToDoc({ title: '   ' })).toBeNull();
  });
});

describe('Tasks import', () => {
  const data: TasksExport = {
    items: [
      {
        title: 'Work',
        items: [
          {
            title: 'ship the thing',
            notes: 'before Friday',
            status: 'needsAction',
            due: '2026-07-10T00:00:00.000Z',
          },
          { title: 'old done task', status: 'completed' },
          { title: '   ' },
        ],
      },
    ],
  };

  it('maps a due task to a note with an active reminder and list hashtag', () => {
    const docs = tasksExportToDocs(data);
    expect(docs).toHaveLength(2);
    const first = docs[0];
    expect(first?.body).toBe('ship the thing\n\nbefore Friday\n\n#Work');
    expect(first?.reminders).toEqual([{ at: '2026-07-10T00:00:00.000Z', status: 'active' }]);
    expect(first?.source).toBe('import:tasks');
  });

  it('archives completed tasks', () => {
    const done = tasksExportToDocs(data)[1];
    expect(done?.archived).toBe(true);
    expect(done?.reminders).toBeUndefined();
  });
});
