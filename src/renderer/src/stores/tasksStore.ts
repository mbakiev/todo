// Renderer copy of all non-deleted tasks. Main is the source of truth; this store applies
// optimistic updates, reconciles with returned records, rolls back on error (with a toast),
// and applies `dataChanged` broadcasts idempotently (upsert by id).

import { toast } from 'sonner'
import { create } from 'zustand'
import { DEFAULT_PRIORITY } from '@shared/constants'
import type { CreateTaskInput, MoveTaskInput, UpdateTaskPatch } from '@shared/ipc'
import { positionBetween, topPosition } from '@shared/ordering'
import type { DataChange, Task } from '@shared/types'
import { api } from '@/lib/api'
import { errorMessage } from '@/lib/errors'

export interface TasksState {
  byId: Record<string, Task>
  loaded: boolean
  /** Ids with a mutation in flight (count), used to ignore stale broadcasts. */
  pending: Record<string, number>

  load(): Promise<void>
  /** Optimistic create (temp id until the server responds). Resolves to the real task or null on error. */
  create(input: CreateTaskInput): Promise<Task | null>
  update(id: string, patch: UpdateTaskPatch): Promise<Task | null>
  /** Reorder / move between columns (see Api.tasks.move). */
  move(id: string, input: MoveTaskInput): Promise<Task | null>
  /** Soft delete. Prefer `deleteTaskWithUndo` from components/task for UI actions. */
  remove(id: string): Promise<boolean>
  restore(id: string): Promise<Task | null>
  /** Apply a main-process broadcast. Idempotent. */
  applyChange(change: DataChange): void
  /** Resolves once no task write is in flight (including writes started while waiting). */
  whenIdle(): Promise<void>
}

const TEMP_PREFIX = 'tmp-'
export const isTempId = (id: string): boolean => id.startsWith(TEMP_PREFIX)

/** Ids of tasks deleted in this session, so Undo can restore them optimistically. */
const deletedCache = new Map<string, Task>()

/** Listeners notified when an optimistic temp id is replaced by the real id. */
const tempResolvedListeners = new Set<(tempId: string, realId: string) => void>()
export function onTempIdResolved(cb: (tempId: string, realId: string) => void): () => void {
  tempResolvedListeners.add(cb)
  return () => tempResolvedListeners.delete(cb)
}

/** Every task write currently awaiting the main process (see `whenIdle`). */
const inflight = new Set<Promise<unknown>>()
function track<T>(p: Promise<T>): Promise<T> {
  inflight.add(p)
  const done = (): void => {
    inflight.delete(p)
  }
  p.then(done, done)
  return p
}

function fail(action: string, err: unknown): void {
  toast.error(`Couldn't ${action}`, { description: errorMessage(err) })
}

export const useTasksStore = create<TasksState>()((set, get) => {
  const begin = (id: string): void =>
    set((s) => ({ pending: { ...s.pending, [id]: (s.pending[id] ?? 0) + 1 } }))
  const end = (id: string): void =>
    set((s) => {
      const n = (s.pending[id] ?? 1) - 1
      const pending = { ...s.pending }
      if (n <= 0) delete pending[id]
      else pending[id] = n
      return { pending }
    })
  const put = (task: Task): void => set((s) => ({ byId: { ...s.byId, [task.id]: task } }))
  const drop = (id: string): void =>
    set((s) => {
      if (!(id in s.byId)) return s
      const byId = { ...s.byId }
      delete byId[id]
      return { byId }
    })

  return {
    byId: {},
    loaded: false,
    pending: {},

    async load() {
      const tasks = await api().tasks.list()
      const byId: Record<string, Task> = {}
      for (const t of tasks) byId[t.id] = t
      set({ byId, loaded: true })
    },

    async create(input) {
      const tempId = `${TEMP_PREFIX}${crypto.randomUUID()}`
      const now = Date.now()
      const status = input.status ?? 'not_started'
      const column = Object.values(get().byId).filter((t) => t.status === status)
      const optimistic: Task = {
        id: tempId,
        title: input.title.trim(),
        description: input.description ?? '',
        status,
        priority: input.priority ?? DEFAULT_PRIORITY,
        startDate: input.startDate ?? null,
        dueDate: input.dueDate ?? null,
        position: topPosition(column.map((t) => t.position)),
        tagIds: input.tagIds ?? [],
        createdAt: now,
        updatedAt: now,
        completedAt: status === 'done' ? now : null,
      }
      put(optimistic)
      try {
        const task = await track(api().tasks.create(input))
        drop(tempId)
        put(task)
        for (const cb of tempResolvedListeners) cb(tempId, task.id)
        return task
      } catch (err) {
        drop(tempId)
        fail('create task', err)
        return null
      }
    },

    async update(id, patch) {
      const prev = get().byId[id]
      if (!prev) return null
      if (isTempId(id)) {
        toast.error('Task is still being saved — try again in a moment')
        return null
      }
      const now = Date.now()
      const next: Task = { ...prev, ...stripUndefined(patch), updatedAt: now } as Task
      if (patch.status !== undefined && patch.status !== prev.status) {
        next.completedAt = patch.status === 'done' ? now : null
        if (patch.position === undefined) {
          const column = Object.values(get().byId).filter(
            (t) => t.status === patch.status && t.id !== id,
          )
          next.position = topPosition(column.map((t) => t.position))
        }
      }
      put(next)
      begin(id)
      try {
        const task = await track(api().tasks.update(id, patch))
        end(id)
        if ((get().pending[id] ?? 0) === 0) put(task)
        return task
      } catch (err) {
        end(id)
        put(prev)
        fail('update task', err)
        return null
      }
    },

    async move(id, input) {
      const prev = get().byId[id]
      if (!prev || isTempId(id)) return null
      const status = input.status ?? prev.status
      const byId = get().byId
      const before = input.beforeId ? (byId[input.beforeId]?.position ?? null) : null
      const after = input.afterId ? (byId[input.afterId]?.position ?? null) : null
      const now = Date.now()
      const next: Task = {
        ...prev,
        status,
        position: positionBetween(before, after),
        updatedAt: now,
        completedAt: status === prev.status ? prev.completedAt : status === 'done' ? now : null,
      }
      put(next)
      begin(id)
      try {
        const task = await track(api().tasks.move(id, input))
        end(id)
        if ((get().pending[id] ?? 0) === 0) put(task)
        return task
      } catch (err) {
        end(id)
        put(prev)
        fail('move task', err)
        return null
      }
    },

    async remove(id) {
      const prev = get().byId[id]
      if (!prev || isTempId(id)) return false
      deletedCache.set(id, prev)
      drop(id)
      begin(id)
      try {
        await track(api().tasks.delete(id))
        end(id)
        return true
      } catch (err) {
        end(id)
        put(prev)
        fail('delete task', err)
        return false
      }
    },

    async restore(id) {
      const cached = deletedCache.get(id)
      if (cached) put(cached)
      begin(id)
      try {
        const task = await track(api().tasks.restore(id))
        end(id)
        deletedCache.delete(id)
        put(task)
        return task
      } catch (err) {
        end(id)
        if (cached) drop(id)
        fail('restore task', err)
        return null
      }
    },

    async whenIdle() {
      while (inflight.size > 0) await Promise.allSettled([...inflight])
    },

    applyChange(change) {
      const { upsertedTasks, removedTaskIds } = change
      if (!upsertedTasks?.length && !removedTaskIds?.length) return
      set((s) => {
        const byId = { ...s.byId }
        for (const t of upsertedTasks ?? []) {
          const local = byId[t.id]
          // While a local mutation is in flight, ignore broadcasts older than the optimistic state.
          if (local && (s.pending[t.id] ?? 0) > 0 && t.updatedAt < local.updatedAt) continue
          if (!local) {
            // The broadcast for our own create can arrive before the invoke resolves; drop the
            // matching optimistic temp task so it never shows twice.
            const temp = Object.values(byId).find(
              (x) => isTempId(x.id) && x.title === t.title && x.status === t.status,
            )
            if (temp) delete byId[temp.id]
          }
          byId[t.id] = t
        }
        for (const id of removedTaskIds ?? []) delete byId[id]
        return { byId }
      })
    },
  }
})

function stripUndefined<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {}
  for (const [k, v] of Object.entries(o)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v
  }
  return out
}

/** Non-hook accessor for event handlers. */
export const tasksStore = useTasksStore
