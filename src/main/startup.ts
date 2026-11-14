// Opens the database at startup and, when that fails (or the file is missing while backups
// exist), asks the user what to do instead of leaving an invisible process behind.
// Decisions and file operations: services/startupRecovery.ts (unit-tested).
import { existsSync } from 'node:fs'
import { dialog, shell } from 'electron'
import { openDatabase, type Repos } from './db'
import { isTestRun, type AppPaths } from './paths'
import { listBackups } from './services/backup'
import {
  classifyOpenError,
  newestBackup,
  restoreBackup,
  STARTUP_CHOICES,
  startupDialogSpec,
  type StartupChoice,
  type StartupDialogSpec,
} from './services/startupRecovery'

/** e2e only (MARTIN_TODOS_E2E=1): answers the dialog without showing it. */
const CHOICE_ENV = 'MARTIN_TODOS_STARTUP_DIALOG_CHOICE'

async function ask(spec: StartupDialogSpec): Promise<StartupChoice> {
  const stub = isTestRun ? process.env[CHOICE_ENV] : undefined
  if (stub !== undefined) {
    // Logged so e2e tests can assert which dialog was offered.
    console.log(`[startup-dialog] ${JSON.stringify(spec)} -> ${stub}`)
    const choice = STARTUP_CHOICES.find((c) => c === stub)
    return choice && spec.buttons.some((b) => b.id === choice) ? choice : 'quit'
  }
  // Called as `dialog.showMessageBox` (not destructured) so it can be stubbed.
  const { response } = await dialog.showMessageBox({
    type: spec.type,
    title: spec.title,
    message: spec.message,
    detail: spec.detail,
    buttons: spec.buttons.map((b) => b.label),
    defaultId: spec.defaultId,
    cancelId: spec.cancelId,
    noLink: true,
  })
  return spec.buttons[response]?.id ?? 'quit'
}

function restoreFailed(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err)
  if (isTestRun) console.error(`[startup-dialog] restore failed: ${message}`)
  else dialog.showErrorBox("Couldn't restore the backup", message)
}

/**
 * Returns the opened repos, or null when the app should quit (the user chose Quit / Reveal,
 * or a restore failed). Never deletes data.
 */
export async function openDatabaseWithRecovery(paths: AppPaths): Promise<Repos | null> {
  const tried = new Set<string>()

  if (!existsSync(paths.dbFile) && listBackups(paths.backupsDir).length > 0) {
    const backup = newestBackup(paths.backupsDir)
    const choice = await ask(startupDialogSpec({ kind: 'missing_db' }, backup, paths.dataDir))
    if (choice === 'quit') return null
    if (choice === 'restore' && backup) {
      try {
        restoreBackup(paths.dbFile, backup.path)
        tried.add(backup.path)
      } catch (err) {
        restoreFailed(err)
        return null
      }
    }
    // 'fresh': fall through and create an empty database.
  }

  for (;;) {
    try {
      return openDatabase({ path: paths.dbFile })
    } catch (err) {
      console.error('Could not open the database', err)
      const cause = classifyOpenError(err)
      const backup = cause === 'newer_version' ? null : newestBackup(paths.backupsDir, tried)
      const error = err instanceof Error ? err.message : String(err)
      const choice = await ask(
        startupDialogSpec({ kind: 'open_failed', cause, error }, backup, paths.dataDir),
      )
      if (choice === 'restore' && backup) {
        try {
          restoreBackup(paths.dbFile, backup.path)
          tried.add(backup.path)
          continue // try again with the restored copy
        } catch (restoreErr) {
          restoreFailed(restoreErr)
          return null
        }
      }
      if (choice === 'reveal') {
        const target = existsSync(paths.dataDir) ? paths.dataDir : paths.userData
        if (!isTestRun) await shell.openPath(target)
      }
      return null
    }
  }
}
