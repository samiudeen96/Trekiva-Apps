// Pure (no React): the undo/redo rules of the template editor, kept apart so they can be tested.

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
  /** When the newest step was recorded; 0 = start a new step on the next edit. */
  at: number;
}

export const MAX_HISTORY = 100;
/** Edits closer together than this are one undo step, so typing a sentence is not forty steps. */
export const COALESCE_MS = 700;

export const startHistory = <T>(present: T): History<T> => ({ past: [], present, future: [], at: 0 });

export function pushEdit<T>(h: History<T>, next: T, now: number): History<T> {
  if (Object.is(next, h.present)) return h;
  // A burst of edits replaces the newest step instead of adding one. Never after an undo.
  const merge = h.past.length > 0 && h.at > 0 && now - h.at < COALESCE_MS && h.future.length === 0;
  const past = merge ? h.past : [...h.past, h.present].slice(-MAX_HISTORY);
  return { past, present: next, future: [], at: now };
}

export function undoEdit<T>(h: History<T>): History<T> {
  if (h.past.length === 0) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future], at: 0 };
}

export function redoEdit<T>(h: History<T>): History<T> {
  if (h.future.length === 0) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1), at: 0 };
}
