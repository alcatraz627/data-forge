import type { Doc, Durability, Formality, Importance } from './types.js';

/**
 * Saved views are the navigation: named axis filters instead of folders.
 * A note is never "in" a view; it matches or it doesn't, so nothing ever
 * needs filing. Definitions are constants for now; they move to
 * meta/settings.json when user-defined views arrive.
 */

export interface ViewFilter {
  durability?: readonly Durability[];
  formality?: readonly Formality[];
  importance?: readonly Importance[];
  sourcePrefix?: string;
  pinnedOnly?: boolean;
}

export interface ViewDef {
  id: string;
  name: string;
  filter: ViewFilter;
}

export const DEFAULT_VIEWS: readonly ViewDef[] = [
  { id: 'all', name: 'All', filter: {} },
  {
    id: 'now',
    name: 'Now',
    filter: { importance: ['high', 'critical'], durability: ['ephemeral', 'working'] },
  },
  { id: 'scratch', name: 'Scratchpad', filter: { durability: ['ephemeral'] } },
  { id: 'reference', name: 'Reference', filter: { durability: ['durable', 'permanent'] } },
  { id: 'conflicts', name: 'Conflicts', filter: { sourcePrefix: 'conflict:' } },
];

type ViewableDoc = Pick<Doc, 'durability' | 'formality' | 'importance' | 'source' | 'pinned'>;

/** Conflict copies only surface in All and in the Conflicts view itself;
 * they would be noise inside topical views. */
export function matchesView(doc: ViewableDoc, view: ViewDef): boolean {
  const f = view.filter;
  if (f.sourcePrefix !== undefined) {
    if (!doc.source.startsWith(f.sourcePrefix)) return false;
  } else if (view.id !== 'all' && doc.source.startsWith('conflict:')) {
    return false;
  }
  if (f.durability && !f.durability.includes(doc.durability)) return false;
  if (f.formality && !f.formality.includes(doc.formality)) return false;
  if (f.importance && !f.importance.includes(doc.importance)) return false;
  if (f.pinnedOnly && !doc.pinned) return false;
  return true;
}
