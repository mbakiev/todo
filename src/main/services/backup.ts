// Automatic + manual DB snapshots (spec §9): `<userData>/backups/todos-YYYYMMDD-HHmmss.db`,
// at startup and every 24 h, keeping the newest 14. Uses VACUUM INTO (consistent in WAL).
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { BACKUP_INTERVAL_MS, BACKUP_KEEP_COUNT } from '@shared/constants'
import type { BackupInfo } from '@shared/types'
import type { AppContext } from '../context'
import type { Db } from '../db'

/** Skip the startup snapshot when one is this fresh (avoids churn while developing). */
export const STARTUP_SKIP_WINDOW_MS = 60 * 60 * 1000
/** How often the running app checks whether the 24 h snapshot is due (survives sleep). */
const CHECK_EVERY_MS = 60 * 60 * 1000
const STARTUP_DELAY_MS = 3000

const NAME_RE = /^todos-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(?:-(\d+))?\.db$/

const pad = (n: number, w = 2): string => String(n).padStart(w, '0')

/** `todos-YYYYMMDD-HHmmss.db` in local time. */
export function backupFileName(at: Date): string {
  const d = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}`
  const t = `${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`
  return `todos-${d}-${t}.db`
}

/** Local timestamp encoded in a backup file name, or null if it is not one of ours. */
export function parseBackupTime(name: string): number | null {
  const m = NAME_RE.exec(name)
  if (!m) return null
  const [, y, mo, d, h, mi, s] = m.map(Number) as number[]
  return new Date(y ?? 0, (mo ?? 1) - 1, d ?? 1, h ?? 0, mi ?? 0, s ?? 0).getTime()
}

interface BackupFile {
  name: string
  path: string
  createdAt: number
}

/** Our backup files, newest first. */
export function listBackups(dir: string): BackupFile[] {
  if (!existsSync(dir)) return []
  const files: BackupFile[] = []
  for (const name of readdirSync(dir)) {
    const createdAt = parseBackupTime(name)
    if (createdAt !== null) files.push({ name, path: join(dir, name), createdAt })
  }
  // Same-second duplicates carry a -N suffix; sort by time, then suffix.
  return files.sort((a, b) => b.createdAt - a.createdAt || b.name.localeCompare(a.name))
}

/** Deletes all but the newest `keep` backups. Returns the deleted paths. */
export function rotateBackups(dir: string, keep: number = BACKUP_KEEP_COUNT): string[] {
  const stale = listBackups(dir).slice(keep)
  for (const f of stale) rmSync(f.path, { force: true })
  return stale.map((f) => f.path)
}

/** Writes a snapshot and rotates. Returns the new file's path. */
export function takeBackup(
  db: Db,
  dir: string,
  now: number = Date.now(),
  keep: number = BACKUP_KEEP_COUNT,
): string {
  mkdirSync(dir, { recursive: true })
  const base = backupFileName(new Date(now)).replace(/\.db$/, '')
  let path = join(dir, `${base}.db`)
  // VACUUM INTO refuses to overwrite; two backups in the same second get a suffix.
  for (let i = 1; existsSync(path); i++) path = join(dir, `${base}-${i}.db`)
  db.backupTo(path)
  rotateBackups(dir, keep)
  return path
}

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
 * Takes a snapshot if the newest one is older than `minAgeMs`. Returns the new path, or
 * null when skipped.
 */
export function backupIfDue(
  db: Db,
  dir: string,
  minAgeMs: number,
  now: number = Date.now(),
): string | null {
  const latest = listBackups(dir)[0]
  if (latest && now - latest.createdAt < minAgeMs && latest.createdAt <= now) return null
  return takeBackup(db, dir, now)
}

export async function backupNow(ctx: AppContext): Promise<{ path: string }> {
  return { path: takeBackup(ctx.repos.db, ctx.paths.backupsDir) }
}

/** Called once at startup. Returns a disposer that stops the timer. */
export function startAutomaticBackups(ctx: AppContext): () => void {
  const run = (minAgeMs: number): void => {
    try {
      backupIfDue(ctx.repos.db, ctx.paths.backupsDir, minAgeMs)
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
