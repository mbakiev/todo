// Task writes from the detail panel. A just-created task still has an optimistic temp id; its
// patches are queued and applied to the real id once the create resolves, so editing a brand
// new task never errors or loses input.
import type { UpdateTaskPatch } from '@shared/ipc'
import { isTempId, onTempIdResolved, useTasksStore } from '@/stores/tasksStore'

const queued = new Map<string, UpdateTaskPatch>()
/** tempId → realId, for tasks resolved during this session. */
const resolved = new Map<string, string>()

onTempIdResolved((tempId, realId) => {
  resolved.set(tempId, realId)
  const patch = queued.get(tempId)
  queued.delete(tempId)
  if (patch) void useTasksStore.getState().update(realId, patch)
})

/** The real id for a (possibly temp) id, if it has been resolved. */
export function resolvedId(id: string): string {
  return resolved.get(id) ?? id
}

export function saveTaskPatch(id: string, patch: UpdateTaskPatch): void {
  const target = resolvedId(id)
  if (isTempId(target)) {
    queued.set(target, { ...queued.get(target), ...patch })
    return
  }
  void useTasksStore.getState().update(target, patch)
}
