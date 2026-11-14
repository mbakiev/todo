// data.* handlers are thin delegators; behaviour lives in services/exportImport.ts and
// services/backup.ts (owned by the desktop-shell feature).
import { IPC } from '@shared/ipc'
import { importModeSchema } from '@shared/schemas'
import { shell } from 'electron'
import { z } from 'zod'
import type { AppContext } from '../context'
import { backupNow } from '../services/backup'
import { exportToFile, importFromFile } from '../services/exportImport'
import { handle, noArgs } from './handle'

export function registerDataHandlers(ctx: AppContext): void {
  handle(IPC.data.exportToFile, noArgs, () => exportToFile(ctx))
  handle(IPC.data.importFromFile, z.tuple([importModeSchema]), (mode) => importFromFile(ctx, mode))
  handle(IPC.data.backupNow, noArgs, () => backupNow(ctx))
  handle(IPC.data.revealDataFolder, noArgs, async () => {
    const err = await shell.openPath(ctx.paths.dataDir)
    if (err) throw new Error(err)
  })
}
