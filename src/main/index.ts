// Main-process bootstrap: single-instance lock, DB, IPC, windows, tray, menu, lifecycle.
//
// Lifecycle (spec §9): closing the main window only hides it — the app lives on in the
// tray (and the Dock on macOS). A real quit comes from tray Quit, the app menu / Cmd+Q, or
// OS shutdown / logout; `before-quit` (and the Windows session-end events in
// mainWindow.ts) set `ctx.quitting` so windows are then allowed to close.
import { app, dialog, nativeTheme, powerMonitor, session } from 'electron'
import { z } from 'zod'
import { APP_DISPLAY_NAME } from '@shared/constants'
import { IPC } from '@shared/ipc'
import { taskCreateInputSchema } from '@shared/schemas'
import type { DataChange, Settings, ShortcutStatus } from '@shared/types'
import { broadcast } from './broadcast'
import type { AppContext } from './context'
import { seedDemoData } from './db/seed'
import { registerIpcHandlers } from './ipc'
import { installAppMenu } from './menu'
import { configureUserDataDir, getAppPaths, isDev, isTestRun } from './paths'
import { applyLaunchAtLogin, wasLaunchedAtLogin } from './services/autoLaunch'
import { startAutomaticBackups } from './services/backup'
import { createQuitGate } from './quitGate'
import { testFaults } from './testFaults'
import { openDatabaseWithRecovery } from './startup'
import { installTestHook, registerGlobalShortcuts, unregisterGlobalShortcuts } from './shortcuts'
import { createTray, destroyTray } from './tray'
import { createMainWindow, getMainWindow, showMainWindow } from './windows/mainWindow'
import {
  createQuickAddWindow,
  getQuickAddWindow,
  hideQuickAdd,
  showQuickAdd,
} from './windows/quickAddWindow'
import { requestRendererFlush } from './windows/rendererFlush'

configureUserDataDir()

// Windows: must match the AUMID the NSIS installer stamps on its shortcuts (electron-builder
// `appId`), or the running window and the pinned/Start-menu shortcut group separately.
if (process.platform === 'win32') app.setAppUserModelId('com.martin.todos')

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  bootstrap().catch((err: unknown) => {
    // Never linger as an invisible process holding the single-instance lock.
    console.error('Startup failed', err)
    const message = err instanceof Error ? err.message : String(err)
    if (app.isReady()) dialog.showErrorBox(`${APP_DISPLAY_NAME} couldn't start`, message)
    app.exit(1)
  })
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
  // A database that cannot be opened (damaged, locked, from a newer version) or that is
  // missing while backups exist is explained in a dialog; see startup.ts.
  const repos = await openDatabaseWithRecovery(paths)
  if (!repos) {
    app.quit()
    return
  }

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

  let lastSettings = repos.settings.get()

  // Every quit is held until the main window has saved pending edits (bounded by a timeout),
  // and the DB closes only after that — also when quit is requested again meanwhile.
  let stopBackups = (): void => {}
  const quitGate = createQuitGate({
    flush: () => requestRendererFlush(getMainWindow()),
    quit: () => app.quit(),
    finalize: () => {
      stopBackups()
      unregisterGlobalShortcuts()
      destroyTray()
      repos.db.close()
    },
  })
  const ctx: AppContext = {
    repos,
    paths,
    isDev,
    quitting: false,
    getMainWindow,
    getQuickAddWindow,
    broadcastDataChanged: (change: DataChange) => broadcast(IPC.events.dataChanged, change),
    broadcastSettingsChanged: (settings: Settings) => {
      applySettingsSideEffects(ctx, lastSettings, settings)
      lastSettings = settings
      broadcast(IPC.events.settingsChanged, settings)
    },
    broadcastShortcutStatus: (status: ShortcutStatus) =>
      broadcast(IPC.events.shortcutStatusChanged, status),
    sessionEnding: () => {
      ctx.quitting = true
      quitGate.sessionEnding()
    },
    sessionEnded: () => quitGate.finalize(),
  }

  app.on('before-quit', (event) => {
    // Quitting must never be blocked by the hide-on-close handlers.
    ctx.quitting = true
    if (quitGate.beforeQuit()) event.preventDefault()
  })
  app.on('will-quit', () => quitGate.finalize())
  // `kill` / Ctrl+C / a service manager: quit through the same gate.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => app.quit())
  powerMonitor.on('shutdown', () => {
    ctx.quitting = true
  })

  nativeTheme.themeSource = lastSettings.theme
  registerIpcHandlers(ctx)
  installAppMenu(ctx)

  // Launched by the OS at login → start quietly in the tray.
  createMainWindow(ctx, { show: !wasLaunchedAtLogin() })
  createQuickAddWindow(ctx)
  createTray(ctx)
  registerGlobalShortcuts(ctx, lastSettings.shortcuts)
  applyLaunchAtLogin(ctx, lastSettings.launchAtLogin)
  stopBackups = startAutomaticBackups(ctx)

  if (isTestRun) {
    installTestHook({
      showQuickAdd: () => showQuickAdd(ctx),
      hideQuickAdd: () => hideQuickAdd(ctx),
      isQuitting: () => ctx.quitting,
      // Make tasks.update fail (true) or work again (false).
      failTaskUpdates: (on: unknown) => {
        testFaults.failTaskUpdates = on === true
      },
      // Fast bulk inserts for e2e (e.g. the 5,000-row list test); validated like IPC input.
      bulkCreateTasks: (inputs: unknown) => {
        const parsed = z.array(taskCreateInputSchema).parse(inputs)
        return repos.db.transaction(() => parsed.map((i) => repos.tasks.create(i).task.id)).length
      },
    })
  }

  // A second launch (e.g. from the Start menu / Finder) focuses the running instance.
  app.on('second-instance', () => void showMainWindow(ctx))

  // macOS: clicking the Dock icon re-shows the window.
  app.on('activate', () => void showMainWindow(ctx))

  // The app keeps running in the tray when every window is hidden/closed.
  app.on('window-all-closed', () => {})
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
