import type { CreateDocBody } from '@forge/core';

/**
 * Turns a Google Keep Takeout note into a Data Forge note. Keep exports one
 * JSON file per note. Trashed notes are dropped; pinned and archived state
 * carry over; checklists become markdown task lists; labels become trailing
 * hashtags so they stay searchable without a tag system. Keep has no axes, so
 * imports land as working/draft: kept, but not yet curated here.
 */

export interface KeepNote {
  title?: string;
  textContent?: string;
  listContent?: Array<{ text: string; isChecked: boolean }>;
  isTrashed?: boolean;
  isArchived?: boolean;
  isPinned?: boolean;
  labels?: Array<{ name: string }>;
  userEditedTimestampUsec?: number;
  createdTimestampUsec?: number;
}

function usecToIso(usec: number | undefined): string | undefined {
  if (!usec || !Number.isFinite(usec)) return undefined;
  return new Date(usec / 1000).toISOString();
}

/** Returns null for notes that should not be imported (trashed, or empty). */
export function keepNoteToDoc(note: KeepNote): CreateDocBody | null {
  if (note.isTrashed) return null;

  const parts: string[] = [];
  if (note.title?.trim()) parts.push(`# ${note.title.trim()}`);
  if (note.textContent?.trim()) parts.push(note.textContent.trim());
  if (note.listContent?.length) {
    parts.push(note.listContent.map((i) => `- [${i.isChecked ? 'x' : ' '}] ${i.text}`).join('\n'));
  }
  const labels = (note.labels ?? []).map((l) => `#${l.name.trim().replace(/\s+/g, '-')}`);
  if (labels.length) parts.push(labels.join(' '));

  const body = parts.join('\n\n').trim();
  if (!body) return null;

  const created = usecToIso(note.createdTimestampUsec);
  const updated = usecToIso(note.userEditedTimestampUsec);
  return {
    body,
    source: 'import:keep',
    durability: 'working',
    formality: 'draft',
    pinned: note.isPinned ?? false,
    archived: note.isArchived ?? false,
    ...(created ? { created } : {}),
    ...(updated ? { updated } : {}),
  };
}
