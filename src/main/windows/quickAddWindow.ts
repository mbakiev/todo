// Quick-add popup (spec §8): frameless, always-on-top, not in the taskbar / app switcher,
// ~640px wide, upper third of the display under the cursor, created hidden at startup so
// the hotkey shows it instantly. It must not bring up the main window, and dismissing it
// must give focus back to the app the user was in:
//
// - macOS: an NSPanel (`type: 'panel'`, non-activating). Showing it makes it the key
//   window *without activating the app*, so the main window never comes forward and the
//   previously active app is still the active app after the panel hides.
// - Windows: a tool window (`type: 'toolbar'`: no taskbar button, not in Alt+Tab). It is
//   focused on show (the global-hotkey press grants the foreground right) and hidden via
//   hideWindowReturningFocus(), which hands activation back to the previous window.
import { BrowserWindow, nativeTheme, screen } from 'electron'
import { IPC } from '@shared/ipc'
import type { AppContext } from '../context'
import { installCrashRecovery } from './crashRecovery'
import { hideWindowReturningFocus, prepareToShow } from './hideWindow'
import { loadRenderer } from './loadRenderer'
import { quickAddPosition } from './quickAddPosition'
import { secureWebPreferences } from './secureWebPreferences'

export const QUICK_ADD_WIDTH = 640
const INITIAL_HEIGHT = 132

// Matches --popover in the renderer theme (white / zinc-900).
const BG_LIGHT = '#ffffff'
const BG_DARK = '#18181b'

let quickAdd: BrowserWindow | null = null
let ready = false
let showWhenReady = false

function live(): BrowserWindow | null {
  return quickAdd && !quickAdd.isDestroyed() ? quickAdd : null
}

/** The hidden quick-add window, if it exists. */
export function getQuickAddWindow(): BrowserWindow | null {
  return live()
}

function platformOptions(): Electron.BrowserWindowConstructorOptions {
  if (process.platform === 'darwin') return { type: 'panel' }
  if (process.platform === 'win32') return { type: 'toolbar' }
  return {}
}

export function createQuickAddWindow(ctx: AppContext): BrowserWindow | null {
  const win = new BrowserWindow({
    width: QUICK_ADD_WIDTH,
    height: INITIAL_HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    roundedCorners: true,
    title: 'Quick Add',
    backgroundColor: nativeTheme.shouldUseDarkColors ? BG_DARK : BG_LIGHT,
    ...platformOptions(),
    webPreferences: { ...secureWebPreferences(), spellcheck: true },
  })
  quickAdd = win

  if (process.platform === 'darwin') {
    // Float over full-screen apps and follow the user to whichever Space is active.
    // skipTransformProcessType keeps the Dock icon (the default would turn the app into
    // a UI-element process).
    win.setAlwaysOnTop(true, 'floating')
    win.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    })
  }

  const syncBackground = (): void => {
    if (!win.isDestroyed())
      win.setBackgroundColor(nativeTheme.shouldUseDarkColors ? BG_DARK : BG_LIGHT)
  }
  nativeTheme.on('updated', syncBackground)

  // Losing focus hides the popup but keeps the draft (spec §8).
  win.on('blur', () => {
    if (win.isVisible() && !win.webContents.isDevToolsOpened()) win.hide()
  })

  // macOS: a non-activating panel is not served by the app menu's Edit roles reliably, so
  // route the standard editing shortcuts directly (and swallow them so nothing doubles).
  if (process.platform === 'darwin') {
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || !input.meta || input.control || input.alt) return
      const wc = win.webContents
      const k = input.key.toLowerCase()
      const actions: Record<string, () => void> = {
        c: () => wc.copy(),
        x: () => wc.cut(),
        v: () => wc.paste(),
        a: () => wc.selectAll(),
        z: () => (input.shift ? wc.redo() : wc.undo()),
      }
      const action = actions[k]
      if (action) {
        event.preventDefault()
        action()
      }
    })
  }

  // `on`, not `once`: after a renderer crash the window reloads and becomes ready again.
  win.webContents.on('did-finish-load', () => {
    if (quickAdd !== win) return
    ready = true
    if (showWhenReady) {
      showWhenReady = false
      showQuickAdd(ctx)
    }
  })
  win.webContents.on('render-process-gone', () => {
    if (quickAdd === win) ready = false
  })
  win.on('closed', () => {
    nativeTheme.off('updated', syncBackground)
    if (quickAdd === win) {
      quickAdd = null
      ready = false
      // Destroyed outside a real quit (crash, OS, a stray destroy()): recreate it hidden so the
      // hotkey keeps working instantly.
      if (!ctx.quitting) setImmediate(() => !ctx.quitting && !live() && createQuickAddWindow(ctx))
    }
  })
  // Never closed by the user; if something closes it outside a real quit, recreate lazily.
  win.on('close', (event) => {
    if (!ctx.quitting) {
      event.preventDefault()
      win.hide()
    }
  })

  installCrashRecovery(win, 'quick add')
  void loadRenderer(win, 'quick-add')
  return win
}

/** Moves the popup onto the display under the cursor and shows + focuses it. */
export function showQuickAdd(ctx: AppContext): void {
  const win = live() ?? createQuickAddWindow(ctx)
  if (!win) return
  if (!ready) {
    showWhenReady = true
    return
  }
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const [width = QUICK_ADD_WIDTH, height = INITIAL_HEIGHT] = win.getSize()
  const { x, y } = quickAddPosition(display.workArea, { width, height })
  win.setBounds({ x, y, width, height })
  // Windows: moving between monitors with different DPI can scale the size; re-apply it.
  if (process.platform === 'win32') win.setSize(width, height)
  prepareToShow(win)
  win.show()
  win.focus()
  win.webContents.focus()
  win.webContents.send(IPC.events.quickAddShown)
}

/** Global shortcut: show, or hide when the popup already has focus. */
export function toggleQuickAdd(ctx: AppContext): void {
  const win = live()
  if (win && win.isVisible() && win.isFocused()) {
    hideWindowReturningFocus(win)
    return
  }
  showQuickAdd(ctx)
}

export async function hideQuickAdd(_ctx: AppContext): Promise<void> {
  const win = live()
  if (win) hideWindowReturningFocus(win)
}

/** Height follows the renderer's content (CSS px), clamped to the current display. */
export async function resizeQuickAdd(_ctx: AppContext, height: number): Promise<void> {
  const win = live()
  if (!win) return
  const bounds = win.getBounds()
  const display = screen.getDisplayMatching(bounds)
  const maxHeight = display.workArea.y + display.workArea.height - bounds.y - 16
  const next = Math.max(60, Math.min(Math.round(height), maxHeight))
  if (next !== bounds.height) win.setBounds({ ...bounds, height: next })
}
