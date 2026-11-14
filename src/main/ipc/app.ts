import { IPC } from '@shared/ipc'
import { optionalTaskIdSchema, quickAddHeightSchema } from '@shared/schemas'
import { z } from 'zod'
import type { AppContext } from '../context'
import { appVersion } from '../paths'
import { getShortcutStatus, setGlobalShortcutsSuspended } from '../shortcuts'
import { openSettingsInMainWindow, showMainWindow } from '../windows/mainWindow'
import { hideQuickAdd, resizeQuickAdd } from '../windows/quickAddWindow'
import { rendererFlushed } from '../windows/rendererFlush'
import { handle, handleWithSender, noArgs } from './handle'

export function registerAppHandlers(ctx: AppContext): void {
  handle(IPC.app.getInfo, noArgs, () => ({
    version: appVersion(),
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
  handleWithSender(IPC.app.setGlobalShortcutsSuspended, z.tuple([z.boolean()]), (sender, s) =>
    setGlobalShortcutsSuspended(ctx, s, sender),
  )
  handle(IPC.app.flushDone, z.tuple([z.number().int().positive()]), (id) => rendererFlushed(id))
}
