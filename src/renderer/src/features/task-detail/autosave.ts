// Debounced autosave for one field (spec §7: "never lose keystrokes"). Framework-free so the
// flush/cancel semantics are unit-tested directly.

export interface Autosave<T> {
  /** Record a new local value and (re)start the debounce timer. */
  set(value: T): void
  /** Save the pending value now, if any. Safe to call repeatedly. */
  flush(): void
  /** Drop the pending value without saving. */
  cancel(): void
  /** True while a value is waiting to be saved. */
  readonly dirty: boolean
}

export interface AutosaveTimers {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

const defaultTimers: AutosaveTimers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
}

export function createAutosave<T>(
  save: (value: T) => void,
  delayMs: number,
  timers: AutosaveTimers = defaultTimers,
): Autosave<T> {
  let pending: { value: T } | null = null
  let handle: unknown = null

  const clear = (): void => {
    if (handle !== null) timers.clearTimeout(handle)
    handle = null
  }

  const flush = (): void => {
    clear()
    if (!pending) return
    const { value } = pending
    pending = null
    save(value)
  }

  return {
    set(value) {
      pending = { value }
      clear()
      handle = timers.setTimeout(flush, delayMs)
    },
    flush,
    cancel() {
      clear()
      pending = null
    },
    get dirty() {
      return pending !== null
    },
  }
}
