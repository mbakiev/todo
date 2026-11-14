// Renderer copy of all non-deleted tasks. Main is the source of truth.
//
// Optimistic writes, per task: while any write to a task is in flight, the store keeps the
// last server-confirmed copy (`sync[id].base`, from invoke results and broadcasts) plus the
// list of local operations still awaiting main. What the UI sees (`byId`) is always
// `base` with the pending operations replayed on top, in issue order. So:
// - a broadcast or result for one write never reverts a field another pending write set
//   (it only moves `base` forward — task `updatedAt` is strictly increasing per task);
// - a failed write simply drops out of the replay: only its own fields revert, and only to
//   the newest server copy, never to a stale pre-write snapshot;
// - when the last pending write settles, `byId` becomes exactly the server copy.

import { toast } from 'sonner'
import { create } from 'zustand'
import { DEFAULT_PRIORITY } from '@shared/constants'
import type { CreateTaskInput, MoveTaskInput, UpdateTaskPatch } from '@shared/ipc'
import { positionBetween, topPosition } from '@shared/ordering'
import type { DataChange, Task } from '@shared/types'
import { api } from '@/lib/api'
import { errorMessage } from '@/lib/errors'

/** A local write to one task that main has not answered yet. */
export type PendingOp =
  | { seq: number; kind: 'patch'; values: Partial<Task> }
  | { seq: number; kind: 'delete' }
  | { seq: number; kind: 'restore'; task: Task | null }

export interface TaskSync {
  /** Newest server-confirmed copy; null = deleted on the server (or unknown). */
  base: Task | null
  ops: PendingOp[]
}

export interface TasksState {
  byId: Record<string, Task>
  loaded: boolean
  /** Ids with a mutation in flight (count). */
  pending: Record<string, number>
  /** Per-task optimistic bookkeeping while writes are in flight (see file header). */
  sync: Record<string, TaskSync>

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

let nextSeq = 1

/** `base` with the pending operations replayed on top. */
export function replay(base: Task | null, ops: readonly PendingOp[]): Task | null {
  let t = base
  for (const op of ops) {
    if (op.kind === 'patch') t = t ? { ...t, ...op.values } : t
    else if (op.kind === 'delete') t = null
    else t = t ?? op.task
  }
  return t
}

/** A server copy replaces `base` unless it is older (stale broadcast / out-of-order result). */
function newer(base: Task | null, incoming: Task): boolean {
  return base === null || incoming.updatedAt >= base.updatedAt
}

type Server = { task: Task } | { deleted: true } | null

export const useTasksStore = create<TasksState>()((set, get) => {
  /** Writes `task` (or its absence) into byId. */
  const show = (byId: Record<string, Task>, id: string, task: Task | null): void => {
    if (task) byId[id] = task
    else delete byId[id]
  }

  /** Starts a pending op on `id`; the display updates immediately. */
  const begin = (id: string, op: PendingOp): void =>
    set((s) => {
      const cur = s.sync[id] ?? { base: s.byId[id] ?? null, ops: [] }
      const entry: TaskSync = { base: cur.base, ops: [...cur.ops, op] }
      const byId = { ...s.byId }
      show(byId, id, replay(entry.base, entry.ops))
      return {
        byId,
        sync: { ...s.sync, [id]: entry },
        pending: { ...s.pending, [id]: entry.ops.length },
      }
    })

  /** Ends op `seq` on `id`, folding in the server's answer (null = the write failed). */
  const settle = (id: string, seq: number, server: Server): void =>
    set((s) => {
      const cur = s.sync[id]
      if (!cur) {
        // Bookkeeping was reset underneath us (tests / reload): just apply the answer.
        if (!server) return s
        const byId = { ...s.byId }
        show(byId, id, 'task' in server ? server.task : null)
        return { byId }
      }
      let base = cur.base
      if (server && 'task' in server && newer(base, server.task)) base = server.task
      if (server && 'deleted' in server) base = null
      const ops = cur.ops.filter((o) => o.seq !== seq)
      const byId = { ...s.byId }
      const sync = { ...s.sync }
      const pending = { ...s.pending }
      if (ops.length === 0) {
        // Last pending write settled: reconcile fully with the server copy.
        show(byId, id, base)
        delete sync[id]
        delete pending[id]
      } else {
        show(byId, id, replay(base, ops))
        sync[id] = { base, ops }
        pending[id] = ops.length
      }
      return { byId, sync, pending }
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
    sync: {},

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
        // A broadcast may already have delivered (and a later write updated) the real task.
        const known = get().byId[task.id]
        if (!known || task.updatedAt >= known.updatedAt) put(task)
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
      const values: Partial<Task> = { ...stripUndefined(patch), updatedAt: now } as Partial<Task>
      if (patch.status !== undefined && patch.status !== prev.status) {
        values.completedAt = patch.status === 'done' ? now : null
        if (patch.position === undefined) {
          const column = Object.values(get().byId).filter(
            (t) => t.status === patch.status && t.id !== id,
          )
          values.position = topPosition(column.map((t) => t.position))
        }
      }
      const seq = nextSeq++
      begin(id, { seq, kind: 'patch', values })
      try {
        const task = await track(api().tasks.update(id, patch))
        settle(id, seq, { task })
        return task
      } catch (err) {
        settle(id, seq, null)
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
      const values: Partial<Task> = {
        status,
        position: positionBetween(before, after),
        updatedAt: now,
        completedAt: status === prev.status ? prev.completedAt : status === 'done' ? now : null,
      }
      const seq = nextSeq++
      begin(id, { seq, kind: 'patch', values })
      try {
        const task = await track(api().tasks.move(id, input))
        settle(id, seq, { task })
        return task
      } catch (err) {
        settle(id, seq, null)
        fail('move task', err)
        return null
      }
    },

    async remove(id) {
      const prev = get().byId[id]
      if (!prev || isTempId(id)) return false
      deletedCache.set(id, prev)
      const seq = nextSeq++
      begin(id, { seq, kind: 'delete' })
      try {
        await track(api().tasks.delete(id))
        settle(id, seq, { deleted: true })
        return true
      } catch (err) {
        // Comes back as the newest server copy, not the snapshot taken before deleting.
        settle(id, seq, null)
        fail('delete task', err)
        return false
      }
    },

    async restore(id) {
      const cached = deletedCache.get(id) ?? null
      const seq = nextSeq++
      begin(id, { seq, kind: 'restore', task: cached })
      try {
        const task = await track(api().tasks.restore(id))
        deletedCache.delete(id)
        settle(id, seq, { task })
        return task
      } catch (err) {
        settle(id, seq, null)
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
        let sync = s.sync
        const syncFor = (id: string, entry: TaskSync): void => {
          if (sync === s.sync) sync = { ...s.sync }
          sync[id] = entry
        }
        for (const t of upsertedTasks ?? []) {
          const entry = sync[t.id]
          if (entry) {
            // Writes in flight: advance the server copy, keep pending fields on top.
            const base = change.authoritative || newer(entry.base, t) ? t : entry.base
            syncFor(t.id, { base, ops: entry.ops })
            show(byId, t.id, replay(base, entry.ops))
            continue
          }
          const local = byId[t.id]
          // Stale (an older version than we hold, e.g. a late broadcast for an earlier write).
          if (local && !change.authoritative && t.updatedAt < local.updatedAt) continue
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
        for (const id of removedTaskIds ?? []) {
          const entry = sync[id]
          if (entry) {
            syncFor(id, { base: null, ops: entry.ops })
            show(byId, id, replay(null, entry.ops))
          } else {
            delete byId[id]
          }
        }
        return { byId, sync }
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
