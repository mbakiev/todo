// What to do when the database cannot be opened at startup (or is missing while backups
// exist). Pure decisions + file operations, free of Electron so they are unit-tested; the
// dialog and app lifecycle glue lives in main/startup.ts.
//
// Never deletes anything: a database that cannot be opened is moved aside as
// `todos.db.broken-<timestamp>` (with its -wal / -shm files) before a backup is copied in.
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, renameSync } from 'node:fs'
import { dirname } from 'node:path'
import { APP_DISPLAY_NAME } from '@shared/constants'
import { SchemaTooNewError } from '../db'
import { listBackups, type BackupFile } from './backup'

/** Why opening failed, in the terms we explain to the user. */
export type OpenFailureCause = 'newer_version' | 'locked' | 'corrupt'

export type StartupProblem =
  | {
      kind: 'open_failed'
      cause: OpenFailureCause
      error: string
      /** A plain sentence shown first (e.g. why the previous restore attempt failed). */
      notice?: string
    }
  | { kind: 'missing_db' }

export type StartupChoice = 'retry' | 'reveal' | 'restore' | 'fresh' | 'quit'

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

export const STARTUP_CHOICES: readonly StartupChoice[] = [
  'retry',
  'reveal',
  'restore',
  'fresh',
  'quit',
]

const SQLITE_BUSY = 5
const SQLITE_LOCKED = 6
const SQLITE_CANTOPEN = 14

/**
 * Windows: a program that opened the data file without sharing it (a backup or sync tool,
 * antivirus, an editor) makes SQLite fail with a generic SQLITE_CANTOPEN ("unable to open
 * database file"), which on its own reads as damaged. Opening the file ourselves tells the
 * two apart: the sharing violation surfaces as EBUSY. The same goes for its -wal / -shm files,
 * which SQLite opens along with it. Returns that EBUSY error (so it is classified as
 * 'locked'), otherwise `err` unchanged.
 */
export function explainOpenError(err: unknown, dbFile: string): unknown {
  if ((err as { errcode?: unknown } | null)?.errcode !== SQLITE_CANTOPEN) return err
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      closeSync(openSync(`${dbFile}${suffix}`, 'r+'))
    } catch (probe) {
      if ((probe as NodeJS.ErrnoException | null)?.code === 'EBUSY') return probe
    }
  }
  return err
}

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
  const notice = problem.notice ?? ''

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

  if (problem.cause === 'locked') {
    // No restore: a locked file cannot be moved aside (on Windows not at all), and the data in
    // it is fine — it only needs the other program to let go.
    const buttons = [{ id: 'retry' as const, label: 'Try again' }, reveal, quit]
    return {
      type: 'error',
      title: APP_DISPLAY_NAME,
      message: `${APP_DISPLAY_NAME} can't open your data because another program is using the file.`,
      detail: [
        notice,
        'Close any other copy of the app or any program that has the data file open (for example a backup or sync tool), then choose Try again. Your data has not been changed.',
        technical,
      ]
        .filter(Boolean)
        .join('\n\n'),
      buttons,
      defaultId: 0,
      cancelId: buttons.length - 1,
    }
  }
  const buttons = [reveal, ...restore, quit]
  return {
    type: 'error',
    title: APP_DISPLAY_NAME,
    message: `${APP_DISPLAY_NAME} can't read your data file. It may be damaged.`,
    detail: [
      notice,
      backup
        ? `You can restore the latest backup. The damaged file is kept next to it (renamed to "todos.db.broken-…"), never deleted. ${backupLine}`
        : `No backup is available. The file has not been changed; you can reveal the data folder to look at it.`,
      technical,
    ]
      .filter(Boolean)
      .join('\n\n'),
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

/** Thrown by `restoreBackup` when the bad database could not be moved aside (nothing changed). */
export class MoveAsideError extends Error {
  constructor(readonly reason: unknown) {
    super(
      "The damaged data file couldn't be moved aside (another program may be using it), so the backup was not restored. Nothing has been changed.",
    )
    this.name = 'MoveAsideError'
  }
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
  const moved: Array<{ from: string; to: string }> = []
  // Main file first. If any file cannot be moved, the ones already moved are put back, so a
  // failure leaves everything exactly as it was.
  try {
    for (const suffix of ['', '-wal', '-shm']) {
      const from = `${dbFile}${suffix}`
      if (!existsSync(from)) continue
      const to = `${base}${suffix}`
      renameSync(from, to)
      moved.push({ from, to })
    }
  } catch (err) {
    for (const m of moved.reverse()) {
      try {
        renameSync(m.to, m.from)
      } catch (undoErr) {
        console.error('Could not put a moved database file back', m, undoErr)
      }
    }
    throw new MoveAsideError(err)
  }
  const movedAside = moved.map((m) => m.to)
  mkdirSync(dirname(dbFile), { recursive: true })
  copyFileSync(backupPath, dbFile)
  return { restoredFrom: backupPath, movedAside }
}

export interface RecoveryDeps<T> {
  dbFile: string
  backupsDir: string
  dataDir: string
  /** Opens (and migrates) the database; throws when it cannot. */
  open(): T
  ask(spec: StartupDialogSpec): Promise<StartupChoice>
  reveal(): Promise<void>
  /** A restore failed for a reason other than moving the file aside: tell the user. */
  restoreFailed(err: unknown): void
  exists(path: string): boolean
  hasBackups(): boolean
}

/**
 * Opens the database, asking the user when that fails (or the file is missing while backups
 * exist). Returns null when the app should quit. Never deletes data.
 *
 * - Locked by another program: Try again (as often as needed) / Reveal data folder (then
 *   asks again) / Quit. No restore.
 * - Damaged: Reveal / Restore latest backup / Quit. If the damaged file cannot be moved
 *   aside, the dialog comes back saying so; nothing has changed.
 * - Newer version: Reveal / Quit.
 */
export async function openDatabaseWithRecoveryFlow<T>(deps: RecoveryDeps<T>): Promise<T | null> {
  const tried = new Set<string>()

  if (!deps.exists(deps.dbFile) && deps.hasBackups()) {
    const backup = newestBackup(deps.backupsDir)
    const choice = await deps.ask(startupDialogSpec({ kind: 'missing_db' }, backup, deps.dataDir))
    if (choice === 'quit') return null
    if (choice === 'restore' && backup) {
      try {
        restoreBackup(deps.dbFile, backup.path)
        tried.add(backup.path)
      } catch (err) {
        deps.restoreFailed(err)
        return null
      }
    }
    // 'fresh': fall through and create an empty database.
  }

  let notice: string | undefined
  for (;;) {
    let err: unknown
    try {
      return deps.open()
    } catch (e) {
      err = explainOpenError(e, deps.dbFile)
    }
    console.error('Could not open the database', err)
    const cause = classifyOpenError(err)
    const backup = cause === 'corrupt' ? newestBackup(deps.backupsDir, tried) : null
    const error = err instanceof Error ? err.message : String(err)
    const problem = { kind: 'open_failed' as const, cause, error, notice }
    notice = undefined
    const choice = await deps.ask(startupDialogSpec(problem, backup, deps.dataDir))
    if (choice === 'retry') continue
    if (choice === 'restore' && backup) {
      try {
        restoreBackup(deps.dbFile, backup.path)
        tried.add(backup.path)
      } catch (restoreErr) {
        if (restoreErr instanceof MoveAsideError) {
          console.error('Could not move the damaged database aside', restoreErr.reason)
          notice = restoreErr.message
          continue // nothing changed: the same dialog again, saying why
        }
        // The file was moved aside but the copy failed: opening now would silently start an
        // empty database, so stop (as before) after telling the user.
        deps.restoreFailed(restoreErr)
        return null
      }
      continue // open the restored copy
    }
    if (choice === 'reveal') {
      await deps.reveal()
      if (cause === 'locked') continue // let them close the other program, then Try again
    }
    return null
  }
}
