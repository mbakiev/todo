// Export / import via native file dialogs (spec §9). The core lives in dataTransfer.ts.
// Dialogs are called as `dialog.showSaveDialog(...)` (not destructured) so e2e tests can
// stub them through `electronApp.evaluate`.
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, dialog } from 'electron'
import type { ImportResult } from '@shared/types'
import type { AppContext } from '../context'
import { buildExport, parseExportFile, runImport } from './dataTransfer'

const MAX_IMPORT_BYTES = 200 * 1024 * 1024

function parentWindow(ctx: AppContext): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? ctx.getMainWindow() ?? undefined
}

function defaultExportName(now: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `martin-todos-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.json`
}

export async function exportToFile(ctx: AppContext): Promise<{ path: string } | null> {
  const options: Electron.SaveDialogOptions = {
    title: 'Export tasks',
    defaultPath: join(app.getPath('documents'), defaultExportName(new Date())),
    filters: [{ name: 'JSON', extensions: ['json'] }],
  }
  const parent = parentWindow(ctx)
  const res = parent
    ? await dialog.showSaveDialog(parent, options)
    : await dialog.showSaveDialog(options)
  if (res.canceled || !res.filePath) return null
  const file = buildExport(ctx.repos)
  await writeFile(res.filePath, `${JSON.stringify(file, null, 2)}\n`, 'utf8')
  return { path: res.filePath }
}

export async function importFromFile(
  ctx: AppContext,
  mode: 'merge' | 'replace',
): Promise<ImportResult | null> {
  const options: Electron.OpenDialogOptions = {
    title: mode === 'replace' ? 'Import and replace all tasks' : 'Import tasks',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }],
  }
  const parent = parentWindow(ctx)
  const res = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options)
  const path = res.filePaths[0]
  if (res.canceled || !path) return null

  const buf = await readFile(path)
  if (buf.byteLength > MAX_IMPORT_BYTES) throw new Error('The file is too large to import.')
  const file = parseExportFile(buf.toString('utf8'))

  const { result, broadcast } = runImport(ctx.repos, ctx.paths.backupsDir, file, mode)
  ctx.broadcastDataChanged(broadcast)
  return result
}
