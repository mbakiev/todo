// Main-process bootstrap: single-instance lock, DB, IPC, windows, app lifecycle.
import { app, nativeTheme, session, type BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc'
import type { DataChange, Settings, ShortcutStatus } from '@shared/types'
import { broadcast } from './broadcast'
import type { AppContext } from './context'
import { openDatabase } from './db'
import { seedDemoData } from './db/seed'
import { registerIpcHandlers } from './ipc'
import { configureUserDataDir, getAppPaths, isDev } from './paths'
import { applyLaunchAtLogin } from './services/autoLaunch'
import { startAutomaticBackups } from './services/backup'
import { registerGlobalShortcuts, unregisterGlobalShortcuts } from './shortcuts'
import { createTray, destroyTray } from './tray'
import { createMainWindow, getMainWindow, showMainWindow } from './windows/mainWindow'
import { createQuickAddWindow } from './windows/quickAddWindow'

configureUserDataDir()

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  void bootstrap()
}

function seedFlag(): 'seed' | 'reset' | null {
  const arg = process.argv.find((a) => a === '--seed' || a.startsWith('--seed='))
  if (!arg) return null
  return arg === '--seed=reset' ? 'reset' : 'seed'
}

async function bootstrap(): Promise<void> {
  await app.whenReady()

  // Deny every permission request (camera, notifications, …); the app needs none.
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))

  const paths = getAppPaths()
  const repos = openDatabase({ path: paths.dbFile })

  const seed = seedFlag()
  if (seed && isDev) {
    const empty = repos.tasks.list().length === 0
    if (seed === 'reset' || empty) {
      const n = seedDemoData(repos, { reset: seed === 'reset' })
      console.log(`[seed] created ${n} demo tasks in ${paths.dbFile}`)
    } else {
      console.log('[seed] database is not empty; use `npm run seed:reset` to replace it')
    }
  }

  let quickAddWindow: BrowserWindow | null = null
  let lastSettings = repos.settings.get()

  const ctx: AppContext = {
    repos,
    paths,
    isDev,
    quitting: false,
    getMainWindow,
    getQuickAddWindow: () =>
      quickAddWindow && !quickAddWindow.isDestroyed() ? quickAddWindow : null,
    broadcastDataChanged: (change: DataChange) => broadcast(IPC.events.dataChanged, change),
    broadcastSettingsChanged: (settings: Settings) => {
      applySettingsSideEffects(ctx, lastSettings, settings)
      lastSettings = settings
      broadcast(IPC.events.settingsChanged, settings)
    },
    broadcastShortcutStatus: (status: ShortcutStatus) =>
      broadcast(IPC.events.shortcutStatusChanged, status),
  }

  nativeTheme.themeSource = lastSettings.theme
  registerIpcHandlers(ctx)

  createMainWindow(ctx)
  quickAddWindow = createQuickAddWindow(ctx)
  createTray(ctx)
  registerGlobalShortcuts(ctx, lastSettings.shortcuts)
  applyLaunchAtLogin(ctx, lastSettings.launchAtLogin)
  const stopBackups = startAutomaticBackups(ctx)

  app.on('second-instance', () => void showMainWindow(ctx))

  // macOS: clicking the dock icon re-shows the window.
  app.on('activate', () => void showMainWindow(ctx))

  app.on('before-quit', () => {
    ctx.quitting = true
  })

  app.on('window-all-closed', () => {
    // Phase 1: plain window behaviour. The desktop-shell feature replaces this with
    // hide-on-close + tray (spec §9); until then quit on Windows/Linux like a normal app.
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('will-quit', () => {
    stopBackups()
    unregisterGlobalShortcuts()
    destroyTray()
    repos.db.close()
  })
}

function applySettingsSideEffects(ctx: AppContext, prev: Settings, next: Settings): void {
  if (prev.theme !== next.theme) nativeTheme.themeSource = next.theme
  if (
    prev.shortcuts.toggleApp !== next.shortcuts.toggleApp ||
    prev.shortcuts.quickAdd !== next.shortcuts.quickAdd
  ) {
    ctx.broadcastShortcutStatus(registerGlobalShortcuts(ctx, next.shortcuts))
  }
  if (prev.launchAtLogin !== next.launchAtLogin) applyLaunchAtLogin(ctx, next.launchAtLogin)
}
