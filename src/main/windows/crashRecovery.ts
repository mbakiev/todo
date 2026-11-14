// A crashed / killed renderer must never leave a blank window behind (main or quick add):
// reload it. A renderer that keeps crashing (3 times within 60 s) is not reloaded in a loop;
// the user is asked instead (Quit / Try again). A renderer that stays unresponsive for 10 s
// (not a short busy spell such as applying a big import) gets a Wait / Reload prompt, which
// closes by itself when it recovers and is shown at most once per freeze.
import { app, dialog, type BrowserWindow } from 'electron'
import { APP_DISPLAY_NAME } from '@shared/constants'
import { isTestRun } from '../paths'

export const CRASH_LIMIT = 3
export const CRASH_WINDOW_MS = 60_000

/** Pure crash-loop detector: `reload` until `limit` crashes fall within `windowMs`. */
export function createCrashTracker(limit = CRASH_LIMIT, windowMs = CRASH_WINDOW_MS) {
  let crashes: number[] = []
  return {
    record(now: number): 'reload' | 'give-up' {
      crashes = [...crashes.filter((t) => now - t < windowMs), now]
      return crashes.length >= limit ? 'give-up' : 'reload'
    },
    reset(): void {
      crashes = []
    },
  }
}

/** How long a window must stay unresponsive before the Wait / Reload prompt appears. */
export const HANG_PROMPT_DELAY_MS = 10_000

export interface HangPrompt {
  /** Resolves with the user's answer (or 'wait' when closed by `close()`). */
  answer: Promise<'wait' | 'reload'>
  close(): void
}

export interface HangWatchDeps {
  delayMs?: number
  setTimer(fn: () => void, ms: number): unknown
  clearTimer(handle: unknown): void
  /** Whether a prompt makes sense right now (window still there and visible). */
  canPrompt(): boolean
  showPrompt(): HangPrompt
  reload(): void
}

/**
 * Pure "unresponsive" state machine: prompts only after the window has been unresponsive for
 * `delayMs` without a `responsive` in between, dismisses the prompt when it recovers, and
 * never prompts twice for the same freeze (answering Wait keeps it quiet until it recovers).
 */
export function createHangWatch(deps: HangWatchDeps) {
  const delayMs = deps.delayMs ?? HANG_PROMPT_DELAY_MS
  let timer: unknown = null
  let prompt: HangPrompt | null = null
  let promptedThisFreeze = false
  const stopTimer = (): void => {
    if (timer !== null) deps.clearTimer(timer)
    timer = null
  }
  return {
    unresponsive(): void {
      if (timer !== null || prompt || promptedThisFreeze) return
      timer = deps.setTimer(() => {
        timer = null
        if (!deps.canPrompt()) return
        promptedThisFreeze = true
        const shown = deps.showPrompt()
        prompt = shown
        void shown.answer.then((answer) => {
          if (prompt !== shown) return // dismissed because the window recovered
          prompt = null
          if (answer === 'reload') {
            promptedThisFreeze = false
            deps.reload()
          }
        })
      }, delayMs)
    },
    responsive(): void {
      stopTimer()
      promptedThisFreeze = false
      const open = prompt
      prompt = null
      open?.close()
    },
    dispose(): void {
      stopTimer()
      const open = prompt
      prompt = null
      open?.close()
    },
  }
}

/** Test hook (MARTIN_TODOS_E2E=1 only): how the crash-loop dialog is answered. */
const CRASH_CHOICE_ENV = 'MARTIN_TODOS_CRASH_DIALOG_CHOICE'

export function installCrashRecovery(win: BrowserWindow, label: string): void {
  const tracker = createCrashTracker()
  const wc = win.webContents

  wc.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit' || win.isDestroyed()) return
    console.error(`[${label}] renderer gone (${details.reason}, exit code ${details.exitCode})`)
    if (tracker.record(Date.now()) === 'reload') {
      wc.reload()
      return
    }
    void askAfterCrashLoop(win).then((choice) => {
      if (choice === 'quit') {
        app.quit()
      } else if (!win.isDestroyed()) {
        tracker.reset()
        wc.reload()
      }
    })
  })

  const hang = createHangWatch({
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (t) => clearTimeout(t as NodeJS.Timeout),
    canPrompt: () => !isTestRun && !win.isDestroyed() && win.isVisible(),
    showPrompt: () => {
      const abort = new AbortController()
      const answer = dialog
        .showMessageBox(win, {
          type: 'warning',
          title: APP_DISPLAY_NAME,
          message: `${APP_DISPLAY_NAME} is not responding.`,
          detail: 'You can wait for it, or reload the window (unsaved typing may be lost).',
          buttons: ['Wait', 'Reload'],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
          signal: abort.signal,
        })
        .then(({ response }) => (response === 1 ? ('reload' as const) : ('wait' as const)))
      return { answer, close: () => abort.abort() }
    },
    reload: () => {
      if (!win.isDestroyed()) wc.reload()
    },
  })
  wc.on('unresponsive', () => hang.unresponsive())
  wc.on('responsive', () => hang.responsive())
  wc.on('render-process-gone', () => hang.responsive())
  win.on('closed', () => hang.dispose())
}

async function askAfterCrashLoop(win: BrowserWindow): Promise<'quit' | 'reload'> {
  const stub = isTestRun ? process.env[CRASH_CHOICE_ENV] : undefined
  if (stub !== undefined) {
    console.log(`[crash-dialog] crash loop detected -> ${stub}`)
    return stub === 'reload' ? 'reload' : 'quit'
  }
  const options: Electron.MessageBoxOptions = {
    type: 'error',
    title: APP_DISPLAY_NAME,
    message: `${APP_DISPLAY_NAME} keeps crashing.`,
    detail:
      'The window crashed several times in a row. Your saved tasks are safe. You can quit, or try loading the window again.',
    buttons: ['Quit', 'Try again'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  }
  const { response } = win.isDestroyed()
    ? await dialog.showMessageBox(options)
    : await dialog.showMessageBox(win, options)
  return response === 1 ? 'reload' : 'quit'
}
