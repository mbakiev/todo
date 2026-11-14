import { join } from 'node:path'
import { app } from 'electron'

/** Env var that overrides the userData directory (used by e2e tests). */
export const USER_DATA_ENV = 'MARTIN_TODOS_USER_DATA'

export const isDev = !app.isPackaged

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
