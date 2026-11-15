// Holds every quit until the renderer has saved pending edits (main↔renderer flush
// handshake, windows/rendererFlush.ts), and closes the database only after that.
//
// Quit paths: tray Quit, app menu Quit / Cmd+Q, SIGTERM / SIGINT (all via app.quit() →
// `before-quit`), and Windows logoff / shutdown, which emits no before-quit / will-quit: there
// `query-session-end` starts the flush and `session-end` finalizes: at once, or as soon as a
// flush that is still running has settled (closing the DB earlier would drop its writes).
//
// A second quit request while the flush is running is held as well (it used to slip through
// and close the DB before the renderer's writes arrived). Pure state machine; Electron
// wiring in index.ts.

export type QuitState = 'running' | 'flushing' | 'flushed' | 'finalized'

export interface QuitGateDeps {
  /** Ask the renderer to save; resolves when it has (or on timeout). Never rejects. */
  flush(): Promise<unknown>
  /** Re-issue the quit once flushed (app.quit()). */
  quit(): void
  /** Stop timers, unregister shortcuts, close the DB. Runs at most once. */
  finalize(): void
}

export interface QuitGate {
  readonly state: QuitState
  /** `before-quit`: returns true when the quit must be held (caller calls preventDefault). */
  beforeQuit(): boolean
  /** `will-quit`: final cleanup (idempotent). */
  finalize(): void
  /** Windows `query-session-end`: start saving now; the OS gives no later chance. */
  sessionEnding(): void
  /** Windows `session-end`: final cleanup, after the flush if that is still running. */
  sessionEnded(): void
}

export function createQuitGate(deps: QuitGateDeps): QuitGate {
  let state: QuitState = 'running'
  let flushing: Promise<unknown> | null = null
  let quitRequested = false
  let finalizeWhenFlushed = false

  const finalize = (): void => {
    if (state === 'finalized') return
    state = 'finalized'
    deps.finalize()
  }
  const settled = (): void => {
    if (state !== 'flushing') return
    state = 'flushed'
    if (finalizeWhenFlushed) finalize()
    if (quitRequested) deps.quit()
  }
  const startFlush = (): void => {
    if (flushing) return
    state = 'flushing'
    flushing = deps.flush().then(settled, settled)
  }

  return {
    get state() {
      return state
    },
    beforeQuit() {
      if (state === 'flushed' || state === 'finalized') return false
      // Held; a repeated request while flushing is held too, and one real quit follows the
      // flush.
      quitRequested = true
      startFlush()
      return true
    },
    finalize,
    sessionEnding() {
      if (state === 'running') startFlush()
    },
    sessionEnded() {
      // WM_ENDSESSION can follow WM_QUERYENDSESSION at once: the renderer's writes are then
      // still on their way, and a closed DB would lose them.
      if (state === 'flushing') finalizeWhenFlushed = true
      else finalize()
    },
  }
}
