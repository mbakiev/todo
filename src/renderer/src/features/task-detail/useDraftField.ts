// A locally edited copy of a task field that autosaves (debounced) and adopts external changes
// only when there is no unsaved local edit.
import { useEffect, useState } from 'react'
import { AUTOSAVE_DEBOUNCE_MS } from '@shared/constants'
import { createAutosave, type Autosave } from './autosave'

export interface DraftFieldOptions {
  /** Current value from the store. */
  value: string
  /** Persist a value. Captured once: the save target never changes under a pending edit. */
  save(value: string): void
  /** Canonical form compared and saved (e.g. trimmed title). Default: identity. */
  normalize?(value: string): string
  /** Values that must not be saved (e.g. an empty title). Default: all valid. */
  isValid?(value: string): boolean
  delayMs?: number
}

export interface DraftField {
  draft: string
  /** User edit. */
  change(value: string): void
  /** Save any pending edit now. */
  flush(): void
  /** Flush, then reset an invalid draft back to the stored value (e.g. on blur). */
  commit(): void
  readonly dirty: boolean
}

const identity = (v: string): string => v
const always = (): boolean => true

/** Non-render state of a draft field (kept out of React state on purpose). */
export class DraftController {
  /** The canonical value last saved or adopted; our own saves echo back as this. */
  private synced: string
  readonly autosave: Autosave<string>

  constructor(
    initial: string,
    private normalize: (v: string) => string,
    private isValid: (v: string) => boolean,
    save: (v: string) => void,
    delayMs: number,
  ) {
    this.synced = normalize(initial)
    this.autosave = createAutosave<string>((v) => {
      const canonical = this.normalize(v)
      this.synced = canonical
      save(canonical)
    }, delayMs)
  }

  setRules(normalize: (v: string) => string, isValid: (v: string) => boolean): void {
    this.normalize = normalize
    this.isValid = isValid
  }

  /** A user edit: schedule a save, or cancel one if the value is back to saved / invalid. */
  edit(value: string): void {
    if (!this.isValid(value) || this.normalize(value) === this.synced) this.autosave.cancel()
    else this.autosave.set(value)
  }

  /** Should an incoming store value replace the draft? */
  adopt(value: string): boolean {
    if (this.autosave.dirty) return false
    const canonical = this.normalize(value)
    if (canonical === this.synced) return false
    this.synced = canonical
    return true
  }

  valid(value: string): boolean {
    return this.isValid(value)
  }
}

export function useDraftField({
  value,
  save,
  normalize = identity,
  isValid = always,
  delayMs = AUTOSAVE_DEBOUNCE_MS,
}: DraftFieldOptions): DraftField {
  const [draft, setDraft] = useState(value)
  const [ctl] = useState(() => new DraftController(value, normalize, isValid, save, delayMs))
  useEffect(() => ctl.setRules(normalize, isValid))

  // Adopt external changes (another window, broadcasts) unless the user has unsaved input.
  // Adjusted during render so the new value shows without an extra frame.
  const [seen, setSeen] = useState(value)
  if (value !== seen) {
    setSeen(value)
    if (ctl.adopt(value)) setDraft(value)
  }

  // Never lose the last keystrokes when the field goes away (panel close, task switch).
  useEffect(() => () => ctl.autosave.flush(), [ctl])

  return {
    draft,
    change: (v) => {
      setDraft(v)
      ctl.edit(v)
    },
    flush: () => ctl.autosave.flush(),
    commit: () => {
      ctl.autosave.flush()
      if (!ctl.valid(draft)) setDraft(value)
    },
    get dirty() {
      return ctl.autosave.dirty
    },
  }
}
