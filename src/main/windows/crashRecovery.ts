// A crashed / killed renderer must never leave a blank window behind (main or quick add):
// reload it. A renderer that keeps crashing (3 times within 60 s) is not reloaded in a loop;
// the user is asked instead (Quit / Try again). A hung renderer gets a Wait / Reload prompt.
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

  wc.on('unresponsive', () => {
    if (isTestRun || win.isDestroyed() || !win.isVisible()) return
    void dialog
      .showMessageBox(win, {
        type: 'warning',
        title: APP_DISPLAY_NAME,
        message: `${APP_DISPLAY_NAME} is not responding.`,
        detail: 'You can wait for it, or reload the window (unsaved typing may be lost).',
        buttons: ['Wait', 'Reload'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      })
      .then(({ response }) => {
        if (response === 1 && !win.isDestroyed()) wc.reload()
      })
  })
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
