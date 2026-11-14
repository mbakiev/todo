import { IPC } from '@shared/ipc'
import { optionalTaskIdSchema, quickAddHeightSchema } from '@shared/schemas'
import { app } from 'electron'
import { z } from 'zod'
import type { AppContext } from '../context'
import { getShortcutStatus } from '../shortcuts'
import { openSettingsInMainWindow, showMainWindow } from '../windows/mainWindow'
import { hideQuickAdd, resizeQuickAdd } from '../windows/quickAddWindow'
import { handle, noArgs } from './handle'

export function registerAppHandlers(ctx: AppContext): void {
  handle(IPC.app.getInfo, noArgs, () => ({
    version: app.getVersion(),
    platform: process.platform,
    isDev: ctx.isDev,
  }))
  handle(IPC.app.showMainWindow, z.tuple([optionalTaskIdSchema]), (taskId) =>
    showMainWindow(ctx, taskId),
  )
  handle(IPC.app.openSettings, noArgs, () => openSettingsInMainWindow(ctx))
  handle(IPC.app.hideQuickAdd, noArgs, () => hideQuickAdd(ctx))
  handle(IPC.app.resizeQuickAdd, z.tuple([quickAddHeightSchema]), (h) => resizeQuickAdd(ctx, h))
  handle(IPC.app.getShortcutStatus, noArgs, () => getShortcutStatus())
}
