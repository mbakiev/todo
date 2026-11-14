import { IPC } from '@shared/ipc'
import { idSchema, tagCreateInputSchema, tagUpdatePatchSchema } from '@shared/schemas'
import type { Task } from '@shared/types'
import { z } from 'zod'
import type { AppContext } from '../context'
import { handle, noArgs } from './handle'

export function registerTagHandlers(ctx: AppContext): void {
  const { tags, tasks } = ctx.repos

  handle(IPC.tags.list, noArgs, () => tags.list())

  handle(IPC.tags.create, z.tuple([tagCreateInputSchema]), (input) => {
    const tag = tags.create(input)
    ctx.broadcastDataChanged({ tags: [tag] })
    return tag
  })

  handle(IPC.tags.update, z.tuple([idSchema, tagUpdatePatchSchema]), (id, patch) => {
    const tag = tags.update(id, patch)
    ctx.broadcastDataChanged({ tags: [tag] })
    return tag
  })

  handle(IPC.tags.delete, z.tuple([idSchema]), (id) => {
    const { affectedTaskIds } = tags.delete(id)
    const upsertedTasks = affectedTaskIds
      .map((tid) => tasks.get(tid))
      .filter((t): t is Task => t !== undefined)
    ctx.broadcastDataChanged({ removedTagIds: [id], upsertedTasks })
  })
}
