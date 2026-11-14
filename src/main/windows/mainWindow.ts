import { app, BrowserWindow, nativeTheme, screen } from 'electron'
import { APP_DISPLAY_NAME } from '@shared/constants'
import { IPC } from '@shared/ipc'
import type { WindowBounds } from '@shared/types'
import type { AppContext } from '../context'
import { isTestRun, resourcePath } from '../paths'
import { installCrashRecovery } from './crashRecovery'
import { hideWindowReturningFocus, prepareToShow } from './hideWindow'
import { loadRenderer } from './loadRenderer'
import { requestRendererFlush } from './rendererFlush'
import { secureWebPreferences } from './secureWebPreferences'

const DEFAULT_WIDTH = 1280
const DEFAULT_HEIGHT = 820

// Matches --background in the renderer theme to avoid a white flash on dark systems.
const BG_LIGHT = '#ffffff'
const BG_DARK = '#09090b'

let mainWindow: BrowserWindow | null = null
/** When the main window last lost focus (see isMainWindowFocused's grace period). */
let lastBlurAt = 0

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

/** Restored bounds, discarded if they are no longer on any connected display. */
function restoredBounds(saved: WindowBounds | null): Partial<Electron.Rectangle> {
  if (!saved) return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT }
  const { x, y, width, height } = saved
  if (x === undefined || y === undefined) return { width, height }
  const visible = screen.getAllDisplays().some((d) => {
    const a = d.workArea
    return x + 100 > a.x && x < a.x + a.width - 100 && y >= a.y - 10 && y < a.y + a.height - 50
  })
  return visible ? { x, y, width, height } : { width, height }
}

function platformChrome(): Electron.BrowserWindowConstructorOptions {
  if (process.platform === 'darwin') {
    // Traffic lights inset over the sidebar; the renderer provides drag regions.
    return { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 18 } }
  }
  // Windows / Linux: standard frame, menu bar hidden (its accelerators still work). Windows
  // gets the full-bleed .ico (the .png keeps macOS-style padding and would look small in
  // the taskbar).
  const icon = process.platform === 'win32' ? 'icon.ico' : 'icon.png'
  return { autoHideMenuBar: true, icon: resourcePath(icon) }
}

export interface CreateMainWindowOptions {
  /** Show once ready (default true). False when launched at login: start in the tray. */
  show?: boolean
}

export function createMainWindow(
  ctx: AppContext,
  { show = true }: CreateMainWindowOptions = {},
): BrowserWindow {
  const settings = ctx.repos.settings.get()
  const win = new BrowserWindow({
    ...restoredBounds(settings.windowBounds),
    minWidth: 760,
    minHeight: 480,
    show: false,
    title: APP_DISPLAY_NAME,
    backgroundColor: nativeTheme.shouldUseDarkColors ? BG_DARK : BG_LIGHT,
    ...platformChrome(),
    webPreferences: secureWebPreferences(),
  })
  mainWindow = win

  if (process.platform !== 'darwin') win.setMenuBarVisibility(false)
  if (settings.windowBounds?.isMaximized) win.maximize()

  win.once('ready-to-show', () => {
    // E2E runs may ask for the window to stay hidden.
    if (show && !(isTestRun && process.env['MARTIN_TODOS_HIDE_WINDOW'] === '1')) win.show()
  })

  // Persist bounds (debounced) on move/resize and once more on close.
  let saveTimer: NodeJS.Timeout | undefined
  const saveBounds = (): void => {
    if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return
    const isMaximized = win.isMaximized()
    // Normal (un-maximized) bounds, so restoring a maximized window un-maximizes sensibly.
    const b = win.getNormalBounds()
    const bounds: WindowBounds = {
      x: Math.round(b.x),
      y: Math.round(b.y),
      width: Math.round(b.width),
      height: Math.round(b.height),
      isMaximized,
    }
    try {
      ctx.repos.settings.set({ windowBounds: bounds })
    } catch (err) {
      console.error('Failed to persist window bounds', err)
    }
  }
  const scheduleSave = (): void => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(saveBounds, 400)
  }
  win.on('blur', () => {
    lastBlurAt = Date.now()
  })
  win.on('resize', scheduleSave)
  win.on('move', scheduleSave)
  win.on('maximize', scheduleSave)
  win.on('unmaximize', scheduleSave)
  win.on('close', (event) => {
    clearTimeout(saveTimer)
    saveBounds()
    // Closing only hides; the app keeps running in the tray. Real quits set ctx.quitting
    // (before-quit, or the Windows session-end events below) and let the close through.
    if (!ctx.quitting) {
      event.preventDefault()
      hideMainWindow(win)
    }
  })
  // Windows shutdown / logoff emits neither before-quit nor will-quit: never block it, save
  // pending edits as soon as it is announced and close the DB before the process is killed.
  win.on('query-session-end', () => ctx.sessionEnding())
  win.on('session-end', () => {
    ctx.sessionEnding()
    ctx.sessionEnded()
  })
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  installCrashRecovery(win, 'main window')
  void loadRenderer(win, 'index')
  return win
}

/**
 * Hides the main window (close button, tray toggle, global shortcut). Gives focus back to
 * the previously used app; a full-screen window leaves full screen first on macOS so it
 * does not leave an empty Space behind.
 */
export function hideMainWindow(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  // Save pending detail-panel edits now rather than when the debounce fires: `blur` and
  // `visibilitychange` are not reliable on hide (an unfocused window gets neither). The
  // window keeps running while hidden, so there is nothing to wait for.
  void requestRendererFlush(win)
  if (process.platform === 'darwin' && win.isFullScreen()) {
    win.once('leave-full-screen', () => hideMainWindow(win))
    win.setFullScreen(false)
    return
  }
  hideWindowReturningFocus(win)
}

/**
 * True when the main window is on screen and has keyboard focus. `graceMs` also accepts a
 * window that lost focus that recently — clicking the Windows tray icon focuses the
 * taskbar before our click handler runs.
 */
export function isMainWindowFocused(graceMs = 0): boolean {
  const win = getMainWindow()
  if (!win || !win.isVisible() || win.isMinimized()) return false
  return win.isFocused() || Date.now() - lastBlurAt < graceMs
}

/**
 * Global "toggle app" shortcut / Windows tray click: shows + focuses the window when it is
 * hidden or in the background, hides it when it is the focused window.
 */
export function toggleMainWindow(ctx: AppContext, { focusGraceMs = 0 } = {}): void {
  const win = getMainWindow()
  if (win && isMainWindowFocused(focusGraceMs)) {
    hideMainWindow(win)
    // macOS: hiding the last window leaves the app active with nothing on screen; hide the
    // app as well so the previously active app gets focus back (Cmd+H semantics).
    if (
      process.platform === 'darwin' &&
      !BrowserWindow.getAllWindows().some((w) => w !== win && w.isVisible())
    ) {
      app.hide()
    }
    return
  }
  void showMainWindow(ctx)
}

/** Shows + focuses the main window (creating it if needed), optionally opening a task. */
export async function showMainWindow(ctx: AppContext, taskId?: string): Promise<void> {
  const win = getMainWindow() ?? createMainWindow(ctx)
  prepareToShow(win)
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  if (taskId) {
    const send = (): void => win.webContents.send(IPC.events.openTask, taskId)
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send)
    else send()
  }
}

export async function openSettingsInMainWindow(ctx: AppContext): Promise<void> {
  await showMainWindow(ctx)
  const win = getMainWindow()
  win?.webContents.send(IPC.events.settingsRequested)
}

export function requestNewTaskInMainWindow(ctx: AppContext): void {
  void showMainWindow(ctx).then(() => {
    getMainWindow()?.webContents.send(IPC.events.newTaskRequested)
  })
}
