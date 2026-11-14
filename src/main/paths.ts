import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

/**
 * Env var that relocates the userData directory (database, backups, settings) — a supported
 * "custom data location" (see README). It changes nothing else about how the app behaves.
 */
export const USER_DATA_ENV = 'MARTIN_TODOS_USER_DATA'

/** Env var (`=1`) that turns on e2e test mode; see `isTestRun`. */
export const E2E_ENV = 'MARTIN_TODOS_E2E'

export const isDev = !app.isPackaged

/**
 * Automated e2e runs (`MARTIN_TODOS_E2E=1`, set by e2e/launch.ts). Only then: a fake global
 * shortcut registrar (real hotkeys would hijack keys on the developer's machine and collide
 * between parallel instances), no login-item changes, the `__martinTodosTest` hooks, the
 * `MARTIN_TODOS_HIDE_WINDOW` switch and the startup-dialog stub. Without the flag every launch
 * behaves exactly like production, whatever else is set.
 */
export const isTestRun = process.env[E2E_ENV] === '1'

/**
 * Must run before `app.whenReady()`. Dev builds use `<appData>/<name>-dev` so development
 * never touches real data; `MARTIN_TODOS_USER_DATA` overrides both.
 */
export function configureUserDataDir(): void {
  const override = process.env[USER_DATA_ENV]
  if (override) {
    app.setPath('userData', override)
  } else if (isDev) {
    app.setPath('userData', join(app.getPath('appData'), `${app.getName()}-dev`))
  }
}

export interface AppPaths {
  userData: string
  dataDir: string
  dbFile: string
  backupsDir: string
}

export function getAppPaths(): AppPaths {
  const userData = app.getPath('userData')
  const dataDir = join(userData, 'data')
  return {
    userData,
    dataDir,
    dbFile: join(dataDir, 'todos.db'),
    backupsDir: join(userData, 'backups'),
  }
}

/** Absolute path of a renderer HTML entry, or the dev-server URL for it. */
export function rendererEntry(entry: 'index' | 'quick-add'): { url: string } | { file: string } {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (isDev && devUrl) return { url: `${devUrl}/${entry}.html` }
  return { file: join(__dirname, `../renderer/${entry}.html`) }
}

/** Runtime assets shipped next to the app (tray icons…). */
export function resourcePath(...segments: string[]): string {
  const base = app.isPackaged ? process.resourcesPath : join(__dirname, '../../resources')
  return join(base, ...segments)
}

/**
 * The app's version. `app.getVersion()` falls back to Electron's version when the main
 * script is launched directly (e2e: `electron out/main/index.js`), so unpackaged runs read
 * package.json instead.
 */
export function appVersion(): string {
  if (app.isPackaged) return app.getVersion()
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8')) as {
      version?: unknown
    }
    return typeof pkg.version === 'string' ? pkg.version : app.getVersion()
  } catch {
    return app.getVersion()
  }
}
