// What to do when the database cannot be opened at startup (or is missing while backups
// exist). Pure decisions + file operations, free of Electron so they are unit-tested; the
// dialog and app lifecycle glue lives in main/startup.ts.
//
// Never deletes anything: a database that cannot be opened is moved aside as
// `todos.db.broken-<timestamp>` (with its -wal / -shm files) before a backup is copied in.
import { copyFileSync, existsSync, mkdirSync, renameSync } from 'node:fs'
import { dirname } from 'node:path'
import { APP_DISPLAY_NAME } from '@shared/constants'
import { SchemaTooNewError } from '../db'
import { listBackups, type BackupFile } from './backup'

/** Why opening failed, in the terms we explain to the user. */
export type OpenFailureCause = 'newer_version' | 'locked' | 'corrupt'

export type StartupProblem =
  { kind: 'open_failed'; cause: OpenFailureCause; error: string } | { kind: 'missing_db' }

export type StartupChoice = 'reveal' | 'restore' | 'fresh' | 'quit'

export interface StartupDialogSpec {
  type: 'error' | 'warning' | 'question'
  title: string
  message: string
  detail: string
  /** In display order. */
  buttons: { id: StartupChoice; label: string }[]
  /** Index of the default (Enter) button. */
  defaultId: number
  /** Index used when the dialog is dismissed (Esc / close). */
  cancelId: number
}

export const STARTUP_CHOICES: readonly StartupChoice[] = ['reveal', 'restore', 'fresh', 'quit']

const SQLITE_BUSY = 5
const SQLITE_LOCKED = 6

/** Maps an error thrown while opening / migrating the DB to a user-facing cause. */
export function classifyOpenError(err: unknown): OpenFailureCause {
  if (err instanceof SchemaTooNewError) return 'newer_version'
  const errcode = (err as { errcode?: unknown } | null)?.errcode
  const message = err instanceof Error ? err.message : String(err)
  if (
    errcode === SQLITE_BUSY ||
    errcode === SQLITE_LOCKED ||
    /database (table )?is locked|SQLITE_BUSY|EBUSY/i.test(message)
  ) {
    return 'locked'
  }
  // Not a database, malformed, unreadable (EACCES / CANTOPEN), …: all "corrupt or unreadable".
  return 'corrupt'
}

function formatWhen(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/** The dialog to show for a startup problem. `backup` is the newest usable backup, if any. */
export function startupDialogSpec(
  problem: StartupProblem,
  backup: { createdAt: number } | null,
  dataDir: string,
): StartupDialogSpec {
  const restore = backup
    ? [{ id: 'restore' as const, label: 'Restore latest backup' }]
    : ([] as { id: StartupChoice; label: string }[])
  const backupLine = backup ? `The newest backup is from ${formatWhen(backup.createdAt)}.` : ''

  if (problem.kind === 'missing_db') {
    const buttons: StartupDialogSpec['buttons'] = [
      ...restore,
      { id: 'fresh', label: 'Start fresh' },
      { id: 'quit', label: 'Quit' },
    ]
    return {
      type: 'question',
      title: APP_DISPLAY_NAME,
      message: `Your ${APP_DISPLAY_NAME} data file is missing, but backups exist.`,
      detail: [
        `No database was found in ${dataDir}. You can restore the newest backup, or start with an empty task list (the backups stay where they are).`,
        backupLine,
      ]
        .filter(Boolean)
        .join('\n\n'),
      buttons,
      defaultId: 0,
      cancelId: buttons.length - 1,
    }
  }

  const reveal = { id: 'reveal' as const, label: 'Reveal data folder' }
  const quit = { id: 'quit' as const, label: 'Quit' }
  const technical = `Technical details: ${problem.error}`

  if (problem.cause === 'newer_version') {
    // Restoring an older backup would silently drop whatever the newer version wrote.
    const buttons = [reveal, quit]
    return {
      type: 'error',
      title: APP_DISPLAY_NAME,
      message: `This data was created by a newer version of ${APP_DISPLAY_NAME}.`,
      detail: [
        `Install the latest version of ${APP_DISPLAY_NAME} to open it. Your data has not been changed.`,
        technical,
      ].join('\n\n'),
      buttons,
      defaultId: buttons.length - 1,
      cancelId: buttons.length - 1,
    }
  }

  const buttons = [reveal, ...restore, quit]
  if (problem.cause === 'locked') {
    return {
      type: 'error',
      title: APP_DISPLAY_NAME,
      message: `${APP_DISPLAY_NAME} can't open your data because another program is using the file.`,
      detail: [
        'Close any other copy of the app or any program that has the data file open (for example a backup or sync tool), then start the app again.',
        backup
          ? `Restoring the latest backup sets the locked file aside and starts from the backup instead. ${backupLine}`
          : '',
        technical,
      ]
        .filter(Boolean)
        .join('\n\n'),
      buttons,
      defaultId: buttons.length - 1,
      cancelId: buttons.length - 1,
    }
  }
  return {
    type: 'error',
    title: APP_DISPLAY_NAME,
    message: `${APP_DISPLAY_NAME} can't read your data file. It may be damaged.`,
    detail: [
      backup
        ? `You can restore the latest backup. The damaged file is kept next to it (renamed to "todos.db.broken-…"), never deleted. ${backupLine}`
        : `No backup is available. The file has not been changed; you can reveal the data folder to look at it.`,
      technical,
    ].join('\n\n'),
    buttons,
    defaultId: backup ? buttons.findIndex((b) => b.id === 'restore') : buttons.length - 1,
    cancelId: buttons.length - 1,
  }
}

/** Newest backup (any kind) not in `exclude` — e.g. one that already failed to open. */
export function newestBackup(
  backupsDir: string,
  exclude: ReadonlySet<string> = new Set(),
): BackupFile | null {
  return listBackups(backupsDir).find((b) => !exclude.has(b.path)) ?? null
}

const pad = (n: number): string => String(n).padStart(2, '0')

function stamp(at: Date): string {
  return (
    `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-` +
    `${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`
  )
}

export interface RestoreResult {
  restoredFrom: string
  /** Where the old database (and its -wal / -shm) now live. Empty if there was none. */
  movedAside: string[]
}

/**
 * Moves `dbFile` (+ `-wal`, `-shm`) aside as `<dbFile>.broken-<timestamp>[-wal|-shm]` and
 * copies `backupPath` into its place. The broken files keep SQLite's naming, so the set can
 * still be opened by a recovery tool.
 */
export function restoreBackup(
  dbFile: string,
  backupPath: string,
  now: number = Date.now(),
): RestoreResult {
  if (!existsSync(backupPath)) throw new Error(`Backup not found: ${backupPath}`)
  let base = `${dbFile}.broken-${stamp(new Date(now))}`
  for (let i = 1; existsSync(base); i++) base = `${dbFile}.broken-${stamp(new Date(now))}-${i}`
  const movedAside: string[] = []
  // Main file first: if it cannot be moved (locked), nothing else has changed yet.
  for (const suffix of ['', '-wal', '-shm']) {
    const from = `${dbFile}${suffix}`
    if (!existsSync(from)) continue
    const to = `${base}${suffix}`
    renameSync(from, to)
    movedAside.push(to)
  }
  mkdirSync(dirname(dbFile), { recursive: true })
  copyFileSync(backupPath, dbFile)
  return { restoredFrom: backupPath, movedAside }
}
