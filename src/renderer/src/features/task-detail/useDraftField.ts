// A locally edited copy of a task field that autosaves (debounced) and adopts external changes
// only when there is no unsaved local edit.
//
// A save that fails keeps the user's text: the draft stays dirty, the store's rolled-back
// value is never adopted over it, the field shows a persistent "Not saved" state, and the
// next edit, flush (blur / panel close / window hide) or an explicit retry saves it again.
// An invalid draft (e.g. over the length limit) is never sent and never overwritten either.
import { useEffect, useRef, useState } from 'react'
import { AUTOSAVE_DEBOUNCE_MS } from '@shared/constants'
import { createAutosave, type Autosave } from './autosave'

/** `saved`: nothing pending · `failed`: the last save was rejected · `invalid`: not saveable. */
export type DraftStatus = 'saved' | 'failed' | 'invalid'

export interface DraftFieldOptions {
  /** Current value from the store. */
  value: string
  /**
   * Persist a value; may resolve to `false` when the write failed. Captured once: the save
   * target never changes under a pending edit.
   */
  save(value: string): void | Promise<boolean>
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
  /** Save any pending (or previously failed) edit now. */
  flush(): void
  /** Flush, then reset an invalid draft back to the stored value (e.g. on blur). */
  commit(): void
  /** Saves the current draft again after a failure. */
  retry(): void
  readonly dirty: boolean
  readonly status: DraftStatus
}

const identity = (v: string): string => v
const always = (): boolean => true

/** Non-render state of a draft field (kept out of React state on purpose). */
export class DraftController {
  /** The canonical value last saved or adopted; null after a failed save (unknown). */
  private synced: string | null
  /** The raw value whose save failed, until it is saved again. */
  private failedValue: string | null = null
  private invalid = false
  /** Bumped per save so a late answer for an older save is ignored. */
  private attempt = 0
  /**
   * Saves awaiting an answer. Store values are not adopted meanwhile: on failure the store
   * rolls back *before* we hear about it, and that rollback must not replace the draft.
   */
  private inflight = 0
  readonly autosave: Autosave<string>
  private onStatus: (status: DraftStatus) => void = () => {}
  private onSettled: () => void = () => {}

  constructor(
    initial: string,
    private normalize: (v: string) => string,
    private isValid: (v: string) => boolean,
    private readonly save: (v: string) => void | Promise<boolean>,
    delayMs: number,
  ) {
    this.synced = normalize(initial)
    this.autosave = createAutosave<string>((v) => this.persist(v), delayMs)
  }

  /**
   * `status` gets status changes; `settled` runs when the last in-flight save is answered
   * (time to re-check the store value). One listener. Returns an unsubscribe function.
   */
  listen(status: (status: DraftStatus) => void, settled: () => void): () => void {
    this.onStatus = status
    this.onSettled = settled
    return () => {
      if (this.onStatus === status) this.onStatus = () => {}
      if (this.onSettled === settled) this.onSettled = () => {}
    }
  }

  setRules(normalize: (v: string) => string, isValid: (v: string) => boolean): void {
    this.normalize = normalize
    this.isValid = isValid
  }

  get status(): DraftStatus {
    if (this.invalid) return 'invalid'
    return this.failedValue !== null ? 'failed' : 'saved'
  }

  /** True while the draft holds text the store does not (pending, failed or invalid). */
  get dirty(): boolean {
    return this.autosave.dirty || this.failedValue !== null || this.invalid
  }

  private persist(value: string): void {
    const canonical = this.normalize(value)
    const attempt = ++this.attempt
    this.synced = canonical
    const failedBefore = this.failedValue !== null
    this.failedValue = null
    if (failedBefore) this.onStatus(this.status)
    const result = this.save(canonical)
    if (!result) return
    this.inflight++
    void result.then(
      (ok) => this.settled(attempt, value, ok),
      () => this.settled(attempt, value, false),
    )
  }

  private settled(attempt: number, value: string, ok: boolean): void {
    this.inflight--
    if (!ok && attempt === this.attempt) {
      // The store has rolled back; keep the text and remember to save it again.
      this.synced = null
      this.failedValue = value
      this.onStatus(this.status)
    }
    if (this.inflight === 0) this.onSettled()
  }

  /** A user edit: schedule a save, or cancel one if the value is back to saved / invalid. */
  edit(value: string): void {
    const wasInvalid = this.invalid
    this.invalid = !this.isValid(value)
    if (this.invalid) this.autosave.cancel()
    else if (this.failedValue === null && this.normalize(value) === this.synced)
      this.autosave.cancel()
    else this.autosave.set(value)
    if (wasInvalid !== this.invalid) this.onStatus(this.status)
  }

  /** Save now: the pending edit, or the failed one again. */
  flush(): void {
    if (this.autosave.dirty) this.autosave.flush()
    else if (this.failedValue !== null && !this.invalid) this.persist(this.failedValue)
  }

  /** The draft was reset to the stored value (commit of an invalid draft). */
  reset(value: string): void {
    this.autosave.cancel()
    this.invalid = false
    this.failedValue = null
    this.synced = this.normalize(value)
    this.onStatus(this.status)
  }

  /** Should an incoming store value replace the draft? */
  adopt(value: string): boolean {
    if (this.dirty || this.inflight > 0) return false
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
  const [status, setStatus] = useState<DraftStatus>('saved')
  useEffect(() => {
    ctl.setRules(normalize, isValid)
  })
  // Latest store value, for re-checking once our saves are answered (values that arrived
  // while a save was in flight were not adopted).
  const valueRef = useRef(value)
  useEffect(() => {
    valueRef.current = value
  })
  useEffect(
    () =>
      ctl.listen(setStatus, () => {
        if (ctl.adopt(valueRef.current)) setDraft(valueRef.current)
      }),
    [ctl],
  )

  // Adopt external changes (another window, broadcasts) unless the user has unsaved input.
  // Adjusted during render so the new value shows without an extra frame.
  const [seen, setSeen] = useState(value)
  if (value !== seen) {
    setSeen(value)
    if (ctl.adopt(value)) setDraft(value)
  }

  // Never lose the last keystrokes when the field goes away (panel close, task switch).
  useEffect(() => () => ctl.flush(), [ctl])

  return {
    draft,
    status,
    change: (v) => {
      setDraft(v)
      ctl.edit(v)
    },
    flush: () => ctl.flush(),
    retry: () => ctl.flush(),
    commit: () => {
      ctl.flush()
      if (!ctl.valid(draft)) {
        ctl.reset(value)
        setDraft(value)
      }
    },
    get dirty() {
      return ctl.dirty
    },
  }
}
