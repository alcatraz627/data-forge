import { decodeTime, ulid } from 'ulid';

/** Note ids are ULIDs: time-sortable, collision-safe across devices, and the
 * creation time is recoverable from the id itself, which is what lets the
 * on-disk path (notes/YYYY/MM/<id>.md) be derived from the id alone. */
export const newId = (): string => ulid();

export const idTime = (id: string): Date => new Date(decodeTime(id));

export const isDocId = (s: string): boolean => /^[0-9A-HJKMNP-TV-Z]{26}$/.test(s);
