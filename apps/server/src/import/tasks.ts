import type { CreateDocBody, Reminder } from '@forge/core';

/**
 * Turns Google Tasks Takeout entries into Data Forge notes. A task is just a
 * note with a reminder here, so a due date becomes a reminder and a completed
 * task is archived with its reminder marked done. Tasks export as nested
 * lists; the list title is prepended as a hashtag so the grouping survives.
 */

export interface TasksTask {
  title?: string;
  notes?: string;
  status?: 'needsAction' | 'completed';
  due?: string;
  created?: string;
  updated?: string;
}

export interface TasksList {
  title?: string;
  items?: TasksTask[];
}

export interface TasksExport {
  items?: TasksList[];
}

function taskToDoc(task: TasksTask, listTitle: string | undefined): CreateDocBody | null {
  const title = task.title?.trim();
  if (!title) return null;
  const done = task.status === 'completed';

  const parts = [title];
  if (task.notes?.trim()) parts.push(task.notes.trim());
  if (listTitle?.trim()) parts.push(`#${listTitle.trim().replace(/\s+/g, '-')}`);

  const reminders: Reminder[] = task.due
    ? [{ at: task.due, status: done ? 'done' : 'active' }]
    : [];

  return {
    body: parts.join('\n\n'),
    source: 'import:tasks',
    durability: 'working',
    importance: 'normal',
    archived: done,
    ...(reminders.length ? { reminders } : {}),
    ...(task.created ? { created: task.created } : {}),
    ...(task.updated ? { updated: task.updated } : {}),
  };
}

export function tasksExportToDocs(data: TasksExport): CreateDocBody[] {
  const out: CreateDocBody[] = [];
  for (const list of data.items ?? []) {
    for (const task of list.items ?? []) {
      const doc = taskToDoc(task, list.title);
      if (doc) out.push(doc);
    }
  }
  return out;
}
