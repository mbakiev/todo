// STUB — owned by the desktop-shell feature. Fill in the bodies; signatures are wired.
// Spec §9 "Backup, export, import": JSON file { app, formatVersion: 1, exportedAt, tasks, tags }
// validated with `exportFileSchema` (shared/schemas.ts). Merge = upsert by id (newer
// updatedAt wins; tags matched by id then name). Replace = backup first. One transaction.
// After a successful import, broadcast `ctx.broadcastDataChanged(...)` with all records.
import type { ImportResult } from '@shared/types'
import type { AppContext } from '../context'
import { notImplemented } from '../notImplemented'

export async function exportToFile(_ctx: AppContext): Promise<{ path: string } | null> {
  throw notImplemented('data.exportToFile')
}

export async function importFromFile(
  _ctx: AppContext,
  _mode: 'merge' | 'replace',
): Promise<ImportResult | null> {
  throw notImplemented('data.importFromFile')
}
