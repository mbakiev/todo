// "Launch at login" (spec §9), packaged builds only. When the OS starts us at login we
// start hidden in the tray instead of showing the main window.
//
// - macOS: a login item via app.setLoginItemSettings (SMAppService on macOS 13+). A login
//   launch is detected with `wasOpenedAtLogin`.
// - Windows: a `HKCU\...\Run` entry pointing at the installed exe with a `--hidden`
//   argument; a login launch is detected by that argument (the usual Windows convention,
//   since the OS gives no other signal).
import { app } from 'electron'
import type { AppContext } from '../context'
import { isTestRun } from '../paths'

export const HIDDEN_ARG = '--hidden'

/** Login items only make sense for an installed app; never touched by dev or test runs. */
export function canManageLoginItem(): boolean {
  return (
    app.isPackaged && !isTestRun && (process.platform === 'darwin' || process.platform === 'win32')
  )
}

function loginItemOptions(): Electron.LoginItemSettingsOptions {
  return process.platform === 'win32' ? { path: process.execPath, args: [HIDDEN_ARG] } : {}
}

/** Called at startup and whenever `settings.launchAtLogin` changes. */
export function applyLaunchAtLogin(_ctx: AppContext, enabled: boolean): void {
  if (!canManageLoginItem()) return
  try {
    const current = app.getLoginItemSettings(loginItemOptions()).openAtLogin
    if (current === enabled) return
    app.setLoginItemSettings({ openAtLogin: enabled, ...loginItemOptions() })
  } catch (err) {
    console.error('Failed to update the login item', err)
  }
}

/** True when this process was started by the OS at login (→ start hidden in the tray). */
export function wasLaunchedAtLogin(): boolean {
  if (process.argv.includes(HIDDEN_ARG)) return true
  if (process.platform === 'darwin' && app.isPackaged) {
    try {
      return app.getLoginItemSettings().wasOpenedAtLogin
    } catch {
      return false
    }
  }
  return false
}
