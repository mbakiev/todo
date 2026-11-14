// STUB — owned by the desktop-shell feature. Fill in the bodies; signatures are wired.
// Spec §9: snapshot at startup and every 24h to <userData>/backups/todos-YYYYMMDD-HHmmss.db,
// keep the newest 14 (BACKUP_KEEP_COUNT / BACKUP_INTERVAL_MS in shared/constants.ts).
// Use `ctx.repos.db.backupTo(path)` (VACUUM INTO — consistent while in WAL mode).
import type { AppContext } from '../context'
import { notImplemented } from '../notImplemented'

export async function backupNow(_ctx: AppContext): Promise<{ path: string }> {
  throw notImplemented('data.backupNow')
}

/** Called once at startup. Returns a disposer that stops the timer. */
export function startAutomaticBackups(_ctx: AppContext): () => void {
  return () => {}
}
