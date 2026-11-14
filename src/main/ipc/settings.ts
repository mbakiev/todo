import { IPC } from '@shared/ipc'
import { settingsPatchSchema } from '@shared/schemas'
import { z } from 'zod'
import type { AppContext } from '../context'
import { handle, noArgs } from './handle'

export function registerSettingsHandlers(ctx: AppContext): void {
  const { settings } = ctx.repos

  handle(IPC.settings.get, noArgs, () => settings.get())

  handle(IPC.settings.set, z.tuple([settingsPatchSchema]), (patch) => {
    const next = settings.set(patch)
    ctx.broadcastSettingsChanged(next)
    return next
  })
}
