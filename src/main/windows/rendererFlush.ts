// Hide/quit flush handshake (spec §7 "never lose keystrokes"). The detail panel debounces
// title/description saves; before the main window hides or the app quits, main asks the
// renderer to write pending edits and waits for its `app.flushDone` answer. A timeout keeps
// a hung or crashed renderer from blocking quit.
import type { BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc'

/** Upper bound on how long quitting waits for the renderer. */
export const QUIT_FLUSH_TIMEOUT_MS = 1500

const waiters = new Map<number, () => void>()
let nextRequestId = 1

export type FlushOutcome = 'flushed' | 'timeout' | 'skipped'

/** Asks the window's renderer to save pending edits; resolves when it has (or on timeout). */
export function requestRendererFlush(
  win: BrowserWindow | null,
  timeoutMs = QUIT_FLUSH_TIMEOUT_MS,
): Promise<FlushOutcome> {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed() || win.webContents.isLoading()) {
    return Promise.resolve('skipped')
  }
  const id = nextRequestId++
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      waiters.delete(id)
      resolve('timeout')
    }, timeoutMs)
    waiters.set(id, () => {
      clearTimeout(timer)
      waiters.delete(id)
      resolve('flushed')
    })
    win.webContents.send(IPC.events.flushRequested, id)
  })
}

/** `app.flushDone` handler. Unknown / late ids are ignored. */
export function rendererFlushed(requestId: number): void {
  waiters.get(requestId)?.()
}
