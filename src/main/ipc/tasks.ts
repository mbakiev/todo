import { IPC } from '@shared/ipc'
import {
  idSchema,
  taskCreateInputSchema,
  taskMoveInputSchema,
  taskUpdatePatchSchema,
} from '@shared/schemas'
import { z } from 'zod'
import type { AppContext } from '../context'
import { testFaults } from '../testFaults'
import { handle, noArgs } from './handle'

export function registerTaskHandlers(ctx: AppContext): void {
  const { tasks } = ctx.repos

  handle(IPC.tasks.list, noArgs, () => tasks.list())

  handle(IPC.tasks.create, z.tuple([taskCreateInputSchema]), (input) => {
    const { task, createdTags } = tasks.create(input)
    ctx.broadcastDataChanged({
      upsertedTasks: [task],
      ...(createdTags.length > 0 ? { tags: createdTags } : {}),
    })
    return task
  })

  handle(IPC.tasks.update, z.tuple([idSchema, taskUpdatePatchSchema]), (id, patch) => {
    if (testFaults.failTaskUpdates) throw new Error('The change could not be saved (simulated).')
    const task = tasks.update(id, patch)
    ctx.broadcastDataChanged({ upsertedTasks: [task] })
    return task
  })

  handle(IPC.tasks.move, z.tuple([idSchema, taskMoveInputSchema]), (id, input) => {
    const { task, renumbered } = tasks.move(id, input)
    ctx.broadcastDataChanged({ upsertedTasks: [task, ...renumbered] })
    return task
  })

  handle(IPC.tasks.delete, z.tuple([idSchema]), (id) => {
    tasks.softDelete(id)
    ctx.broadcastDataChanged({ removedTaskIds: [id] })
  })

  handle(IPC.tasks.restore, z.tuple([idSchema]), (id) => {
    const task = tasks.restore(id)
    ctx.broadcastDataChanged({ upsertedTasks: [task] })
    return task
  })
}
