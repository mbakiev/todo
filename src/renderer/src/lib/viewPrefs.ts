// Per-view UI preferences (list grouping/sort, timeline zoom, calendar "show completed", …).
// Uniformly renderer-side and localStorage-backed via zustand `persist`, one namespaced key per
// view. These are per-device conveniences, deliberately not part of Settings or export.
import { createJSONStorage, type PersistOptions } from 'zustand/middleware'

export const VIEW_PREFS_PREFIX = 'martin-todos.viewPrefs.'

/** localStorage that never throws (unavailable storage just means nothing persists). */
const safeLocalStorage = {
  getItem: (key: string): string | null => {
    try {
      return window.localStorage.getItem(key)
    } catch {
      return null
    }
  },
  setItem: (key: string, value: string): void => {
    try {
      window.localStorage.setItem(key, value)
    } catch {
      // Storage full / unavailable: keep the in-memory value.
    }
  },
  removeItem: (key: string): void => {
    try {
      window.localStorage.removeItem(key)
    } catch {
      // ignore
    }
  },
}

/**
 * `persist` options for a view's preference store. `pick` selects what is saved (plain JSON);
 * `restore` turns a saved value back into state fields, dropping anything invalid — saved data
 * is untrusted (older versions, hand edits).
 */
export function viewPrefs<S, P>(
  view: string,
  pick: (state: S) => P,
  restore: (saved: Record<string, unknown>) => Partial<S>,
): PersistOptions<S, P> {
  return {
    name: `${VIEW_PREFS_PREFIX}${view}`,
    version: 1,
    storage: createJSONStorage<P>(() => safeLocalStorage),
    partialize: pick,
    merge: (persisted, current) => {
      if (!persisted || typeof persisted !== 'object') return current
      return { ...current, ...restore(persisted as Record<string, unknown>) }
    },
  }
}

/** Validation helpers for `restore`. */
export const isOneOf =
  <T extends string>(values: readonly T[]) =>
  (v: unknown): v is T =>
    typeof v === 'string' && (values as readonly string[]).includes(v)

export const stringArray = (v: unknown): string[] | undefined =>
  Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : undefined

/** Assigns `key` only when the saved value passes `valid`. */
export function keepIf<S, K extends keyof S>(
  out: Partial<S>,
  key: K,
  value: unknown,
  valid: (v: unknown) => v is S[K],
): void {
  if (valid(value)) out[key] = value
}
