// Opens the database at startup and, when that fails (or the file is missing while backups
// exist), asks the user what to do instead of leaving an invisible process behind.
// Decisions and file operations: services/startupRecovery.ts (unit-tested).
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { dialog, shell } from 'electron'
import { openDatabase, type Repos } from './db'
import { isTestRun, type AppPaths } from './paths'
import { listBackups } from './services/backup'
import {
  openDatabaseWithRecoveryFlow,
  STARTUP_CHOICES,
  type StartupChoice,
  type StartupDialogSpec,
} from './services/startupRecovery'

/**
 * e2e only (MARTIN_TODOS_E2E=1): answers the dialog without showing it. A comma-separated
 * list answers successive dialogs in order (the last answer repeats).
 */
const CHOICE_ENV = 'MARTIN_TODOS_STARTUP_DIALOG_CHOICE'
let stubAnswers = 0

async function ask(spec: StartupDialogSpec): Promise<StartupChoice> {
  const answers = isTestRun ? process.env[CHOICE_ENV]?.split(',') : undefined
  const stub = answers ? answers[Math.min(stubAnswers++, answers.length - 1)]?.trim() : undefined
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

/**
 * Shows a folder in the file manager. After Reveal (except for a locked file) the app quits
 * right away. On Windows `shell.openPath` called after a message box returns before Explorer
 * has the request, and quitting then drops it: no window opens. A separate explorer.exe process
 * does not depend on us staying alive. If Explorer cannot be started, `shell.openPath` is
 * still tried (it does work while the app stays up, as it does for a locked file).
 */
async function revealFolder(target: string): Promise<void> {
  if (process.platform !== 'win32') {
    await shell.openPath(target)
    return
  }
  const explorer = join(process.env.SystemRoot ?? 'C:\\Windows', 'explorer.exe')
  const started = await new Promise<boolean>((resolve) => {
    const failed = (err: unknown): void => {
      console.error('Could not start Explorer for the data folder', err)
      resolve(false)
    }
    try {
      const child = spawn(explorer, [target], { detached: true, stdio: 'ignore' })
      child.once('spawn', () => resolve(true))
      child.once('error', failed)
      child.unref()
    } catch (err) {
      failed(err)
    }
  })
  if (!started) await shell.openPath(target)
}

function restoreFailed(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err)
  if (isTestRun) console.error(`[startup-dialog] restore failed: ${message}`)
  else dialog.showErrorBox("Couldn't restore the backup", message)
}

/**
 * Returns the opened repos, or null when the app should quit (the user chose Quit, or a
 * restore failed). Never deletes data. The flow itself: services/startupRecovery.ts.
 */
export async function openDatabaseWithRecovery(paths: AppPaths): Promise<Repos | null> {
  return openDatabaseWithRecoveryFlow({
    dbFile: paths.dbFile,
    backupsDir: paths.backupsDir,
    dataDir: paths.dataDir,
    open: () => openDatabase({ path: paths.dbFile }),
    ask,
    reveal: async () => {
      const target = existsSync(paths.dataDir) ? paths.dataDir : paths.userData
      if (!isTestRun) await revealFolder(target)
    },
    restoreFailed,
    exists: existsSync,
    hasBackups: () => listBackups(paths.backupsDir).length > 0,
  })
}
