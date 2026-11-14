// Task writes from the detail panel. A just-created task still has an optimistic temp id; its
// patches are queued and applied to the real id once the create resolves, so editing a brand
// new task never errors or loses input.
import type { UpdateTaskPatch } from '@shared/ipc'
import { isTempId, onTempIdResolved, useTasksStore } from '@/stores/tasksStore'

interface Queued {
  patch: UpdateTaskPatch
  /** Settled with the outcome of the eventual write. */
  waiters: Array<(ok: boolean) => void>
}

const queued = new Map<string, Queued>()
/** tempId → realId, for tasks resolved during this session. */
const resolved = new Map<string, string>()

onTempIdResolved((tempId, realId) => {
  resolved.set(tempId, realId)
  const q = queued.get(tempId)
  queued.delete(tempId)
  if (!q) return
  void useTasksStore
    .getState()
    .update(realId, q.patch)
    .then((task) => {
      for (const w of q.waiters) w(task !== null)
    })
})

/** The real id for a (possibly temp) id, if it has been resolved. */
export function resolvedId(id: string): string {
  return resolved.get(id) ?? id
}

/** Saves a patch; resolves to false when the write failed (the store has rolled back). */
export function saveTaskPatch(id: string, patch: UpdateTaskPatch): Promise<boolean> {
  const target = resolvedId(id)
  if (isTempId(target)) {
    return new Promise((resolve) => {
      const q = queued.get(target)
      if (q) {
        q.patch = { ...q.patch, ...patch }
        q.waiters.push(resolve)
      } else {
        queued.set(target, { patch, waiters: [resolve] })
      }
    })
  }
  return useTasksStore
    .getState()
    .update(target, patch)
    .then((task) => task !== null)
}
