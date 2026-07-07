/**
 * The Data Forge document model. A "doc" is one note: a few words, a page, or
 * (later) a canvas. There is deliberately only ONE content entity in the
 * system; a task or reminder is a doc with reminder metadata, not a second
 * type. Axes replace folders and tags (docs/plan.md, "Data model").
 *
 * Axes are discrete steps, not sliders: each value must be one tap on a phone
 * and one keystroke on desktop.
 */

export const DURABILITY = ['ephemeral', 'working', 'durable', 'permanent'] as const;
export type Durability = (typeof DURABILITY)[number];

export const FORMALITY = ['scratch', 'draft', 'polished'] as const;
export type Formality = (typeof FORMALITY)[number];

export const IMPORTANCE = ['low', 'normal', 'high', 'critical'] as const;
export type Importance = (typeof IMPORTANCE)[number];

export interface Reminder {
  /** ISO-8601 with explicit UTC offset. */
  at: string;
  /** RFC 5545 RRULE (e.g. FREQ=WEEKLY;BYDAY=TU). Absent means one-shot. */
  rrule?: string;
  status: 'active' | 'done' | 'snoozed';
  /** Set when status is 'snoozed'. */
  snoozedUntil?: string;
}

export interface DocMeta {
  /** ULID: time-sortable, also the filename stem on disk. */
  id: string;
  created: string;
  updated: string;
  durability: Durability;
  formality: Formality;
  importance: Importance;
  pinned: boolean;
  reminders: Reminder[];
  /** Capture origin, e.g. web | menubar | android-widget | api:<agent> | import:keep. */
  source: string;
}

/** A full document: metadata plus markdown body. Title is always derived
 * from the first heading or first line of the body, never stored. */
export interface Doc extends DocMeta {
  body: string;
}

/** Defaults applied on capture. Saving a thought must require zero decisions;
 * promotion along the axes is a later, deliberate act. */
export const CAPTURE_DEFAULTS = {
  durability: 'ephemeral',
  formality: 'scratch',
  importance: 'normal',
} as const satisfies Pick<DocMeta, 'durability' | 'formality' | 'importance'>;

/** One entry in the server's monotonic change feed, the backbone of sync
 * (docs/plan.md, "Sync protocol"). Clients pull everything after their
 * last-seen seq. */
export interface DocChange {
  seq: number;
  id: string;
  rev: number;
  deleted: boolean;
}
