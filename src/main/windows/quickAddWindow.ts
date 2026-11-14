// STUB — owned by the desktop-shell feature.
// Spec §8: frameless, always-on-top, skipTaskbar, ~640px wide, upper third of the display
// under the cursor, created hidden at startup; must not bring up the main window.
// Load with `loadRenderer(win, 'quick-add')` from ./loadRenderer and use
// `secureWebPreferences()` from ./secureWebPreferences. Send IPC.events.quickAddShown on show.
import type { BrowserWindow } from 'electron'
import type { AppContext } from '../context'
import { notImplemented } from '../notImplemented'

/** Called once at startup (after the main window). Return the hidden window. */
export function createQuickAddWindow(_ctx: AppContext): BrowserWindow | null {
  return null
}

export function toggleQuickAdd(_ctx: AppContext): void {}

export async function hideQuickAdd(_ctx: AppContext): Promise<void> {
  throw notImplemented('app.hideQuickAdd')
}

export async function resizeQuickAdd(_ctx: AppContext, _height: number): Promise<void> {
  throw notImplemented('app.resizeQuickAdd')
}
