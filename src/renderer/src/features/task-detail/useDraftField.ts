// A locally edited copy of a task field that autosaves (debounced) and adopts external changes
// only when there is no unsaved local edit.
//
// A save that fails keeps the user's text: the draft stays dirty, the store's rolled-back
// value is never adopted over it, the field shows a persistent "Not saved" state, and the
// next edit, flush (blur / panel close / window hide) or an explicit retry saves it again.
// An invalid draft (e.g. over the length limit) is never sent and never overwritten either.
// `flushAsync` reports whether everything is saved, so the panel can refuse to close on a
// failure; `onSaveFailed` lets it keep the text outside React (lib/draftRecovery.ts), and a
// recovered draft from an earlier session starts in the `recovered` state (Keep / Discard).
import { useEffect, useRef, useState } from 'react'
import { AUTOSAVE_DEBOUNCE_MS } from '@shared/constants'
import { createAutosave, type Autosave } from './autosave'

/**
 * `saved`: nothing pending · `failed`: the last save was rejected · `invalid`: not saveable ·
 * `recovered`: showing unsaved text from an earlier session, waiting for Keep / Discard.
 */
export type DraftStatus = 'saved' | 'failed' | 'invalid' | 'recovered'

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
  /** A save of `value` failed (latest attempt only). */
  onSaveFailed?(value: string): void
  /** The latest save succeeded. */
  onSaveSucceeded?(): void
  /** Unsaved text recovered from an earlier session: shown instead of `value` until kept. */
  recovered?: string | null
  /** The recovered text was discarded. */
  onDiscardRecovered?(): void
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
  /** Flush and wait for the answers: true when everything typed is saved. */
  flushAsync(): Promise<boolean>
  /** Recovered text: save it. */
  keepRecovered(): void
  /** Recovered text: drop it and show the saved value. */
  discardRecovered(): void
  readonly dirty: boolean
  /** A save is in flight (it may still fail and make the draft dirty again). */
  readonly saving: boolean
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
  /** Settlement of each in-flight save (for flushAsync). */
  private readonly answers = new Set<Promise<void>>()
  /** Showing recovered text that the user has not kept yet. */
  private recovered: boolean
  readonly autosave: Autosave<string>
  private onStatus: (status: DraftStatus) => void = () => {}
  private onSettled: () => void = () => {}
  /** Outcome callbacks (kept current by the hook via setOutcomeHooks). */
  private hooks: { failed?(value: string): void; succeeded?(): void } = {}

  constructor(
    initial: string,
    private normalize: (v: string) => string,
    private isValid: (v: string) => boolean,
    private readonly save: (v: string) => void | Promise<boolean>,
    delayMs: number,
    recovered = false,
  ) {
    this.synced = normalize(initial)
    this.recovered = recovered
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

  setOutcomeHooks(hooks: { failed?(value: string): void; succeeded?(): void }): void {
    this.hooks = hooks
  }

  setRules(normalize: (v: string) => string, isValid: (v: string) => boolean): void {
    this.normalize = normalize
    this.isValid = isValid
  }

  get status(): DraftStatus {
    if (this.recovered) return 'recovered'
    if (this.invalid) return 'invalid'
    return this.failedValue !== null ? 'failed' : 'saved'
  }

  /** True while the draft holds text the store does not (pending, failed or invalid). */
  get dirty(): boolean {
    return this.autosave.dirty || this.failedValue !== null || this.invalid || this.recovered
  }

  /**
   * True while a save is in flight. The store already shows the text then, so the draft is
   * not `dirty` — but the save can still fail and hand the text back.
   */
  get saving(): boolean {
    return this.inflight > 0
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
    const answer = result.then(
      (ok) => this.settled(attempt, value, ok),
      () => this.settled(attempt, value, false),
    )
    this.answers.add(answer)
    void answer.finally(() => this.answers.delete(answer))
  }

  private settled(attempt: number, value: string, ok: boolean): void {
    this.inflight--
    if (attempt === this.attempt) {
      if (ok) {
        this.hooks.succeeded?.()
      } else {
        // The store has rolled back; keep the text and remember to save it again.
        this.synced = null
        this.failedValue = value
        this.onStatus(this.status)
        this.hooks.failed?.(value)
      }
    }
    if (this.inflight === 0) this.onSettled()
  }

  /** Flush, then wait for every answer. True when nothing typed is left unsaved. */
  async flushAsync(): Promise<boolean> {
    if (this.recovered) return true // undecided recovered text stays stored; nothing to lose
    if (this.invalid) return false
    this.flush()
    while (this.answers.size > 0) await Promise.allSettled([...this.answers])
    return this.failedValue === null && !this.invalid && !this.autosave.dirty
  }

  /** Recovered text kept: it is now an ordinary edit (saved right away). */
  keep(value: string): void {
    this.recovered = false
    this.synced = null
    this.edit(value)
    this.onStatus(this.status)
    this.flush()
  }

  /** A user edit: schedule a save, or cancel one if the value is back to saved / invalid. */
  edit(value: string): void {
    if (this.recovered) {
      // Editing recovered text keeps it.
      this.recovered = false
      this.synced = null
      this.onStatus(this.status)
    }
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
    this.recovered = false
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
  onSaveFailed,
  onSaveSucceeded,
  recovered = null,
  onDiscardRecovered,
}: DraftFieldOptions): DraftField {
  const [draft, setDraft] = useState(recovered ?? value)
  const [ctl] = useState(
    () => new DraftController(value, normalize, isValid, save, delayMs, recovered !== null),
  )
  const [status, setStatus] = useState<DraftStatus>(recovered !== null ? 'recovered' : 'saved')
  useEffect(() => {
    ctl.setRules(normalize, isValid)
    ctl.setOutcomeHooks({ failed: onSaveFailed, succeeded: onSaveSucceeded })
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
    flushAsync: () => ctl.flushAsync(),
    keepRecovered: () => ctl.keep(draft),
    discardRecovered: () => {
      ctl.reset(value)
      setDraft(value)
      onDiscardRecovered?.()
    },
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
    get saving() {
      return ctl.saving
    },
  }
}
