import type { Task } from '../types'

let seq = 0

/** Builds a Task with sensible defaults for unit tests. */
export function makeTask(overrides: Partial<Task> = {}): Task {
  seq++
  return {
    id: overrides.id ?? `t${seq}`,
    title: `Task ${seq}`,
    description: '',
    status: 'not_started',
    priority: 2,
    startDate: null,
    dueDate: null,
    position: seq,
    tagIds: [],
    createdAt: 1_700_000_000_000 + seq,
    updatedAt: 1_700_000_000_000 + seq,
    startedAt: null,
    completedAt: null,
    ...overrides,
  }
}

/** Epoch ms for a local wall-clock time. Month is 1-based. */
export function localMs(y: number, m: number, d: number, h = 12, min = 0, s = 0, ms = 0): number {
  return new Date(y, m - 1, d, h, min, s, ms).getTime()
}
