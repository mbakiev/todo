import { vi } from 'vitest'
import type { Task } from '@shared/types'
import { installMockApi } from '@/test/mockApi'
import { useTasksStore } from './tasksStore'

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))

const base: Task = {
  id: 'a',
  title: 'A',
  description: '',
  status: 'not_started',
  priority: 2,
  startDate: null,
  dueDate: null,
  position: 0,
  tagIds: [],
  createdAt: 1,
  updatedAt: 1,
  completedAt: null,
}

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  useTasksStore.setState({ byId: { a: base }, loaded: true, pending: {} })
})

describe('tasksStore', () => {
  it('applies updates optimistically and reconciles with the server record', async () => {
    const d = deferred<Task>()
    installMockApi({ tasks: { update: vi.fn(() => d.promise) } })
    const p = useTasksStore.getState().update('a', { status: 'done' })
    const optimistic = useTasksStore.getState().byId.a
    expect(optimistic?.status).toBe('done')
    expect(optimistic?.completedAt).not.toBeNull()
    d.resolve({ ...base, status: 'done', completedAt: 99, updatedAt: Date.now() + 1000 })
    await p
    expect(useTasksStore.getState().byId.a?.completedAt).toBe(99)
    expect(useTasksStore.getState().pending).toEqual({})
  })

  it('rolls back on error', async () => {
    installMockApi({ tasks: { update: vi.fn(() => Promise.reject(new Error('nope'))) } })
    const result = await useTasksStore.getState().update('a', { title: 'B' })
    expect(result).toBeNull()
    expect(useTasksStore.getState().byId.a?.title).toBe('A')
  })

  it('create shows a temp task, then the real one exactly once (even if the broadcast arrives first)', async () => {
    const d = deferred<Task>()
    installMockApi({ tasks: { create: vi.fn(() => d.promise) } })
    const p = useTasksStore.getState().create({ title: 'New' })
    const ids = Object.keys(useTasksStore.getState().byId)
    expect(ids.some((id) => id.startsWith('tmp-'))).toBe(true)
    const real = { ...base, id: 'b', title: 'New', position: -1 }
    useTasksStore.getState().applyChange({ upsertedTasks: [real] })
    expect(
      Object.values(useTasksStore.getState().byId).filter((t) => t.title === 'New'),
    ).toHaveLength(1)
    d.resolve(real)
    await p
    expect(Object.keys(useTasksStore.getState().byId).sort()).toEqual(['a', 'b'])
  })

  it('applyChange is idempotent and removes ids', () => {
    const s = useTasksStore.getState()
    const t = { ...base, title: 'X', updatedAt: 5 }
    s.applyChange({ upsertedTasks: [t] })
    s.applyChange({ upsertedTasks: [t] })
    expect(useTasksStore.getState().byId.a?.title).toBe('X')
    s.applyChange({ removedTaskIds: ['a', 'zzz'] })
    expect(useTasksStore.getState().byId).toEqual({})
  })

  it('ignores stale broadcasts while a mutation is in flight', async () => {
    const d = deferred<Task>()
    installMockApi({ tasks: { update: vi.fn(() => d.promise) } })
    const p = useTasksStore.getState().update('a', { title: 'Newer' })
    useTasksStore
      .getState()
      .applyChange({ upsertedTasks: [{ ...base, title: 'Old', updatedAt: 2 }] })
    expect(useTasksStore.getState().byId.a?.title).toBe('Newer')
    d.resolve({ ...base, title: 'Newer', updatedAt: Date.now() + 5 })
    await p
  })

  it('delete + restore round trip', async () => {
    installMockApi({
      tasks: {
        delete: vi.fn(() => Promise.resolve()),
        restore: vi.fn(() => Promise.resolve({ ...base, updatedAt: 9 })),
      },
    })
    expect(await useTasksStore.getState().remove('a')).toBe(true)
    expect(useTasksStore.getState().byId.a).toBeUndefined()
    await useTasksStore.getState().restore('a')
    expect(useTasksStore.getState().byId.a?.updatedAt).toBe(9)
  })
})
