import { BrowserWindow, nativeTheme, screen } from 'electron'
import { APP_DISPLAY_NAME } from '@shared/constants'
import { IPC } from '@shared/ipc'
import type { WindowBounds } from '@shared/types'
import type { AppContext } from '../context'
import { loadRenderer } from './loadRenderer'
import { secureWebPreferences } from './secureWebPreferences'

const DEFAULT_WIDTH = 1280
const DEFAULT_HEIGHT = 820

// Matches --background in the renderer theme to avoid a white flash on dark systems.
const BG_LIGHT = '#ffffff'
const BG_DARK = '#09090b'

let mainWindow: BrowserWindow | null = null

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
  // Windows / Linux: standard frame, menu bar hidden.
  return { autoHideMenuBar: true }
}

export function createMainWindow(ctx: AppContext): BrowserWindow {
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
    if (process.env['MARTIN_TODOS_HIDE_WINDOW'] !== '1') win.show()
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
  win.on('resize', scheduleSave)
  win.on('move', scheduleSave)
  win.on('maximize', scheduleSave)
  win.on('unmaximize', scheduleSave)
  win.on('close', () => {
    clearTimeout(saveTimer)
    saveBounds()
  })
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  void loadRenderer(win, 'index')
  return win
}

/** Shows + focuses the main window (creating it if needed), optionally opening a task. */
export async function showMainWindow(ctx: AppContext, taskId?: string): Promise<void> {
  const win = getMainWindow() ?? createMainWindow(ctx)
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
