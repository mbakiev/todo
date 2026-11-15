import type { BrowserWindow } from 'electron'

/**
 * Hides a window so that keyboard focus goes back to whatever the user was using before.
 *
 * - macOS: a plain `hide()`. The quick-add window is a non-activating panel, so the app
 *   never became active and the previous app simply keeps focus. For the main window the
 *   caller decides whether to also `app.hide()` (see mainWindow.ts).
 * - Windows: Chromium hides windows with `SWP_NOACTIVATE`, which leaves *no* window
 *   focused (keystrokes go nowhere). Minimizing first makes Windows itself activate the
 *   next window in its activation order — the app the user came from. The window is made
 *   fully transparent for that moment so the minimize animation is not visible, and
 *   `prepareToShow` restores it before the next show.
 */
export function hideWindowReturningFocus(win: BrowserWindow): void {
  if (win.isDestroyed() || !win.isVisible()) return
  if (process.platform === 'win32' && win.isFocused()) {
    win.setOpacity(0)
    win.minimize()
    win.hide()
    win.setOpacity(1)
    return
  }
  win.hide()
}

/**
 * Undoes the Windows minimize trick above; call before showing. `place` (re)positions the
 * window: bounds set while it is still minimized are lost (`restore()` puts it back where it
 * was), and `restore()` already makes it visible, so it runs after the restore but while the
 * window is still transparent.
 */
export function prepareToShow(win: BrowserWindow, place?: () => void): void {
  const restoring = process.platform === 'win32' && win.isMinimized()
  if (restoring) {
    win.setOpacity(0)
    win.restore()
  }
  place?.()
  if (restoring) win.setOpacity(1)
}
