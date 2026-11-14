// DB snapshots in `<userData>/backups/` (spec §9), via VACUUM INTO (consistent in WAL).
//
// Retention is per kind, and the kind is encoded in the file name so older
// `todos-YYYYMMDD-HHmmss.db` files stay valid automatic backups:
//   automatic (startup + every 24 h)   todos-YYYYMMDD-HHmmss.db            newest 14
//   manual ("Back up now")             todos-manual-YYYYMMDD-HHmmss.db     newest 10
//   safety copy before an import       todos-preimport-YYYYMMDD-HHmmss.db  newest 5
// so neither a burst of manual backups nor repeated imports can rotate out the daily
// history. An automatic snapshot is never taken of a database with no tasks at all: after
// an accidental wipe, the daily snapshots would otherwise replace good history with empty
// copies.
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { BACKUP_INTERVAL_MS, BACKUP_KEEP } from '@shared/constants'
import type { BackupInfo } from '@shared/types'
import type { AppContext } from '../context'
import type { Db, Repos } from '../db'

export type BackupKind = keyof typeof BACKUP_KEEP

/** Skip the startup snapshot when one is this fresh (avoids churn while developing). */
export const STARTUP_SKIP_WINDOW_MS = 60 * 60 * 1000
/** How often the running app checks whether the 24 h snapshot is due (survives sleep). */
const CHECK_EVERY_MS = 60 * 60 * 1000
const STARTUP_DELAY_MS = 3000

const NAME_RE =
  /^todos-(?:(manual|preimport)-)?(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(?:-(\d+))?\.db$/

const pad = (n: number, w = 2): string => String(n).padStart(w, '0')

/** `todos-[kind-]YYYYMMDD-HHmmss.db` in local time (no prefix for automatic backups). */
export function backupFileName(at: Date, kind: BackupKind = 'auto'): string {
  const d = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}`
  const t = `${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`
  return `todos-${kind === 'auto' ? '' : `${kind}-`}${d}-${t}.db`
}

/** Kind + local timestamp encoded in a backup file name, or null if it is not one of ours. */
export function parseBackupName(name: string): { kind: BackupKind; createdAt: number } | null {
  const m = NAME_RE.exec(name)
  if (!m) return null
  const kind = (m[1] ?? 'auto') as BackupKind
  const [y, mo, d, h, mi, s] = m.slice(2, 8).map(Number) as number[]
  const createdAt = new Date(y ?? 0, (mo ?? 1) - 1, d ?? 1, h ?? 0, mi ?? 0, s ?? 0).getTime()
  return { kind, createdAt }
}

/** Local timestamp encoded in a backup file name, or null if it is not one of ours. */
export function parseBackupTime(name: string): number | null {
  return parseBackupName(name)?.createdAt ?? null
}

export interface BackupFile {
  name: string
  path: string
  kind: BackupKind
  createdAt: number
}

/** Our backup files (of one kind, or all kinds), newest first. */
export function listBackups(dir: string, kind?: BackupKind): BackupFile[] {
  if (!existsSync(dir)) return []
  const files: BackupFile[] = []
  for (const name of readdirSync(dir)) {
    const parsed = parseBackupName(name)
    if (parsed && (kind === undefined || parsed.kind === kind)) {
      files.push({ name, path: join(dir, name), ...parsed })
    }
  }
  // Same-second duplicates carry a -N suffix; sort by time, then suffix.
  return files.sort((a, b) => b.createdAt - a.createdAt || b.name.localeCompare(a.name))
}

/**
 * Deletes all but the newest `keep` backups of `kind`. Best-effort: a file that cannot be
 * deleted (Windows: open in another program → EBUSY / EPERM) is logged and left for the next
 * rotation; it never fails the backup that triggered the rotation. Returns the deleted paths.
 */
export function rotateBackups(
  dir: string,
  kind: BackupKind = 'auto',
  keep: number = BACKUP_KEEP[kind],
): string[] {
  const deleted: string[] = []
  for (const f of listBackups(dir, kind).slice(keep)) {
    try {
      rmSync(f.path, { force: true })
      deleted.push(f.path)
    } catch (err) {
      console.warn(`Could not delete old backup ${f.path}; will retry next time`, err)
    }
  }
  return deleted
}

export interface TakeBackupOptions {
  kind?: BackupKind
  now?: number
  /** Overrides the per-kind retention (tests). */
  keep?: number
}

/** Writes a snapshot and rotates that kind. Returns the new file's path. */
export function takeBackup(db: Db, dir: string, options: TakeBackupOptions = {}): string {
  const { kind = 'auto', now = Date.now(), keep = BACKUP_KEEP[kind] } = options
  mkdirSync(dir, { recursive: true })
  const base = backupFileName(new Date(now), kind).replace(/\.db$/, '')
  let path = join(dir, `${base}.db`)
  // VACUUM INTO refuses to overwrite; two backups in the same second get a suffix.
  for (let i = 1; existsSync(path); i++) path = join(dir, `${base}-${i}.db`)
  db.backupTo(path)
  rotateBackups(dir, kind, keep)
  return path
}

/** Counts every kind. */
export function getBackupInfo(dir: string): BackupInfo {
  const files = listBackups(dir)
  const newest = files[0]
  return {
    dir,
    latest: newest ? { path: newest.path, createdAt: newest.createdAt } : null,
    count: files.length,
  }
}

/**
 * Takes an automatic snapshot if the newest automatic one is older than `minAgeMs` and the
 * database holds at least one task (soft-deleted included). Returns the new path, or null
 * when skipped.
 */
export function backupIfDue(
  repos: Pick<Repos, 'db' | 'tasks'>,
  dir: string,
  minAgeMs: number,
  now: number = Date.now(),
): string | null {
  if (repos.tasks.countAll() === 0) return null
  const latest = listBackups(dir, 'auto')[0]
  if (latest && now - latest.createdAt < minAgeMs && latest.createdAt <= now) return null
  return takeBackup(repos.db, dir, { kind: 'auto', now })
}

export async function backupNow(ctx: AppContext): Promise<{ path: string }> {
  return { path: takeBackup(ctx.repos.db, ctx.paths.backupsDir, { kind: 'manual' }) }
}

/** Called once at startup. Returns a disposer that stops the timer. */
export function startAutomaticBackups(ctx: AppContext): () => void {
  const run = (minAgeMs: number): void => {
    try {
      backupIfDue(ctx.repos, ctx.paths.backupsDir, minAgeMs)
    } catch (err) {
      console.error('Automatic backup failed', err)
    }
  }
  // Startup snapshot, slightly delayed so it never competes with the first paint.
  const startup = setTimeout(() => run(STARTUP_SKIP_WINDOW_MS), STARTUP_DELAY_MS)
  const timer = setInterval(() => run(BACKUP_INTERVAL_MS), CHECK_EVERY_MS)
  startup.unref()
  timer.unref()
  return () => {
    clearTimeout(startup)
    clearInterval(timer)
  }
}
